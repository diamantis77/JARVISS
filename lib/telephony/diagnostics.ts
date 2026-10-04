type DiagnosticValue = string | number | boolean | null;

// Only pass allow-listed metadata here. Never pass audio, transcripts, tokens,
// credentials, phone numbers, or provider-supplied free-form messages.
export function logPhoneDiagnostic(event: string, fields: Record<string, DiagnosticValue>) {
  console.info(JSON.stringify({ service: "phone_media", event, at: new Date().toISOString(), ...fields }));
}

export function safeDiagnosticCode(value: unknown) {
  if (typeof value !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/i.test(value)) return "unknown";
  return value;
}
