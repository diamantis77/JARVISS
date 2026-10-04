import type { FunctionTool } from "openai/resources/responses/responses";
import type { z } from "zod";

export type AiProviderName = "groq" | "gemini" | "openrouter" | "openai";
export type AiTaskType = "general" | "chat" | "email" | "crm" | "extraction" | "classification" | "research" | "reasoning" | "coding" | "vision" | "summarization" | "tool_calling";
export type AiFailureReason = "RATE_LIMIT" | "TIMEOUT" | "NETWORK" | "PROVIDER_ERROR" | "AUTH" | "INVALID_REQUEST" | "SAFETY_REFUSAL" | "INVALID_STRUCTURED_OUTPUT" | "EMPTY_OUTPUT" | "UNSUPPORTED" | "UNKNOWN";
export interface AiToolCall { callId: string; name: string; arguments: string; thoughtSignature?: string }
export interface AiMessage { role: "system" | "user" | "assistant" | "tool"; content: string; toolCallId?: string; toolCalls?: AiToolCall[] }
export interface AiCapabilities { supportsText: boolean; supportsVision: boolean; supportsTools: boolean; supportsStructuredOutput: boolean; supportsReasoning: boolean; supportsStreaming: boolean }
export interface AiAttempt { provider: AiProviderName; model: string; success: boolean; reason?: AiFailureReason; latencyMs: number }
export interface AiUsage { inputTokens?: number; outputTokens?: number; totalTokens?: number }
export interface AskAIRequest {
  messages: AiMessage[];
  taskType: AiTaskType;
  tools?: FunctionTool[];
  responseFormat?: { type: "json"; name?: string; schema?: Record<string, unknown>; validator?: z.ZodTypeAny };
  images?: Array<{ dataUrl: string }>;
  temperature?: number;
  maxTokens?: number;
  preferredModel?: string;
  metadata?: { requestId?: string; runId?: string };
}
export interface AskAIResult {
  content: string;
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  fallbackUsed: boolean;
  attempts: AiAttempt[];
  usage: AiUsage;
  finishReason: string | null;
  toolCalls: AiToolCall[];
  parsed?: unknown;
}
export interface AiAdapter { name: AiProviderName; model: string; capabilities: AiCapabilities; configured: boolean; ask(request: AskAIRequest, signal: AbortSignal): Promise<Omit<AskAIResult, "latencyMs" | "fallbackUsed" | "attempts">> }
