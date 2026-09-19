import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseLeadRepository } from "../lib/repositories/supabase/lead-repository";
import { SupabaseEvidenceRepository } from "../lib/repositories/supabase/evidence-repository";

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
  it("refuses to persist evidence for a lead outside the authenticated user scope", async () => {
    let insertCalled = false;
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: null, error: null }), insert: () => { insertCalled = true; return query; }, single: async () => ({ data: null, error: null }) };
    const db = { from: () => query } as unknown as SupabaseClient;
    const repository = new SupabaseEvidenceRepository(db, "user-a");
    await expect(repository.addEvidence({ leadId: "lead-owned-by-user-b", sourceId: "source-b", fieldName: "website", valueText: "https://example.com", confidence: "verified", evidenceSummary: "No cross-user write", verifiedAt: null })).rejects.toThrow("Lead not found");
    expect(insertCalled).toBe(false);
  });
});
