import type { WeatherLocation, WeatherProvider, WeatherSnapshot } from "./contracts";

const condition = (code: number) => {
  if (code === 0) return "Αίθριος";
  if ([1, 2].includes(code)) return "Λίγες νεφώσεις";
  if (code === 3) return "Νεφελώδης";
  if ([45, 48].includes(code)) return "Ομίχλη";
  if ([51, 53, 55, 56, 57].includes(code)) return "Ψιλόβροχο";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Βροχή";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Χιόνι";
  if ([95, 96, 99].includes(code)) return "Καταιγίδα";
  return "Άγνωστες συνθήκες";
};

type Fetch = typeof fetch;

class OpenMeteoWeatherProvider implements WeatherProvider {
  constructor(private readonly fetchImpl: Fetch = fetch) {}

  private async coordinates(input: WeatherLocation) {
    if (Number.isFinite(input.latitude) && Number.isFinite(input.longitude)) {
      let label = input.location?.trim() || "Τρέχουσα περιοχή";
      if (!input.location) {
        try {
          const query = new URLSearchParams({ latitude: String(input.latitude), longitude: String(input.longitude), localityLanguage: "el" });
          const response = await this.fetchImpl(`https://api.bigdatacloud.net/data/reverse-geocode-client?${query.toString()}`, { signal: AbortSignal.timeout(6_000), cache: "no-store" });
          if (response.ok) {
            const data = await response.json() as { city?: string; locality?: string; principalSubdivision?: string; countryName?: string };
            label = [data.city || data.locality, data.principalSubdivision, data.countryName].filter(Boolean).join(", ") || label;
          }
        } catch { /* Weather can still be resolved without a city label. */ }
      }
      return { latitude: input.latitude!, longitude: input.longitude!, label };
    }
    if (!input.location?.trim()) return null;
    const response = await this.fetchImpl(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input.location.trim())}&count=1&language=el&format=json`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
    if (!response.ok) throw new Error("weather_geocoding_failed");
    const data = await response.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };
    const match = data.results?.[0];
    return match ? { latitude: match.latitude, longitude: match.longitude, label: [match.name, match.admin1, match.country].filter(Boolean).join(", ") } : null;
  }

  async getCurrent(input: WeatherLocation): Promise<WeatherSnapshot> {
    try {
      const coordinates = await this.coordinates(input);
      if (!coordinates) return { status: "unavailable", location: input.location, reason: input.location ? "not_found" : "missing_location" };
      const query = new URLSearchParams({ latitude: String(coordinates.latitude), longitude: String(coordinates.longitude), current: "temperature_2m,weather_code", daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max", forecast_days: "1", timezone: "auto" });
      const response = await this.fetchImpl(`https://api.open-meteo.com/v1/forecast?${query.toString()}`, { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!response.ok) throw new Error("weather_provider_failed");
      const data = await response.json() as { current?: { temperature_2m?: number; weather_code?: number }; daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: Array<number | null> } };
      const temperatureC = data.current?.temperature_2m;
      const code = data.current?.weather_code;
      if (typeof temperatureC !== "number" || typeof code !== "number") return { status: "unavailable", location: coordinates.label, reason: "provider_error" };
      return { status: "available", location: coordinates.label, temperatureC, condition: condition(code), highC: data.daily?.temperature_2m_max?.[0] ?? null, lowC: data.daily?.temperature_2m_min?.[0] ?? null, precipitationProbability: data.daily?.precipitation_probability_max?.[0] ?? null, provider: "open-meteo" };
    } catch {
      return { status: "unavailable", location: input.location, reason: "provider_error" };
    }
  }

  getDailyForecast(input: WeatherLocation) { return this.getCurrent(input); }
}

export function createWeatherProvider(fetchImpl?: Fetch): WeatherProvider { return new OpenMeteoWeatherProvider(fetchImpl); }
