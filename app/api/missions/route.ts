import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/supabase/server";
import { MissionService } from "@/lib/missions/service";
import { readMissionDashboard } from "@/lib/missions/dashboard";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  industry: z.string().trim().min(2).max(160),
  geography: z.string().trim().min(2).max(160),
  goal: z.string().trim().min(3).max(1000),
  criteria: z.record(z.unknown()).optional(),
  dailyTargetLimit: z.number().int().min(1).max(50).default(20),
  workStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
  workEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("20:30"),
  briefingTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("20:30"),
  timezone: z.string().max(100).default("Europe/Athens"),
  outreachMode: z.enum(["DRAFT_ONLY", "APPROVAL_REQUIRED"]).default("APPROVAL_REQUIRED"),
  senderIdentity: z.string().trim().max(160).optional(),
  researchOnly: z.boolean().default(false),
});

export async function GET() {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    return Response.json(await readMissionDashboard(supabase, user.id), { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Missions are temporarily unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  const { supabase, user } = await getAuthenticatedUser();
  if (!supabase || !user) return Response.json({ error: "Sign in required" }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid mission configuration" }, { status: 400 });
  if (parsed.data.workStart === parsed.data.workEnd) return Response.json({ error: "Working hours must have a non-zero window" }, { status: 400 });
  try { new Intl.DateTimeFormat("en", { timeZone: parsed.data.timezone }); }
  catch { return Response.json({ error: "Invalid timezone" }, { status: 400 }); }
  const service = new MissionService(supabase, user.id);
  try {
    if (!await service.schemaReady()) return Response.json({ error: "Migration 0013 is not applied" }, { status: 503 });
    const mission = await service.create(parsed.data);
    return Response.json({ mission, message: "Mission saved paused. Resume it when ready." }, { status: 201 });
  } catch { return Response.json({ error: "Unable to create mission" }, { status: 503 }); }
}
