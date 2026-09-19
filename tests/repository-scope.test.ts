import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLeadRepository } from "../lib/repositories/supabase/lead-repository";

describe("Supabase repository user scoping", () => {
  it("always applies the authenticated user ID before reading a lead", async () => {
    const filters: Array<[string, string]> = [];
    const query = { select: () => query, eq: (column: string, value: string) => { filters.push([column, value]); return query; }, maybeSingle: async () => ({ data: null, error: null }) };
    const db = { from: () => query } as unknown as SupabaseClient;
    const repository = new SupabaseLeadRepository(db, "user-a");
    const result = await repository.getById("lead-owned-by-user-b");
    expect(result).toBeNull();
    expect(filters).toContainEqual(["user_id", "user-a"]);
    expect(filters).toContainEqual(["id", "lead-owned-by-user-b"]);
  });
});
