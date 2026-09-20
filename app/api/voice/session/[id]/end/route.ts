import { createRequestRepositories } from "@/lib/repositories/factory";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await createRequestRepositories(); if (!context) return Response.json({ error: "Your session has expired." }, { status: 401 });
  const session = await context.repositories.voice.getSession((await params).id); if (!session) return Response.json({ error: "Voice session not found." }, { status: 404 });
  const ended = await context.repositories.voice.updateSession(session.id, { status: "ended", endedAt: new Date().toISOString() });
  await context.repositories.activity.create({ eventType: "system", title: "Voice session ended", description: "Realtime voice disconnected.", metadata: { voiceSessionId: session.id } });
  return Response.json({ session: ended });
}
