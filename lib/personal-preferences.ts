import type { MicrophoneCalibration } from "./voice/browser-audio";
import type { WakeSensitivity } from "./voice/wake-word";

export type PersonalJarvisPreferences = {
  wakeSensitivity: WakeSensitivity;
  automaticBriefing: boolean;
  briefingLength: "short" | "normal";
  briefingWeather: boolean;
  briefingCalendar: boolean;
  briefingBusiness: boolean;
  briefingEmail: boolean;
  automaticLocation: boolean;
  manualCity: string;
  calibration: MicrophoneCalibration | null;
};

export const PERSONAL_PREFERENCES_KEY = "jarvis:personal-preferences:v1";

export const defaultPersonalJarvisPreferences: PersonalJarvisPreferences = {
  wakeSensitivity: "normal",
  automaticBriefing: true,
  briefingLength: "short",
  briefingWeather: true,
  briefingCalendar: true,
  briefingBusiness: true,
  briefingEmail: true,
  automaticLocation: false,
  manualCity: "",
  calibration: null,
};

export function parsePersonalJarvisPreferences(raw: string | null): PersonalJarvisPreferences {
  if (!raw) return defaultPersonalJarvisPreferences;
  try {
    const value = JSON.parse(raw) as Partial<PersonalJarvisPreferences>;
    return {
      ...defaultPersonalJarvisPreferences,
      ...value,
      wakeSensitivity: ["low", "normal", "high"].includes(value.wakeSensitivity ?? "") ? value.wakeSensitivity! : "normal",
      briefingLength: value.briefingLength === "normal" ? "normal" : "short",
      manualCity: typeof value.manualCity === "string" ? value.manualCity.slice(0, 160) : "",
      calibration: value.calibration && typeof value.calibration.speechThreshold === "number" ? value.calibration : null,
    };
  } catch {
    return defaultPersonalJarvisPreferences;
  }
}
