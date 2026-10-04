"use client";
import type { WakeWordConfig, WakeWordProvider, WakeWordSnapshot } from "./wake-word";
import { isWakeGreetingSegment, matchesSplitWakePhrase, matchesWakePhrase } from "./wake-word";
import { BrowserMicrophoneMeter } from "./browser-audio";

type RecognitionAlternative = { transcript: string; confidence: number };
type RecognitionResult = { readonly isFinal: boolean; readonly length: number; [index: number]: RecognitionAlternative };
type RecognitionEvent = Event & { resultIndex: number; results: { readonly length: number; [index: number]: RecognitionResult } };
type RecognitionErrorEvent = Event & { error?: string };
type Recognition = EventTarget & { continuous: boolean; interimResults: boolean; maxAlternatives: number; lang: string; processLocally?: boolean; start(audioTrack?: MediaStreamTrack): void; stop(): void; abort(): void; onstart: (() => void) | null; onspeechstart: (() => void) | null; onspeechend: (() => void) | null; onresult: ((event: RecognitionEvent) => void) | null; onerror: ((event: RecognitionErrorEvent) => void) | null; onend: (() => void) | null };
type RecognitionAvailability = "available" | "downloadable" | "downloading" | "unavailable";
type RecognitionOptions = { langs: string[]; processLocally: true; quality?: "dictation" | "command" };
type RecognitionConstructor = {
  new(): Recognition;
  available?(options: RecognitionOptions): Promise<RecognitionAvailability>;
  install?(options: RecognitionOptions): Promise<boolean>;
};

type Callbacks = {
  onState(snapshot: WakeWordSnapshot): void;
  onDetected(transcript: string, confidence: number): void | Promise<void>;
  onRecognitionResult?(transcript: string, confidence: number, isFinal: boolean): void;
  onDiagnostic?(event: "pack-dictation" | "pack-command" | "pack-unverified" | "started" | "speech" | "result" | "no-speech" | "ended"): void;
};

export class BrowserLocalWakeWordProvider implements WakeWordProvider {
  private snapshot: WakeWordSnapshot = { state: "idle", inputLevel: 0, confidence: null, lastTranscript: "", error: null };
  private recognition: Recognition | null = null;
  private meter = new BrowserMicrophoneMeter();
  private frame = 0;
  private stopped = true;
  private detecting = false;
  private detectionTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private resultWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTranscript = "";
  private pendingConfidence = 0;
  private greetingSegment: { transcript: string; confidence: number; index: number; at: number } | null = null;
  private speechCyclesWithoutResult = 0;

  constructor(private readonly callbacks: Callbacks) {}
  getState() { return this.snapshot; }
  private update(patch: Partial<WakeWordSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.callbacks.onState(this.snapshot); }
  private withTimeout<T>(promise: Promise<T>, timeoutMs = 8_000) {
    return new Promise<T | null>((resolve, reject) => {
      const timer = window.setTimeout(() => resolve(null), timeoutMs);
      promise.then((value) => { window.clearTimeout(timer); resolve(value); }, (error) => { window.clearTimeout(timer); reject(error); });
    });
  }

  private async resolveLocalLanguage(Constructor: RecognitionConstructor, preferredLanguage: string) {
    // The wake phrase is English even when the conversation locale is Greek.
    const candidates = [...new Set(["en-US", preferredLanguage || "el-GR"])];
    if (!Constructor.available) { this.callbacks.onDiagnostic?.("pack-unverified"); return candidates[0]; }
    let receivedAvailability = false;
    for (const language of candidates) {
      for (const quality of ["dictation", "command"] as const) {
        try {
          const options: RecognitionOptions = { langs: [language], processLocally: true, quality };
          const availability = await this.withTimeout(Constructor.available(options));
          if (!availability) continue;
          receivedAvailability = true;
          if (availability === "available") { this.callbacks.onDiagnostic?.(quality === "dictation" ? "pack-dictation" : "pack-command"); return language; }
          if ((availability === "downloadable" || availability === "downloading") && Constructor.install) {
            const installed = await this.withTimeout(Constructor.install(options), 15_000);
            if (installed) { this.callbacks.onDiagnostic?.(quality === "dictation" ? "pack-dictation" : "pack-command"); return language; }
          }
        } catch {
          // Experimental quality checks can throw; retain the on-device fallback.
        }
      }
    }
    if (!receivedAvailability) this.callbacks.onDiagnostic?.("pack-unverified");
    return receivedAvailability ? null : candidates[0];
  }

  async start(config: WakeWordConfig) {
    if (!this.stopped) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return this.fail("Το Wake Mode απαιτεί ασφαλές browser context και άδεια μικροφώνου.");
    const browser = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Constructor) return this.fail("Ο browser δεν υποστηρίζει τοπικό wake-word recognition. Η χειροκίνητη έναρξη φωνής παραμένει διαθέσιμη.");
    const recognition = new Constructor();
    if (!("processLocally" in recognition)) return this.fail("Ο browser δεν εγγυάται on-device αναγνώριση. Για ιδιωτικότητα δεν ενεργοποιήθηκε cloud wake detection.");
    this.stopped = false; this.detecting = false; this.pendingTranscript = ""; this.pendingConfidence = 0; this.greetingSegment = null; this.speechCyclesWithoutResult = 0; this.update({ state: "wake_initializing", error: null, inputLevel: 0, confidence: null, lastTranscript: "" });
    try {
      const recognitionLanguage = await this.resolveLocalLanguage(Constructor, config.language);
      if (!recognitionLanguage) return this.fail("Δεν υπάρχει διαθέσιμο on-device πακέτο για το «Hey Jarvis». Δοκιμάστε ενημερωμένο Chrome ή χρησιμοποιήστε το κουμπί μικροφώνου.");
      const wakeStream = await this.meter.start(config.microphoneDeviceId);
      const wakeTrack = wakeStream.getAudioTracks().find((track) => track.readyState === "live");
      if (!wakeTrack) return this.fail("Το επιλεγμένο μικρόφωνο δεν παρέχει ενεργό ήχο για το Wake Mode.");
      // Keep recognition on the same live track that drives the visible meter.
      // A separate implicit microphone capture can show speech activity in the UI
      // while the recognizer receives no usable audio (notably in embedded browsers).
      const startRecognition = () => recognition.start(wakeTrack);
      this.startMeter();
      recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 5; recognition.lang = recognitionLanguage; recognition.processLocally = true;
      recognition.onstart = () => { if (!this.stopped && !this.detecting) { this.callbacks.onDiagnostic?.("started"); this.update({ state: "wake_waiting" }); } };
      recognition.onspeechstart = () => {
        if (this.stopped || this.detecting) return;
        this.callbacks.onDiagnostic?.("speech");
        this.speechCyclesWithoutResult += 1;
      };
      // Do not call stop() at speechend: some on-device implementations deliver
      // the first result only after the end-of-speech event. Continuous local
      // recognition keeps waiting for the next wake phrase without capture churn.
      recognition.onspeechend = () => {
        if (this.stopped || this.detecting || this.speechCyclesWithoutResult < 3) return;
        if (this.resultWatchdogTimer) clearTimeout(this.resultWatchdogTimer);
        this.resultWatchdogTimer = setTimeout(() => {
          this.resultWatchdogTimer = null;
          if (!this.stopped && !this.detecting && this.speechCyclesWithoutResult >= 3)
            void this.fail("Ο browser ακούει ομιλία αλλά δεν επιστρέφει αναγνωρισμένες λέξεις. Δοκιμάστε τον JARVIS σε εξωτερικό Chrome ή χρησιμοποιήστε το χειροκίνητο μικρόφωνο.");
        }, 2_500);
      };
      recognition.onresult = (event) => {
        if (this.detecting || this.stopped) return;
        this.callbacks.onDiagnostic?.("result");
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          const alternatives = Array.from({ length: Math.min(result?.length ?? 0, recognition.maxAlternatives) }, (_, alternativeIndex) => result?.[alternativeIndex]).filter((alternative): alternative is RecognitionAlternative => Boolean(alternative));
          if (alternatives.length) {
            this.speechCyclesWithoutResult = 0;
            if (this.resultWatchdogTimer) clearTimeout(this.resultWatchdogTimer);
            this.resultWatchdogTimer = null;
          }
          if (result.isFinal && alternatives[0]) this.callbacks.onRecognitionResult?.(alternatives[0].transcript, alternatives[0].confidence, true);
          const greeting = this.greetingSegment;
          const recentGreeting = greeting && index > greeting.index && performance.now() - greeting.at < 2_500 ? greeting : null;
          const alternative = alternatives.filter((candidate) => matchesWakePhrase(candidate.transcript, candidate.confidence, config.sensitivity) || Boolean(recentGreeting && matchesSplitWakePhrase(recentGreeting.transcript, candidate.transcript, recentGreeting.confidence, candidate.confidence, config.sensitivity))).sort((left, right) => right.confidence - left.confidence)[0];
          if (alternative) {
            this.pendingTranscript = recentGreeting && !matchesWakePhrase(alternative.transcript, alternative.confidence, config.sensitivity) ? `${recentGreeting.transcript} ${alternative.transcript}` : alternative.transcript;
            this.pendingConfidence = alternative.confidence;
            this.update({ confidence: alternative.confidence, lastTranscript: alternative.transcript });
            if (this.detectionTimer) clearTimeout(this.detectionTimer);
            // A short grace window keeps "Hey Jarvis, <command>" in one local result.
            this.detectionTimer = setTimeout(() => void this.finishDetection(), result.isFinal ? 180 : 650);
            return;
          }
          if (result.isFinal) {
            const prefix = alternatives.find((candidate) => isWakeGreetingSegment(candidate.transcript));
            if (prefix) this.greetingSegment = { transcript: prefix.transcript, confidence: prefix.confidence, index, at: performance.now() };
            else if (this.greetingSegment && performance.now() - this.greetingSegment.at >= 2_500) this.greetingSegment = null;
          }
        }
      };
      recognition.onerror = (event) => {
        if (event.error === "no-speech") this.callbacks.onDiagnostic?.("no-speech");
        if (this.stopped || event.error === "no-speech" || event.error === "aborted") return;
        const message = event.error === "not-allowed" || event.error === "service-not-allowed"
          ? "Η άδεια μικροφώνου για Wake Mode απορρίφθηκε."
          : event.error === "audio-capture"
            ? "Δεν βρέθηκε διαθέσιμο μικρόφωνο για το Wake Mode."
            : event.error === "language-not-supported" || event.error === "language-unavailable"
              ? "Το on-device πακέτο αναγνώρισης για το «Hey Jarvis» δεν είναι διαθέσιμο σε αυτόν τον browser."
              : "Η τοπική αναγνώριση wake phrase δεν είναι διαθέσιμη σε αυτόν τον browser.";
        void this.fail(message);
      };
      recognition.onend = () => {
        if (this.stopped || this.detecting) return;
        this.callbacks.onDiagnostic?.("ended");
        if (this.speechCyclesWithoutResult >= 3) { void this.fail("Ο browser ακούει ομιλία αλλά δεν επιστρέφει αναγνωρισμένες λέξεις. Δοκιμάστε τον JARVIS σε εξωτερικό Chrome ή χρησιμοποιήστε το χειροκίνητο μικρόφωνο."); return; }
        this.update({ state: "wake_initializing" });
        if (this.restartTimer) clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          if (this.stopped || this.detecting || this.recognition !== recognition) return;
          try { startRecognition(); } catch { void this.fail("Το Wake Mode δεν μπόρεσε να επανεκκινήσει."); }
        }, 250);
      };
      this.recognition = recognition; startRecognition();
    } catch (error) {
      const message = error instanceof DOMException && error.name === "NotAllowedError" ? "Η άδεια μικροφώνου για Wake Mode απορρίφθηκε." : error instanceof DOMException && error.name === "OverconstrainedError" ? "Το επιλεγμένο μικρόφωνο δεν είναι διαθέσιμο." : "Το Wake Mode δεν μπόρεσε να ξεκινήσει.";
      await this.fail(message);
    }
  }

  private startMeter() {
    const tick = () => {
      if (this.stopped) return;
      const level = this.meter.read().level;
      this.update({ inputLevel: level }); this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private async finishDetection() {
    if (this.detecting || this.stopped || !this.pendingTranscript) return;
    this.detecting = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.update({ state: "wake_detected", confidence: this.pendingConfidence, lastTranscript: this.pendingTranscript });
    try { await this.callbacks.onDetected(this.pendingTranscript, this.pendingConfidence); }
    catch { await this.fail("Η φωνητική ενεργοποίηση απέτυχε. Χρησιμοποιήστε το κουμπί μικροφώνου ή δοκιμάστε ξανά το Wake Mode."); }
  }

  async handoffStream() {
    const stream = this.meter.detachStream();
    await this.meter.stop(false);
    return stream;
  }

  private async fail(message: string) { await this.cleanup(); this.update({ state: "error", error: message, inputLevel: 0 }); }
  async stop(options: { preserveStream?: boolean } = {}) { await this.cleanupWithOptions(Boolean(options.preserveStream)); this.update({ state: "idle", inputLevel: 0, confidence: null, lastTranscript: "", error: null }); }
  private async cleanup() {
    return this.cleanupWithOptions(false);
  }
  private async cleanupWithOptions(preserveStream: boolean) {
    this.stopped = true; if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; if (this.detectionTimer) clearTimeout(this.detectionTimer); this.detectionTimer = null;
    if (this.restartTimer) clearTimeout(this.restartTimer); this.restartTimer = null;
    if (this.resultWatchdogTimer) clearTimeout(this.resultWatchdogTimer); this.resultWatchdogTimer = null;
    if (this.recognition) { this.recognition.onstart = null; this.recognition.onspeechstart = null; this.recognition.onspeechend = null; this.recognition.onend = null; this.recognition.onerror = null; this.recognition.onresult = null; try { this.recognition.abort(); } catch {} this.recognition = null; }
    this.greetingSegment = null;
    await this.meter.stop(!preserveStream);
  }
}
