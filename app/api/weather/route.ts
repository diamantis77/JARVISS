import { createWeatherProvider } from "@/lib/weather/factory";
import { createRequestRepositories } from "@/lib/repositories/factory";

export async function POST(request: Request) {
  const context = await createRequestRepositories();
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as { latitude?: unknown; longitude?: unknown; location?: unknown } | null;
  const latitude = typeof body?.latitude === "number" ? body.latitude : undefined;
  const longitude = typeof body?.longitude === "number" ? body.longitude : undefined;
  const location = typeof body?.location === "string" ? body.location.slice(0, 160) : null;
  if ((latitude !== undefined && (latitude < -90 || latitude > 90)) || (longitude !== undefined && (longitude < -180 || longitude > 180))) return Response.json({ error: "Invalid location" }, { status: 400 });
  // Coordinates are used only for this request and are never persisted.
  const weather = await createWeatherProvider().getCurrent({ latitude, longitude, location });
  return Response.json({ weather }, { headers: { "Cache-Control": "private, max-age=300" } });
}
