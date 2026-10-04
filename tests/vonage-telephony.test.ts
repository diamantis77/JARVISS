import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pcm16Level, resamplePcm16Le } from "../lib/telephony/audio";

const originalFetch = global.fetch;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });

describe("Vonage telephony provider", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("TELEPHONY_PROVIDER", "vonage"); vi.stubEnv("VONAGE_DEVELOPMENT_TEST_MODE", "false"); vi.stubEnv("VONAGE_API_KEY", "api-key"); vi.stubEnv("VONAGE_API_SECRET", "api-secret"); vi.stubEnv("VONAGE_APPLICATION_ID", "app-id"); vi.stubEnv("VONAGE_PRIVATE_KEY", privateKey); vi.stubEnv("VONAGE_API_SIGNATURE_SECRET", "signature-secret"); vi.stubEnv("VONAGE_PHONE_NUMBER", "+15550000001"); vi.stubEnv("JARVIS_OWNER_PHONE_NUMBER", "+15550000002"); vi.stubEnv("PUBLIC_TELEPHONY_BASE_URL", "https://jarvis.example.test"); vi.stubEnv("OPENAI_API_KEY", "openai-test"); vi.stubEnv("OPENAI_VOICE_MODEL", "gpt-live-1");
  });
  afterEach(() => { global.fetch = originalFetch; vi.unstubAllEnvs(); });

  it("selects Vonage and keeps the owner as the only outbound recipient", async () => {
    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/account/numbers")) return Response.json({ numbers: [{ msisdn: "15550000001", features: ["VOICE"] }] });
      if (init?.method === "POST") return Response.json({ uuid: "call-uuid", status: "started" });
      return Response.json({});
    }) as typeof fetch;
    const { createTelephonyProvider } = await import("../lib/telephony/provider");
    const result = await createTelephonyProvider().createOwnerCall({ phoneCallId: "phone-call", reason: "brief" });
    expect(result.providerCallId).toBe("call-uuid");
    const post = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find((call) => call[1]?.method === "POST");
    const body = JSON.parse(String(post?.[1]?.body));
    expect(body.to).toEqual([{ type: "phone", number: "15550000002" }]); expect(body.answer_url[0]).toContain("/api/telephony/vonage/answer?callId=");
  });

  it("accepts the documented test caller ID only for the configured owner in explicit development mode", async () => {
    vi.stubEnv("VONAGE_PHONE_NUMBER", "123456789"); vi.stubEnv("VONAGE_DEVELOPMENT_TEST_MODE", "true");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? Response.json({ uuid: "test-call", status: "started" }) : Response.json({}));
    global.fetch = fetchMock as typeof fetch;
    const { VonageTelephonyProvider, validateVonageConfiguration } = await import("../lib/telephony/vonage-provider");
    const { isVonageDevelopmentTestCallAllowed } = await import("../lib/telephony/config");
    expect(isVonageDevelopmentTestCallAllowed("123456789", "+15550000002")).toBe(true);
    expect(isVonageDevelopmentTestCallAllowed("123456789", "+15550000003")).toBe(false);
    expect((await validateVonageConfiguration(true)).fromNumberAuthorized).toBe(true);
    await new VonageTelephonyProvider().createOwnerCall({ phoneCallId: "phone-call", reason: "test" });
    expect(fetchMock.mock.calls.some((call) => call[0].includes("/account/numbers"))).toBe(false);
    const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
    expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ to: [{ type: "phone", number: "15550000002" }], from: { type: "phone", number: "123456789" } });
  });

  it("rejects the test caller ID without the flag, under another provider, or in production before dialing", async () => {
    vi.stubEnv("VONAGE_PHONE_NUMBER", "123456789");
    const fetchMock = vi.fn(); global.fetch = fetchMock as typeof fetch;
    const { VonageTelephonyProvider } = await import("../lib/telephony/vonage-provider");
    const { getTelephonyStatus, isVonageDevelopmentTestCallAllowed } = await import("../lib/telephony/config");
    expect(getTelephonyStatus().callerNumberConfigured).toBe(false);
    await expect(new VonageTelephonyProvider().createOwnerCall({ phoneCallId: "phone-call", reason: "test" })).rejects.toThrow("not permitted");
    vi.stubEnv("VONAGE_DEVELOPMENT_TEST_MODE", "true"); vi.stubEnv("TELEPHONY_PROVIDER", "twilio");
    expect(isVonageDevelopmentTestCallAllowed("123456789", "+15550000002")).toBe(false);
    vi.stubEnv("TELEPHONY_PROVIDER", "vonage"); vi.stubEnv("NODE_ENV", "production");
    expect(getTelephonyStatus().callerNumberConfigured).toBe(false);
    await expect(new VonageTelephonyProvider().createOwnerCall({ phoneCallId: "phone-call", reason: "test" })).rejects.toThrow("not permitted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not dial with a real caller ID absent from owned Voice numbers", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => url.includes("/account/numbers") ? Response.json({ numbers: [] }) : Response.json({}));
    global.fetch = fetchMock as typeof fetch;
    const { VonageTelephonyProvider } = await import("../lib/telephony/vonage-provider");
    await expect(new VonageTelephonyProvider().createOwnerCall({ phoneCallId: "phone-call", reason: "test" })).rejects.toThrow("not authorized");
    expect(fetchMock.mock.calls.some((call) => call[1]?.method === "POST")).toBe(false);
  });

  it("creates call-bound RS256 media authorization and rejects tampering", async () => {
    const { createVonageMediaAuthorization, validateVonageMediaAuthorization } = await import("../lib/telephony/vonage-auth");
    const token = createVonageMediaAuthorization("phone-call", "provider-call", 120);
    expect(validateVonageMediaAuthorization(`Bearer ${token}`)).toMatchObject({ provider: "vonage", audience: "jarvis-vonage-media", phoneCallId: "phone-call", providerCallId: "provider-call" });
    expect(validateVonageMediaAuthorization(`Bearer ${token.slice(0, -2)}xx`)).toBeNull();
  });

  it("resamples little-endian PCM and uses provider clear without a legacy Realtime cancel", () => {
    const input = Buffer.alloc(320); for (let index = 0; index < 160; index += 1) input.writeInt16LE(index % 2 ? 2000 : -2000, index * 2);
    expect(resamplePcm16Le(input, 16000, 24000)).toHaveLength(480); expect(pcm16Level(input)).toBeGreaterThan(1000);
    const vonageBridge = readFileSync("lib/telephony/vonage-media-bridge.ts", "utf8"); const sharedBridge = readFileSync("lib/telephony/phone-live-bridge.ts", "utf8");
    expect(vonageBridge).toContain('action: "clear"'); expect(sharedBridge).not.toContain('type: "response.cancel"');
  });

  it("builds NCCO with secure WSS L16/16k media and header authorization", () => {
    const route = readFileSync("app/api/telephony/vonage/answer/route.ts", "utf8");
    expect(route).toContain('telephonyWebSocketUrl("/api/telephony/vonage/media")'); expect(route).toContain('"content-type": "audio/l16;rate=16000"'); expect(route).toContain('authorization: { type: "custom", value: authorization }');
  });
});
