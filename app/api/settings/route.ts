import { createRequestRepositories } from "@/lib/repositories/factory";
import { settingsSchema } from "@/lib/validation";

export async function GET() { const context = await createRequestRepositories(); if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 }); return Response.json({ settings: await context.repositories.settings.get(), mode: context.mode }); }
export async function PUT(request: Request) { const context = await createRequestRepositories(); if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 }); const parsed = settingsSchema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "Check the settings fields and try again." }, { status: 400 }); return Response.json({ settings: await context.repositories.settings.upsert(parsed.data), mode: context.mode }); }
