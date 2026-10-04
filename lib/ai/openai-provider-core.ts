import OpenAI from "openai";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "./provider";

/** Server-runtime implementation shared by Next routes and the standalone media gateway. */
export class OpenAIJarvisProviderCore implements JarvisAiProvider {
  private readonly client: OpenAI;
  constructor(apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_MODEL ?? "gpt-5") {
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    this.client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async respond(request: AiTurnRequest): Promise<AiTurnResult> {
    const input: string | ResponseInputItem[] = request.toolOutputs?.length
      ? request.toolOutputs.map(({ callId, output }) => ({ type: "function_call_output" as const, call_id: callId, output }))
      : request.input ?? "";
    const response = await this.client.responses.create({ model: this.model, instructions: request.instructions, input, tools: request.tools, previous_response_id: request.previousResponseId, store: true });
    return {
      responseId: response.id,
      text: response.output_text,
      toolCalls: response.output.filter((item) => item.type === "function_call").map((item) => ({ callId: item.call_id, name: item.name, arguments: item.arguments })),
    };
  }
}
