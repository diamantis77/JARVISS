import type { PhoneNotificationSettings } from "@/types";

export const DEFAULT_PHONE_SETTINGS: PhoneNotificationSettings = {
  enabled: false,
  allowedStart: "09:00:00",
  allowedEnd: "23:00:00",
  outsideHours: "never",
  customerReplyOutsideHours: false,
  morningBrief: false,
  hotLeadReply: false,
  importantCustomerReply: false,
  meetingSoon: false,
  criticalProviderFailure: false,
  highValueDeal: false,
  customPriorityEvent: false,
  maxCallMinutes: 10,
};

function minutes(value: string) { const [hours = "0", mins = "0"] = value.split(":"); return Number(hours) * 60 + Number(mins); }

export function isWithinPhoneWindow(settings: PhoneNotificationSettings, timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const current = Number(parts.find((part) => part.type === "hour")?.value ?? 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const start = minutes(settings.allowedStart);
  const end = minutes(settings.allowedEnd);
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

export function canPlacePhoneCall(settings: PhoneNotificationSettings, timezone: string, urgent: boolean, now = new Date(), verifiedCustomerReply = false) {
  if (!settings.enabled) return { allowed: false, reason: "Phone notifications are disabled." };
  if (isWithinPhoneWindow(settings, timezone, now)) return { allowed: true, reason: null };
  if (verifiedCustomerReply && settings.customerReplyOutsideHours && settings.importantCustomerReply) return { allowed: true, reason: null };
  if (urgent && settings.outsideHours === "urgent_only") return { allowed: true, reason: null };
  return { allowed: false, reason: "The call is outside the configured calling window." };
}
