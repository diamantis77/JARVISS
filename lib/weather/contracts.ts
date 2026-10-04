export type WeatherLocation = { location: string | null; latitude?: number; longitude?: number };
export type WeatherSnapshot = {
  status: "available";
  location: string;
  temperatureC: number;
  condition: string;
  highC: number | null;
  lowC: number | null;
  precipitationProbability: number | null;
  provider: "open-meteo";
} | { status: "unavailable"; location: string | null; reason?: "missing_location" | "not_found" | "provider_error" };
export interface WeatherProvider {
  getCurrent(input: WeatherLocation): Promise<WeatherSnapshot>;
  getDailyForecast(input: WeatherLocation): Promise<WeatherSnapshot>;
}
