import { describe, expect, it } from "vitest";
import { commandSchema } from "../lib/validation";
describe("command validation", () => { it("rejects empty commands", () => expect(commandSchema.safeParse({ command: " " }).success).toBe(false)); });
