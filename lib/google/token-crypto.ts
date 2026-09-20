import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type EncryptedPayload = { v: 1; alg: "A256GCM"; iv: string; tag: string; data: string };

function key() {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("Google token encryption is not configured");
  const value = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (value.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes");
  return value;
}

export function encryptToken(token: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv); cipher.setAAD(Buffer.from("jarvis-google-token:v1"));
  const data = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const payload: EncryptedPayload = { v: 1, alg: "A256GCM", iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url"), data: data.toString("base64url") };
  return `jgt1.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

export function decryptToken(value: string) {
  if (!value.startsWith("jgt1.")) throw new Error("Unsupported encrypted token version");
  const payload = JSON.parse(Buffer.from(value.slice(5), "base64url").toString("utf8")) as EncryptedPayload;
  if (payload.v !== 1 || payload.alg !== "A256GCM") throw new Error("Unsupported encrypted token payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(payload.iv, "base64url")); decipher.setAAD(Buffer.from("jarvis-google-token:v1")); decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(payload.data, "base64url")), decipher.final()]).toString("utf8");
}
