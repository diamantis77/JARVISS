import { describe, expect, it, vi } from "vitest";
import { createWeatherProvider } from "../lib/weather/factory";

describe("Open-Meteo weather provider", () => {
  it("returns honest unavailable state when no location exists", async () => {
    const provider = createWeatherProvider(vi.fn());
    await expect(provider.getCurrent({ location: null })).resolves.toEqual({ status: "unavailable", location: null, reason: "missing_location" });
  });

  it("uses manual city geocoding and real provider fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ latitude: 39.64, longitude: 22.42, name: "Λάρισα", country: "Ελλάδα" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ current: { temperature_2m: 24.2, weather_code: 0 }, daily: { temperature_2m_max: [27], temperature_2m_min: [18], precipitation_probability_max: [5] } }), { status: 200 }));
    const result = await createWeatherProvider(fetchImpl).getCurrent({ location: "Λάρισα, Ελλάδα" });
    expect(result).toMatchObject({ status: "available", temperatureC: 24.2, condition: "Αίθριος", highC: 27, lowC: 18, provider: "open-meteo" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not invent weather when the provider fails", async () => {
    const result = await createWeatherProvider(vi.fn().mockRejectedValue(new Error("offline"))).getCurrent({ location: "Λάρισα" });
    expect(result).toEqual({ status: "unavailable", location: "Λάρισα", reason: "provider_error" });
  });
});
