import { describe, expect, it } from "vitest";
import { JARVIS_INSTRUCTIONS_V2 } from "../lib/ai/instructions/v2";
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE, formatDateTime, tr } from "../lib/i18n";
import { VOICE_PRESENTATION_INSTRUCTIONS } from "../lib/voice/instructions";
import { createDemoRepositories } from "../lib/repositories/demo";

describe("Greek-first localization", () => {
  it("uses Greek and Athens as the application defaults", () => {
    expect(DEFAULT_LOCALE).toBe("el-GR");
    expect(DEFAULT_TIMEZONE).toBe("Europe/Athens");
    expect(tr("Settings")).toBe("Ρυθμίσεις");
  });

  it("falls back to the English key when a locale entry is absent", () => {
    expect(tr("Settings", {}, "en")).toBe("Settings");
    expect(tr("Untranslated technical identifier")).toBe("Untranslated technical identifier");
  });

  it("formats timestamps with Greek locale and Athens time", () => {
    const formatted = formatDateTime("2026-09-21T15:30:00Z");
    expect(formatted).toMatch(/21\/9\/(?:20)?26/);
    expect(formatted).toContain("6:30 μ.μ.");
  });

  it("instructs both text and voice providers to answer primarily in Greek", () => {
    expect(JARVIS_INSTRUCTIONS_V2).toContain("Greek is the default response language");
    expect(JARVIS_INSTRUCTIONS_V2).toContain("el-GR");
    expect(VOICE_PRESENTATION_INSTRUCTIONS).toContain("Μίλα φυσικά ελληνικά");
    expect(VOICE_PRESENTATION_INSTRUCTIONS).toContain("καθαρή προφορά");
  });

  it("creates new demo settings with the Greek locale", async () => {
    expect((await createDemoRepositories().settings.get()).defaultLanguage).toBe("el-GR");
  });
});
