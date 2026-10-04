import { config } from "dotenv";
import { chatCompletionAdapter } from "../lib/ai/providers/chat-completions";
import type { AskAIRequest } from "../lib/ai/router-types";

config({ path: ".env.local", quiet: true });

async function main() {
  const provider = chatCompletionAdapter("gemini");
  if (!provider.configured) { console.log("GEMINI_CONFIGURED=no"); process.exitCode = 1; return; }
  const request: AskAIRequest = {
    taskType: "tool_calling",
    messages: [{ role: "user", content: "Call read_status once, then answer OK." }],
    tools: [{ type: "function", name: "read_status", description: "Return a fixed harmless status", parameters: { type: "object", properties: {}, additionalProperties: false }, strict: false }],
  };
  const first = await provider.ask(request, AbortSignal.timeout(20_000));
  const call = first.toolCalls[0];
  console.log(`FIRST_TOOL_CALL=${Boolean(call)} SIGNATURE_PRESENT=${Boolean(call?.thoughtSignature)}`);
  if (!call) { process.exitCode = 1; return; }
  const second = await provider.ask({ ...request, messages: [
    ...request.messages,
    { role: "assistant", content: first.content, toolCalls: first.toolCalls },
    { role: "tool", toolCallId: call.callId, content: JSON.stringify({ status: "ok" }) },
  ] }, AbortSignal.timeout(20_000));
  console.log(`SECOND_TURN_OK=${Boolean(second.content.trim())} SECOND_TOOL_CALLS=${second.toolCalls.length}`);
  if (!second.content.trim()) process.exitCode = 1;
}

main().catch((error: unknown) => { const safe = error && typeof error === "object" && "reason" in error ? String(error.reason) : error instanceof Error ? error.name : "unknown"; const status = error && typeof error === "object" && "status" in error ? String(error.status) : "unknown"; console.log(`SAFE_TEST_ERROR=${safe} STATUS=${status}`); process.exitCode = 1; });
