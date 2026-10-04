import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { SupabasePhoneCallRepository } from "@/lib/telephony/repository";
import { getTelephonyStatus } from "@/lib/telephony/config";
import { getSelectedTelephonyProvider } from "@/lib/telephony/config";
import { validateTelephonyProviderConfiguration } from "@/lib/telephony/provider";

const settingsSchema = z.object({
  enabled: z.boolean(),
  allowedStart: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  allowedEnd: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/),
  outsideHours: z.enum(["never", "urgent_only"]),
  customerReplyOutsideHours: z.boolean(),
  morningBrief: z.boolean(), hotLeadReply: z.boolean(), importantCustomerReply: z.boolean(), meetingSoon: z.boolean(), criticalProviderFailure: z.boolean(), highValueDeal: z.boolean(), customPriorityEvent: z.boolean(),
  maxCallMinutes: z.number().int().min(1).max(20),
});

async function context() {
  const { user } = await getAuthenticatedUser();
  if (!user) return null;
  return { user, repository: new SupabasePhoneCallRepository(createAdminClient()) };
}

export async function GET() {
  const current = await context();
  if (!current) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  try {
    const provider = getSelectedTelephonyProvider();
    const [settings, calls, providerValidation] = await Promise.all([current.repository.getSettings(current.user.id), current.repository.list(current.user.id, 12), validateTelephonyProviderConfiguration(provider)]);
    const label = provider === "vonage" ? "Vonage" : "Twilio";
    const providerError = !providerValidation.credentialsValid ? `${label} credentials could not be validated.` : !providerValidation.applicationValid ? `${label} application could not be validated.` : !providerValidation.fromNumberAuthorized ? `The configured ${label} caller number is not authorized for Voice.` : !providerValidation.ownerNumberReady ? "The owner number is not valid for outbound Voice." : null;
    return Response.json({ status: getTelephonyStatus(providerError), settings, calls }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ status: getTelephonyStatus("Telephony storage is not ready."), error: "Apply the JARVIS Phone database migration before enabling calls." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const current = await context();
  if (!current) return Response.json({ error: "Your session has expired. Please sign in again." }, { status: 401 });
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Phone settings are invalid." }, { status: 400 });
  try {
    const settings = await current.repository.updateSettings(current.user.id, parsed.data);
    return Response.json({ settings });
  } catch {
    return Response.json({ error: parsed.data.customerReplyOutsideHours ? "Apply phone migration 0014 before enabling after-hours customer reply calls." : "Phone settings could not be saved." }, { status: 503 });
  }
}
