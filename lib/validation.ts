import { z } from "zod";

export const commandSchema = z.object({ command: z.string().trim().min(2).max(1000) });
export const voiceCommandSchema = commandSchema.extend({
  source: z.literal("voice"), voiceSessionId: z.string().min(1).max(200), voiceCommandId: z.string().min(1).max(200),
  voiceContext: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().trim().min(1).max(1200) })).max(8).optional(),
});
export const leadSearchSchema = z.object({ category: z.string().min(2), location: z.string().min(2), limit: z.number().int().min(1).max(100) });
export const approvalSchema = z.object({ approvalId: z.string().min(1), decision: z.enum(["approved", "rejected"]) });
export const approvalDecisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });
export const approvalEditSchema = z.object({ subject: z.string().trim().min(1).max(200), preview: z.string().trim().min(1).max(5000) });
export const settingsSchema = z.object({
  fullName: z.string().trim().min(1).max(120), businessName: z.string().trim().min(1).max(160),
  companyServices: z.array(z.string().trim().min(1).max(120)).max(30), companyDescription: z.string().trim().max(3000),
  targetIndustries: z.array(z.string().trim().min(1).max(120)).max(30), targetLocations: z.array(z.string().trim().min(1).max(120)).max(30),
  defaultLanguage: z.string().trim().min(2).max(20), minimumLeadScore: z.number().int().min(0).max(100),
  researchMaxLeads: z.number().int().min(1).max(50),
  researchMaxPagesPerSite: z.number().int().min(1).max(5),
  researchFetchTimeoutMs: z.number().int().min(2000).max(20000),
  researchMaxConcurrency: z.number().int().min(1).max(5),
  researchAiAnalysisEnabled: z.boolean(),
  jarvisVoice: z.literal("cedar"),
  voiceMode: z.enum(["conversation", "push_to_talk"]),
  wakeModeEnabled: z.boolean(),
  wakePhrase: z.literal("Hey Jarvis"),
  preferredFormOfAddress: z.string().trim().min(1).max(80),
  wakeSoundEnabled: z.boolean(),
  voiceConversationIdleTimeoutMs: z.number().int().min(30_000).max(600_000),
  voiceMicrophoneDeviceId: z.string().max(500),
  timezone: z.string().trim().min(1).max(100),
  dailyBriefEnabled: z.boolean(),
  dailyBriefTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});
