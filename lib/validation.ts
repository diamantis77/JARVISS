import { z } from "zod";

export const commandSchema = z.object({ command: z.string().trim().min(2).max(1000) });
export const leadSearchSchema = z.object({ category: z.string().min(2), location: z.string().min(2), limit: z.number().int().min(1).max(100) });
export const approvalSchema = z.object({ approvalId: z.string().min(1), decision: z.enum(["approved", "rejected"]) });
export const approvalDecisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) });
export const approvalEditSchema = z.object({ subject: z.string().trim().min(1).max(200), preview: z.string().trim().min(1).max(5000) });
export const settingsSchema = z.object({
  fullName: z.string().trim().min(1).max(120), businessName: z.string().trim().min(1).max(160),
  companyServices: z.array(z.string().trim().min(1).max(120)).max(30), companyDescription: z.string().trim().max(3000),
  targetIndustries: z.array(z.string().trim().min(1).max(120)).max(30), targetLocations: z.array(z.string().trim().min(1).max(120)).max(30),
  defaultLanguage: z.string().trim().min(2).max(20), minimumLeadScore: z.number().int().min(0).max(100),
});
