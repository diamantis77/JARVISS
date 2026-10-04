import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { LiveWS } from "openai/resources/live/ws";
import WebSocket from "ws";
import type { TelephonyProviderName } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createSupabaseRepositories } from "@/lib/repositories/supabase";
import { buildVoicePresentationInstructions } from "@/lib/voice/instructions";
import { OpenAIJarvisProviderCore } from "@/lib/ai/openai-provider-core";
import { createResearchService } from "@/lib/research/factory";
import { runJarvisLoop } from "@/lib/jarvis/tool-loop";
import { logPhoneDiagnostic, safeDiagnosticCode } from "./diagnostics";
import { getPhoneLiveVoice, PHONE_VOICE_INSTRUCTIONS } from "./phone-voice-config";
import { SupabasePhoneCallRepository } from "./repository";
import { createTelephonyProvider } from "./provider";
import { ownerCallGreeting, ownerCallGreetingInstruction } from "./owner-call-greeting";

export interface PhoneMediaTransport {
  socket: WebSocket;
  provider: TelephonyProviderName;
  phoneCallId: string;
  providerCallId?: string;
  connectionId?: string;
  liveAudioFormat: { type: "audio/pcmu"; rate: 8000 } | { type: "audio/pcm"; rate: 16000 | 24000 };
  sendAudio(base64: string): void;
  clearPlayback(): void | { localOutputQueueClearedAt: number; providerClearSentAt: number | null; lastOldAssistantAudioSentAt: number | null; discardedLocalBytes: number };
  isPlaybackActive?(): boolean;
  close(reason: string): void;
}

export function createPhoneLiveSession(transport: PhoneMediaTransport) {
  const startedAt = Date.now();
  const trace = { phoneCallId: transport.phoneCallId, providerCallId: transport.providerCallId ?? null, connectionId: transport.connectionId ?? null };
  let live: LiveWS | null = null; let closed = false; let ready = false; let liveFinalized = false;
  let liveSessionCloseRequestedAt: number | null = null; let liveSocketCloseRequestedAt: number | null = null;
  let maxTimer: NodeJS.Timeout | null = null; let warningTimer: NodeJS.Timeout | null = null; let endingTimer: NodeJS.Timeout | null = null;
  let greetingFallbackTimer: NodeJS.Timeout | null = null; let listeningTimer: NodeJS.Timeout | null = null;
  let finalizationTimer: NodeJS.Timeout | null = null;
  let delegationChain = Promise.resolve(); let assistantAudioAt = 0;
  let speechCandidateAt = 0; let speechCandidateFrames = 0; let speechCandidateMs = 0; let quietMs = 0; let noiseFloor = 120;
  let callerSpeaking = false; let liveUsageSeconds = 0;
  let ownerSpokeBeforeGreeting = false; let greetingRequestedAt: number | null = null;
  let greetingFirstAudioAt: number | null = null; let greetingFallbackSent = false;
  let lifecycleState = "MEDIA_CONNECTING";
  let inputPackets = 0; let outputDeltas = 0; let outputBytes = 0; let outputForwarded = 0; let outputSuppressed = 0;
  let initializationStage = "read_call";
  let closeRecordPromise: Promise<void> = Promise.resolve();
  const queuedAudio: string[] = []; const history: Array<{ role: "user" | "assistant"; text: string }> = [];
  const log = (event: string, fields: Record<string, string | number | boolean | null> = {}) => logPhoneDiagnostic(event, { ...trace, ...fields });
  const lifecycle = (next: string, cause: string) => {
    if (lifecycleState === next) return;
    log("phone_lifecycle_transition", { from: lifecycleState, to: next, cause });
    lifecycleState = next;
  };
  log("phone_lifecycle_transition", { from: "ANSWERED", to: "MEDIA_CONNECTING", cause: "media_websocket_open" });
  type Phase = "LISTENING" | "SPEAKING" | "INTERRUPTING" | "LISTENING_FOR_INTERRUPTION_TURN" | "PROCESSING_USER_TURN";
  type CallerTurn = { id: number; startedAt: number; transcript: string; transcriptEndMs: number | null; committed: boolean; runStarted: boolean; runCompleted: boolean; interruptedResponseId: string | null; commentaryEventId: string | null; commentaryEndMs: number | null; freshOutputStartMs: number | null; resumed: boolean; firstNewAudioForwarded: boolean; discardedDeltas: number; settleTimer: NodeJS.Timeout | null; watchdog: NodeJS.Timeout | null };
  let phase: Phase = "LISTENING";
  // The primary GPT-Live WebSocket does not attach response/item IDs or timestamps
  // to output audio. These IDs are bridge-local; commentary ACK + output transcript
  // timeline is the observable boundary between interrupted and fresh speech.
  let turnSequence = 0; let responseSequence = 0; let activeResponseId: string | null = null;
  let currentTurn: CallerTurn | null = null; let quarantinedResponseId: string | null = null;
  let scheduleCommittedTurn: ((turn: CallerTurn) => void) | null = null;
  let tryResumeOutput: ((turn: CallerTurn) => void) | null = null;
  const interruptedResponseIds = new Set<string>();
  const requestLiveSocketClose = (reason: string) => {
    if (!live || liveSocketCloseRequestedAt !== null) return;
    liveSocketCloseRequestedAt = Date.now();
    log("openai_ws_close_requested", { reason: safeDiagnosticCode(reason), afterSessionClosed: liveFinalized, sinceSessionCloseRequestedMs: liveSessionCloseRequestedAt === null ? null : Date.now() - liveSessionCloseRequestedAt });
    live.close({ code: 1000, reason });
  };
  const transition = (next: Phase, cause: string, turnId: number | null = currentTurn?.id ?? null) => {
    const allowed: Record<Phase, Phase[]> = {
      LISTENING: ["SPEAKING", "INTERRUPTING", "PROCESSING_USER_TURN"],
      SPEAKING: ["LISTENING", "INTERRUPTING", "PROCESSING_USER_TURN"],
      INTERRUPTING: ["LISTENING_FOR_INTERRUPTION_TURN", "PROCESSING_USER_TURN", "LISTENING"],
      LISTENING_FOR_INTERRUPTION_TURN: ["PROCESSING_USER_TURN", "LISTENING", "INTERRUPTING"],
      PROCESSING_USER_TURN: ["SPEAKING", "LISTENING", "INTERRUPTING"],
    };
    if (next !== phase && !allowed[phase].includes(next)) log("phone_state_invalid_transition", { from: phase, to: next, cause, turnId });
    if (next !== phase) log("phone_state_transition", { from: phase, to: next, cause, turnId });
    phase = next;
  };
  const startTurn = (): CallerTurn => {
    if (currentTurn?.settleTimer) clearTimeout(currentTurn.settleTimer);
    if (currentTurn?.watchdog) clearTimeout(currentTurn.watchdog);
    const turn: CallerTurn = {
      id: ++turnSequence, startedAt: Date.now(), transcript: "", transcriptEndMs: null,
      committed: false, runStarted: false, runCompleted: false, interruptedResponseId: quarantinedResponseId,
      commentaryEventId: null, commentaryEndMs: null, freshOutputStartMs: null, resumed: false, firstNewAudioForwarded: false, discardedDeltas: 0,
      settleTimer: null, watchdog: null,
    };
    currentTurn = turn;
    return turn;
  };

  const closeAll = (reason: string, failed = false): Promise<void> => {
    if (closed) return closeRecordPromise;
    closed = true;
    log("phone_session_closing", { reason: safeDiagnosticCode(reason), termination_reason: safeDiagnosticCode(reason), failed, lifetimeMs: Date.now() - startedAt, inputPackets, outputDeltas, outputBytes, outputForwarded, outputSuppressed, liveFinalized });
    if (maxTimer) clearTimeout(maxTimer);
    if (warningTimer) clearTimeout(warningTimer);
    if (endingTimer) clearTimeout(endingTimer);
    if (greetingFallbackTimer) clearTimeout(greetingFallbackTimer);
    if (listeningTimer) clearTimeout(listeningTimer);
    lifecycle("ENDING", reason);
    if (currentTurn?.settleTimer) clearTimeout(currentTurn.settleTimer);
    if (currentTurn?.watchdog) clearTimeout(currentTurn.watchdog);
    // End the media leg promptly. Database writes must not hold the socket open.
    transport.close(reason);
    if (live) {
      const active = live;
      if (ready && !liveFinalized) {
        liveSessionCloseRequestedAt = Date.now();
        active.send({ type: "session.close" });
        finalizationTimer = setTimeout(() => {
          log("openai_finalization_timeout");
          requestLiveSocketClose(reason);
        }, 5_000);
        finalizationTimer.unref?.();
      } else requestLiveSocketClose(reason);
    }
    closeRecordPromise = (async () => {
      const repo = new SupabasePhoneCallRepository(createAdminClient());
      const call = await repo.get(transport.phoneCallId).catch(() => null);
      if (call && !["completed", "failed", "busy", "no_answer", "cancelled"].includes(call.status)) {
        await repo.update(call.id, {
          status: failed ? "failed" : "completed", endedAt: new Date().toISOString(),
          liveSessionDurationSeconds: Math.ceil(liveUsageSeconds),
          ...(failed ? { errorCategory: "media", errorSummary: "The secure phone media session ended unexpectedly." } : {}),
        }).catch(() => undefined);
      }
    })();
    lifecycle(failed ? "ERROR" : "ENDED", reason);
    return closeRecordPromise;
  };

  const initialize = async () => {
    const db = createAdminClient(); const phone = new SupabasePhoneCallRepository(db);
    const call = await phone.get(transport.phoneCallId);
    if (!call || call.provider !== transport.provider || (call.providerCallId && transport.providerCallId && call.providerCallId !== transport.providerCallId)) throw new Error("Media call mismatch");
    initializationStage = "read_settings";
    const repositories = createSupabaseRepositories(db, call.userId);
    const [settings, phoneSettings] = await Promise.all([repositories.settings.get(), phone.getSettings(call.userId)]);
    const phoneVoice = getPhoneLiveVoice();
    const runTurn = (turn: CallerTurn, delegationId: string | null) => {
      if (turn.runStarted || closed) return;
      if (turn.settleTimer) clearTimeout(turn.settleTimer);
      const command = turn.transcript.trim();
      log("caller_transcript_finalized", { turnId: turn.id, caller_turn_finalized_at: new Date().toISOString(), available: Boolean(command), characters: command.length, source: delegationId ? "delegation" : "vad_commit" });
      if (!command) {
        if (delegationId) live?.send({ type: "session.commentary.append", delegation_id: delegationId, content: "Δεν άκουσα καθαρά την εντολή. Ζήτησε μία σύντομη επανάληψη." });
        return;
      }
      if (!turn.committed) {
        turn.committed = true;
        log("caller_turn_committed", { turnId: turn.id, transcriptAvailable: true, transcriptEndMs: turn.transcriptEndMs, source: "live_delegation" });
      }
      turn.runStarted = true;
      lifecycle("PROCESSING", "caller_turn_finalized");
      transition("PROCESSING_USER_TURN", "transcript_finalized", turn.id);
      history.push({ role: "user", text: command });
      log("jarvis_run_started", { turnId: turn.id, jarvis_run_started_at: new Date().toISOString(), delegated: Boolean(delegationId) });
      delegationChain = delegationChain.then(async () => {
        const result = await runJarvisLoop({
          command: `Call reason and trusted context: ${JSON.stringify({ reason: call.reason, ...call.context })}\nOwner said: ${command}`,
          mode: "live", repositories, provider: new OpenAIJarvisProviderCore(),
          researchService: createResearchService(repositories, "live", call.userId), inputSource: "phone", voiceConversationContext: history.slice(-8),
        });
        await phone.update(call.id, { jarvisRunId: result.run.id }).catch(() => undefined);
        turn.runCompleted = true;
        log("jarvis_run_completed", { turnId: turn.id, success: true });
        if (currentTurn !== turn) {
          log("jarvis_result_superseded", { turnId: turn.id, currentTurnId: currentTurn?.id ?? null });
          if (delegationId && !closed) live?.send({ type: "session.thinking.append", delegation_id: delegationId, content: "The caller has started a newer turn. Do not speak this superseded result." });
          return;
        }
        history.push({ role: "assistant", text: result.message });
        if (!closed) {
          turn.commentaryEventId = `phone-turn-${turn.id}-${randomUUID()}`;
          live?.send({ type: "session.commentary.append", delegation_id: delegationId, event_id: turn.commentaryEventId, content: result.message.slice(0, 1800) });
        }
      }).catch((error: unknown) => {
        turn.runCompleted = true;
        log("jarvis_run_completed", { turnId: turn.id, success: false, errorType: safeDiagnosticCode(error instanceof Error ? error.name : typeof error) });
        if (currentTurn !== turn) return;
        if (!closed) {
          turn.commentaryEventId = `phone-turn-${turn.id}-${randomUUID()}`;
          live?.send({ type: "session.commentary.append", delegation_id: delegationId, event_id: turn.commentaryEventId, content: "Η εργασία δεν ολοκληρώθηκε. Ενημέρωσε σύντομα τον χρήστη και μην ισχυριστείς επιτυχία." });
        }
      });
    };
    scheduleCommittedTurn = (turn: CallerTurn) => {
      if (!turn.interruptedResponseId || turn.runStarted || turn.settleTimer || closed) return;
      // Live transcript fragments are incremental and have no transcript-done event.
      // Settle only an observed, committed caller utterance; never reopen audio on a timer.
      turn.settleTimer = setTimeout(() => {
        turn.settleTimer = null;
        if (turn.transcript.trim()) runTurn(turn, null);
        else log("caller_transcript_unavailable", { turnId: turn.id });
      }, turn.transcript.trim() ? 120 : 800);
      turn.settleTimer.unref?.();
    };
    tryResumeOutput = (turn: CallerTurn) => {
      if (closed || callerSpeaking || turn.resumed || currentTurn !== turn || !turn.runCompleted ||
          !turn.interruptedResponseId || !interruptedResponseIds.has(turn.interruptedResponseId) ||
          turn.interruptedResponseId !== quarantinedResponseId || turn.commentaryEndMs === null ||
          turn.freshOutputStartMs === null || turn.freshOutputStartMs < turn.commentaryEndMs ||
          (turn.transcriptEndMs !== null && turn.freshOutputStartMs < turn.transcriptEndMs)) return;
      turn.resumed = true;
      quarantinedResponseId = null;
      activeResponseId = `bridge-response-${++responseSequence}`;
      if (turn.watchdog) { clearTimeout(turn.watchdog); turn.watchdog = null; }
      log("new_response_id", { turnId: turn.id, new_response_id: activeResponseId, source: "post_commentary_output_transcript", outputStartMs: turn.freshOutputStartMs });
      log("barge_in_output_resumed", { turnId: turn.id, interrupted_response_id: turn.interruptedResponseId, new_response_id: activeResponseId, old_response_delta_discarded_count: turn.discardedDeltas });
      transition("SPEAKING", "fresh_output_transcript", turn.id);
    };
    initializationStage = "mark_answered";
    // The authenticated media leg and owner-bound call record are already
    // verified. A transient audit write must not tear down an answered call
    // before Live can greet; Event/close paths can reconcile its final state.
    try {
      await phone.update(call.id, { status: "in_progress", providerStatus: "in_progress", answeredAt: call.answeredAt ?? new Date().toISOString() });
    } catch {
      log("phone_answer_persist_delayed", { stage: "mark_answered" });
    }
    if (closed) return; // The caller may have hung up during database initialization.

    initializationStage = "connect_openai";
    lifecycle("LIVE_CONNECTING", "call_verified");
    log("openai_connect_start", { modelConfigured: Boolean(process.env.OPENAI_VOICE_MODEL), voice: phoneVoice, inputCommitSupported: false, speechEventsSupported: false });
    live = new LiveWS(new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 45_000, maxRetries: 1 }), { reconnect: null });
    live.socket.on("open", () => log("openai_ws_open", { lifetimeMs: Date.now() - startedAt }));
    live.on("session.started", () => {
      if (closed) return;
      ready = true;
      log("openai_session_started", { queuedPackets: queuedAudio.length, configured: true });
      queuedAudio.splice(0).forEach((audio) => live?.send({ type: "session.input_audio.append", audio }));
      live?.send({ type: "session.thinking.append", delegation_id: null, content: `Structured call context: ${JSON.stringify({ reason: call.reason, ...call.context }).slice(0, 1800)}` });
      if (ownerSpokeBeforeGreeting) {
        lifecycle("LISTENING", "owner_spoke_before_greeting");
        log("greeting_skipped_owner_first");
        live?.send({ type: "session.instructions.append", delegation_id: null, event_id: `owner-first-${randomUUID()}`, content: "Ο ιδιοκτήτης άρχισε ήδη να μιλά. Άκουσέ τον και απάντησε στη δική του ερώτηση· μην αρχίσεις καθυστερημένο χαιρετισμό." });
        return;
      }
      const greeting = ownerCallGreeting(call.context);
      greetingRequestedAt = Date.now();
      lifecycle("GREETING", "live_session_ready");
      log("greeting_requested", { greeting_requested_at: new Date(greetingRequestedAt).toISOString(), reasonCode: safeDiagnosticCode(call.reason) });
      live?.send({
        type: "session.instructions.append", delegation_id: null, event_id: `greeting-${randomUUID()}`,
        content: ownerCallGreetingInstruction(greeting),
      });
      // GPT-Live's instruction ACK is not proof of audible speech. One
      // speakable fallback is requested only if no audio or caller speech
      // arrives; the phone connection stays open throughout startup.
      greetingFallbackTimer = setTimeout(() => {
        if (closed || greetingFirstAudioAt !== null || ownerSpokeBeforeGreeting || greetingFallbackSent) return;
        greetingFallbackSent = true;
        log("greeting_audio_delayed", { delayMs: Date.now() - greetingRequestedAt! });
        live?.send({ type: "session.commentary.append", delegation_id: null, event_id: `greeting-fallback-${randomUUID()}`, content: greeting });
      }, 3_000);
      greetingFallbackTimer.unref?.();
    });
    live.on("session.instructions.appended", (event) => {
      if (event.client_event_id?.startsWith("greeting-")) log("openai_greeting_accepted", { greeting_requested_at: greetingRequestedAt === null ? null : new Date(greetingRequestedAt).toISOString() });
    });
    live.on("session.input_transcript.delta", (event) => {
      const turn = currentTurn ?? startTurn();
      turn.transcript += event.delta;
      if (Number.isFinite(event.end_ms)) turn.transcriptEndMs = event.end_ms;
      if (turn.committed && !turn.runStarted) {
        if (turn.settleTimer) clearTimeout(turn.settleTimer);
        turn.settleTimer = null;
        scheduleCommittedTurn?.(turn);
      }
      if (!endingTimer && /(ευχαριστ[ώω].*(αυτό ήταν|αυτο ηταν)|αυτό ήταν|αυτο ηταν|τέλος δοκιμής|τελος δοκιμης|κλείσε|κλεισε)/i.test(turn.transcript.toLocaleLowerCase("el-GR"))) {
        live?.send({ type: "session.commentary.append", delegation_id: null, content: "Πες ακριβώς: Βεβαίως κύριε." });
        endingTimer = setTimeout(() => {
          if (call.providerCallId) createTelephonyProvider(call.provider).endCall(call.providerCallId).catch(() => undefined);
          void closeAll("owner_finished");
        }, 4_000);
      }
    });
    live.on("session.output_audio.delta", (event) => {
      outputDeltas += 1;
      const bytes = Buffer.byteLength(event.delta, "base64"); outputBytes += bytes;
      if (outputDeltas === 1) {
        // GPT-Live has no spoken-turn response.created event; first output
        // audio is the first observable assistant response on this transport.
        log("openai_first_assistant_response", { source: "output_audio_delta" });
        log("openai_first_audio_delta", { bytes });
      }
      if (greetingRequestedAt !== null && greetingFirstAudioAt === null && !ownerSpokeBeforeGreeting) {
        greetingFirstAudioAt = Date.now();
        if (greetingFallbackTimer) clearTimeout(greetingFallbackTimer);
        log("greeting_first_audio", { greeting_first_audio_at: new Date(greetingFirstAudioAt).toISOString(), afterRequestMs: greetingFirstAudioAt - greetingRequestedAt });
      }
      if (closed || quarantinedResponseId !== null) {
        outputSuppressed += 1;
        if (currentTurn?.interruptedResponseId && !currentTurn.resumed) {
          currentTurn.discardedDeltas += 1;
          if (currentTurn.discardedDeltas === 1) log("old_response_delta_discarded", { turnId: currentTurn.id, interrupted_response_id: currentTurn.interruptedResponseId, old_response_delta_discarded_count: currentTurn.discardedDeltas });
        }
        return;
      }
      if (!activeResponseId) activeResponseId = `bridge-response-${++responseSequence}`;
      if (phase !== "SPEAKING") transition("SPEAKING", "assistant_audio", currentTurn?.id ?? null);
      transport.sendAudio(event.delta); assistantAudioAt = Date.now(); outputForwarded += 1;
      lifecycle("SPEAKING", greetingRequestedAt !== null && currentTurn === null ? "greeting_audio_forwarded" : "assistant_audio_forwarded");
      if (outputForwarded === 1) log("openai_first_audio_forwarded", { bytes });
      if (greetingFirstAudioAt !== null && outputForwarded === 1) log("greeting_forwarded", { greeting_forwarded_at: new Date().toISOString() });
      if (listeningTimer) clearTimeout(listeningTimer);
      listeningTimer = setTimeout(() => {
        if (!closed && !callerSpeaking && !transport.isPlaybackActive?.()) lifecycle("LISTENING", "assistant_audio_queue_drained");
      }, 1_000);
      listeningTimer.unref?.();
      if (currentTurn?.resumed && !currentTurn.firstNewAudioForwarded) {
        currentTurn.firstNewAudioForwarded = true;
        log("first_new_response_audio_delta", { turnId: currentTurn.id, new_response_id: activeResponseId, bytes });
        log("first_new_response_audio_forwarded", { turnId: currentTurn.id, new_response_id: activeResponseId, jarvis_response_audio_at: new Date().toISOString(), resume_latency_ms: Date.now() - currentTurn.startedAt });
      }
    });
    live.on("session.usage.updated", (event) => { liveUsageSeconds = event.usage.seconds; });
    live.on("session.output_transcript.delta", (event) => {
      const turn = currentTurn;
      if (turn?.interruptedResponseId && !turn.resumed && Number.isFinite(event.start_ms)) {
        turn.freshOutputStartMs = Math.max(turn.freshOutputStartMs ?? -1, event.start_ms);
        tryResumeOutput?.(turn);
      }
      if (quarantinedResponseId !== null) return; // Do not put an interrupted answer back into conversation context.
      const last = history.at(-1); if (last?.role === "assistant") last.text += event.delta;
      else history.push({ role: "assistant", text: event.delta });
    });
    live.on("session.commentary.appended", (event) => {
      const turn = currentTurn;
      if (turn?.commentaryEventId && event.client_event_id === turn.commentaryEventId && Number.isFinite(event.end_ms)) {
        turn.commentaryEndMs = event.end_ms;
        log("jarvis_commentary_accepted", { turnId: turn.id, timelineEndMs: event.end_ms });
        tryResumeOutput?.(turn);
      }
    });
    live.on("response.event", (event) => {
      const type = event.event.type;
      if (type === "response.created" || type === "response.completed" || type === "response.failed") {
        log("openai_backend_response", { responseEvent: type });
      }
      // Backend turn completion does not end the media session.
    });
    live.on("session.delegation.created", (event) => {
      if (event.delegation.target !== "client") return;
      const turn = currentTurn ?? startTurn();
      if (turn.runStarted) {
        log("duplicate_turn_delegation_ignored", { turnId: turn.id });
        live?.send({ type: "session.thinking.append", delegation_id: event.delegation.id, content: "This caller turn has already been processed. Do not repeat the spoken reply." });
        return;
      }
      runTurn(turn, event.delegation.id);
    });
    live.on("session.closed", (event) => {
      liveFinalized = true; liveUsageSeconds = event.usage.seconds;
      log("openai_session_closed", { reason: safeDiagnosticCode(event.reason), lifetimeMs: Date.now() - startedAt, usageSeconds: liveUsageSeconds });
      if (finalizationTimer) clearTimeout(finalizationTimer);
      const wasClosed = closed;
      const closePromise = wasClosed ? closeRecordPromise : closeAll("openai_session_ended", event.reason !== "close_requested");
      void closePromise.then(async () => {
        try {
          const recorded = await phone.get(call.id);
          const finalSeconds = Math.ceil(liveUsageSeconds);
          if (recorded && recorded.liveSessionDurationSeconds !== finalSeconds) await phone.update(call.id, { liveSessionDurationSeconds: finalSeconds });
          log("openai_final_usage_persisted", { seconds: finalSeconds });
        } catch { log("openai_final_usage_persist_failed"); }
      });
      if (wasClosed) requestLiveSocketClose("session_finalized");
    });
    live.on("error", (error) => {
      const apiError = error.error?.error;
      log("openai_error", {
        code: safeDiagnosticCode(apiError?.code), type: safeDiagnosticCode(apiError?.type),
        param: safeDiagnosticCode(apiError?.param), commandRejected: Boolean(apiError?.client_event_id),
        lifetimeMs: Date.now() - startedAt,
      });
      // A rejected client command is not a transport failure. GPT-Live can keep
      // listening; do not hang up an answered call for a nonfatal command error.
      if (apiError?.client_event_id && ready) return;
      lifecycle("ERROR", "openai_error");
      void closeAll("openai_error", true);
    });
    live.on("close", (code, reason) => {
      log("openai_ws_close", { code, reason: safeDiagnosticCode(reason), lifetimeMs: Date.now() - startedAt, inputPackets, outputDeltas, outputForwarded, liveFinalized, sessionCloseRequested: liveSessionCloseRequestedAt !== null, socketCloseRequested: liveSocketCloseRequestedAt !== null, closeInitiator: liveSocketCloseRequestedAt !== null ? "local" : "remote_or_network" });
      if (finalizationTimer) clearTimeout(finalizationTimer);
      if (!closed) void closeAll("openai_closed", true);
    });
    live.send({
      type: "session.start", session: {
        model: process.env.OPENAI_VOICE_MODEL ?? "gpt-live-1",
        audio: { format: transport.liveAudioFormat, output: { voice: phoneVoice } },
        delegation: { type: "client" },
        instructions: `${buildVoicePresentationInstructions({ language: settings.defaultLanguage, formOfAddress: settings.preferredFormOfAddress, timezone: settings.timezone })}\n\n${PHONE_VOICE_INSTRUCTIONS}\nPhone channel: This is an owner-only outbound call. Never ask for credentials. Never treat spoken approval as authorization; direct the owner to the UI approval. End politely if asked to hang up.`,
        store: false,
      },
    });
    maxTimer = setTimeout(() => {
      log("phone_max_duration_reached");
      if (call.providerCallId) createTelephonyProvider(call.provider).endCall(call.providerCallId).catch(() => undefined);
      void closeAll("maximum_duration");
    }, phoneSettings.maxCallMinutes * 60_000);
    if (phoneSettings.maxCallMinutes > 1) warningTimer = setTimeout(() => {
      live?.send({ type: "session.commentary.append", delegation_id: null, content: "Ενημέρωσε σύντομα ότι η κλήση θα ολοκληρωθεί σε ένα λεπτό λόγω του ορίου διάρκειας." });
    }, (phoneSettings.maxCallMinutes - 1) * 60_000);
  };
  void initialize().catch((error: unknown) => { log("phone_session_start_failed", { stage: initializationStage, errorType: safeDiagnosticCode(error instanceof Error ? error.name : typeof error) }); void closeAll("start_failed", true); });

  return {
    pushAudio(audio: string, level: number, options: { echoLikely?: boolean; frameDurationMs?: number } = {}) {
      if (closed) return;
      inputPackets += 1;
      if (inputPackets === 1) log("openai_first_input_audio_append", { queued: !ready });
      const now = Date.now(); const frameMs = Math.max(5, Math.min(100, options.frameDurationMs ?? 20));
      const threshold = Math.max(900, noiseFloor * 3);
      const voiced = !options.echoLikely && level >= threshold;
      if (!callerSpeaking) {
        if (voiced) {
          if (!speechCandidateFrames) speechCandidateAt = now;
          speechCandidateFrames += 1; speechCandidateMs += frameMs;
          if (speechCandidateFrames >= 2 && speechCandidateMs >= 60) {
            callerSpeaking = true; quietMs = 0;
            if (greetingFirstAudioAt === null) {
              ownerSpokeBeforeGreeting = true;
              if (greetingFallbackTimer) clearTimeout(greetingFallbackTimer);
              log("caller_first_speech_before_greeting", { caller_first_speech_at: new Date(speechCandidateAt).toISOString() });
              lifecycle("LISTENING", "owner_speech_preempted_greeting");
            }
            const turn = startTurn();
            log("caller_speech_started", { turnId: turn.id, inputPackets, firstDetectedAt: new Date(speechCandidateAt).toISOString(), reliableDetectionDelayMs: now - speechCandidateAt });
            if (ready && (now - assistantAudioAt < 800 || transport.isPlaybackActive?.())) {
              const cleared = transport.clearPlayback();
              const providerClearAt = cleared?.providerClearSentAt ?? null;
              if (!activeResponseId) activeResponseId = `bridge-response-${++responseSequence}`;
              turn.interruptedResponseId = activeResponseId;
              interruptedResponseIds.add(activeResponseId);
              quarantinedResponseId = activeResponseId;
              transition("INTERRUPTING", "caller_barge_in", turn.id);
              lifecycle("INTERRUPTED", "caller_barge_in");
              log("barge_in_started", { turnId: turn.id, interrupted_response_id: activeResponseId });
              log("interrupted_response_id", { turnId: turn.id, interrupted_response_id: activeResponseId });
              log("caller_barge_in", {
                caller_speech_first_detected_at: new Date(speechCandidateAt).toISOString(),
                provider_playback_clear_sent_at: providerClearAt === null ? null : new Date(providerClearAt).toISOString(),
                local_output_queue_cleared_at: cleared ? new Date(cleared.localOutputQueueClearedAt).toISOString() : null,
                last_old_assistant_audio_sent_at: cleared?.lastOldAssistantAudioSentAt ? new Date(cleared.lastOldAssistantAudioSentAt).toISOString() : null,
                interruption_latency_ms: providerClearAt === null ? null : providerClearAt - speechCandidateAt,
                discardedLocalBytes: cleared?.discardedLocalBytes ?? 0,
              });
              live?.send({ type: "session.instructions.append", delegation_id: null, event_id: `interrupt-${randomUUID()}`, content: "Ο καλών άρχισε να μιλά. Σταμάτα αμέσως την προηγούμενη φράση σου, άκου τον και απάντησε στη νέα του σκέψη. Μην ολοκληρώνεις την παλιά πρόταση." });
            } else if (phase === "SPEAKING") transition("LISTENING", "caller_started_after_playback", turn.id);
          }
        } else {
          speechCandidateFrames = 0; speechCandidateMs = 0;
          if (!options.echoLikely) noiseFloor = Math.min(450, noiseFloor * 0.98 + level * 0.02);
        }
      } else if (voiced) quietMs = 0;
      else if ((quietMs += frameMs) >= 200) {
        callerSpeaking = false; speechCandidateFrames = 0; speechCandidateMs = 0;
        const turn = currentTurn;
        if (turn) {
          if (!turn.committed) {
            turn.committed = true;
            log("caller_turn_committed", { turnId: turn.id, transcriptAvailable: Boolean(turn.transcript.trim()), transcriptEndMs: turn.transcriptEndMs, source: "local_vad" });
          }
          if (turn.interruptedResponseId) {
            if (!turn.runStarted) transition("LISTENING_FOR_INTERRUPTION_TURN", "caller_speech_stopped", turn.id);
            turn.watchdog = setTimeout(() => {
              if (closed || turn.resumed || currentTurn !== turn) return;
              log("phone_resume_watchdog_fault", { turnId: turn.id, phase, runStarted: turn.runStarted, commentaryAccepted: turn.commentaryEndMs !== null, old_response_delta_discarded_count: turn.discardedDeltas });
              // Recovery is listen-only. Keep stale audio quarantined until a
              // later, causally identifiable assistant turn starts.
              transition("LISTENING", "resume_watchdog_listen_only", turn.id);
            }, 12_000);
            turn.watchdog.unref?.();
          }
          scheduleCommittedTurn?.(turn);
          tryResumeOutput?.(turn);
        }
        log("caller_speech_stopped", { turnId: turn?.id ?? null, inputPackets, outputSuppressed });
      }
      if (ready) live?.send({ type: "session.input_audio.append", audio });
      else if (queuedAudio.length < 300) queuedAudio.push(audio);
    },
    stop(reason = "remote_hangup") { void closeAll(reason); },
    fail(reason: string) { void closeAll(reason, true); },
  };
}
