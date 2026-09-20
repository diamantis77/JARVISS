import type { ProviderCapability } from "../../types";

export const GOOGLE_IDENTITY_SCOPES = ["openid", "email"] as const;
export const GOOGLE_GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send"] as const;
export const GOOGLE_CALENDAR_SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.events.freebusy"] as const;

export function scopesFor(capability: ProviderCapability) {
  return [...GOOGLE_IDENTITY_SCOPES, ...(capability === "gmail" ? GOOGLE_GMAIL_SCOPES : GOOGLE_CALENDAR_SCOPES)];
}
export function hasCapability(scopes: string[], capability: ProviderCapability) {
  const required = capability === "gmail" ? GOOGLE_GMAIL_SCOPES : GOOGLE_CALENDAR_SCOPES;
  return required.every((scope) => scopes.includes(scope));
}
