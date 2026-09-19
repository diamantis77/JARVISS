import type { FunctionTool } from "openai/resources/responses/responses";

export interface AiToolCall { callId: string; name: string; arguments: string }
export interface AiToolOutput { callId: string; output: string }
export interface AiTurnRequest { instructions: string; input?: string; previousResponseId?: string; toolOutputs?: AiToolOutput[]; tools: FunctionTool[] }
export interface AiTurnResult { responseId: string; text: string; toolCalls: AiToolCall[] }
export interface JarvisAiProvider { respond(request: AiTurnRequest): Promise<AiTurnResult> }
