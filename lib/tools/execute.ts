import { isToolName, mayExecute, toolRegistry, type ToolName, type ToolRuntimeContext } from "./registry";

export interface ExecuteToolOptions { approved?: boolean; context?: ToolRuntimeContext }

export async function executeTool(name: ToolName | string, input: unknown, options: ExecuteToolOptions | boolean = {}) {
  if (!isToolName(name)) return { ok: false as const, reason: "Unknown tool" };
  const tool = toolRegistry[name];
  const resolved = typeof options === "boolean" ? { approved: options } : options;
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) return { ok: false as const, reason: "Invalid tool input", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) };
  if (!mayExecute(tool.permission, Boolean(resolved.approved))) return { ok: false as const, reason: "Approval required" };
  if (!resolved.context) return { ok: false as const, reason: "Tool context unavailable" };
  try {
    const handler = tool.execute as (context: ToolRuntimeContext, data: unknown) => Promise<unknown>;
    const value = await handler(resolved.context, parsed.data);
    const output = tool.output.safeParse(value);
    if (!output.success) return { ok: false as const, reason: "Invalid tool output" };
    return { ok: true as const, value: output.data };
  } catch {
    return { ok: false as const, reason: "Tool execution failed" };
  }
}
