import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildActivationGreeting, isExplicitConversationEnd, matchesSplitWakePhrase, matchesWakePhrase } from "../lib/voice/wake-word";

describe("wake word and conversation lifecycle", () => {
  it("accepts Hey Jarvis while requiring high confidence for bare Jarvis", () => {
    expect(matchesWakePhrase("Hey Jarvis", 0.7)).toBe(true);
    expect(matchesWakePhrase("Χέι Τζάρβις", 0.7)).toBe(true);
    expect(matchesWakePhrase("Έι Τζάρβις", 0.4)).toBe(true);
    expect(matchesWakePhrase("Hey Jervis", 0.4)).toBe(true);
    expect(matchesWakePhrase("Hey Travis", 0.8)).toBe(true);
    expect(matchesWakePhrase("Hey Travis", 0.5)).toBe(false);
    expect(matchesWakePhrase("Jarvis", 0.89)).toBe(false);
    expect(matchesWakePhrase("Jarvis", 0.95)).toBe(true);
    expect(matchesWakePhrase("we discussed Jarvis yesterday", 0.99)).toBe(false);
  });

  it("accepts a fragmented on-device Hey Jarvis result without accepting unrelated speech", () => {
    expect(matchesSplitWakePhrase("Hey", "Jarvis", .28, .31)).toBe(true);
    expect(matchesSplitWakePhrase("Hey", "Jarvis, τι έγινε σήμερα", 0, .22)).toBe(true);
    expect(matchesSplitWakePhrase("I said hey", "Jarvis", .9, .9)).toBe(false);
    expect(matchesSplitWakePhrase("Hey", "someone", .9, .9)).toBe(false);
  });

  it("recognizes only explicit end-of-conversation phrases", () => {
    expect(isExplicitConversationEnd("Ευχαριστώ Jarvis")).toBe(true);
    expect(isExplicitConversationEnd("Τερμάτισε τη συνομιλία")).toBe(true);
    expect(isExplicitConversationEnd("Ευχαριστώ Jarvis, αυτό ήταν.")).toBe(true);
    expect(isExplicitConversationEnd("Αυτό ήταν")).toBe(true);
    expect(isExplicitConversationEnd("Μπορείς να κλείσεις")).toBe(true);
    expect(isExplicitConversationEnd("Ευχαριστώ, συνέχισε με τα leads")).toBe(false);
  });

  it("uses Europe/Athens-aware greetings without greeting spam", () => {
    const first = buildActivationGreeting({ now: new Date("2026-09-21T06:00:00.000Z"), timezone: "Europe/Athens", formOfAddress: "κύριε Διαμαντή" });
    expect(first.text).toContain("Καλημέρα κύριε Διαμαντή");
    const repeated = buildActivationGreeting({ now: new Date("2026-09-21T06:15:00.000Z"), timezone: "Europe/Athens", formOfAddress: "κύριε Διαμαντή", lastGreetingKey: first.greetingKey });
    expect(repeated.text).toBe("Σας ακούω, κύριε Διαμαντή.");
  });

  it("keeps wake detection local and separate from the OpenAI session", () => {
    const source = readFileSync(new URL("../lib/voice/browser-wake-word-provider.ts", import.meta.url), "utf8");
    expect(source).toContain("processLocally");
    expect(source).toContain("Constructor.available");
    expect(source).toContain("Constructor.install");
    expect(source).toContain("recognition.maxAlternatives = 5");
    expect(source).toContain("recognition.start(wakeTrack)");
    expect(source).toContain("recognition.continuous = true");
    expect(source).toContain("recognition.onspeechend");
    expect(source).not.toContain("passesCalibration");
    expect(source).toContain('"en-US"');
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("OPENAI_API_KEY");
    expect(source).not.toContain("/api/voice/session");
  });
});
