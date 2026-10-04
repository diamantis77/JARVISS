import type { FunctionTool } from "openai/resources/responses/responses";

export interface AiToolCall { callId: string; name: string; arguments: string }
export interface AiToolOutput { callId: string; output: string }
export interface AiTurnRequest { instructions: string; input?: string; previousResponseId?: string; toolOutputs?: AiToolOutput[]; tools: FunctionTool[] }
export interface AiTurnResult { responseId: string; text: string; toolCalls: AiToolCall[]; routing?: { provider: string; model: string; latencyMs: number; fallbackUsed: boolean; attempts: Array<{ provider: string; model: string; success: boolean; reason?: string; latencyMs: number }> } }
export interface JarvisAiProvider { respond(request: AiTurnRequest): Promise<AiTurnResult> }
