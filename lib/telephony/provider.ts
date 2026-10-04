import type { TelephonyProviderName } from "@/types";
import type { ProviderValidationResult, TelephonyProvider } from "./contracts";
import { getSelectedTelephonyProvider } from "./config";
import { TwilioTelephonyProvider, validateTwilioConfiguration } from "./twilio-provider";
import { VonageTelephonyProvider, validateVonageConfiguration } from "./vonage-provider";

export function createTelephonyProvider(name: TelephonyProviderName = getSelectedTelephonyProvider()): TelephonyProvider {
  return name === "vonage" ? new VonageTelephonyProvider() : new TwilioTelephonyProvider();
}

export function validateTelephonyProviderConfiguration(name: TelephonyProviderName = getSelectedTelephonyProvider(), force = false): Promise<ProviderValidationResult> {
  return name === "vonage" ? validateVonageConfiguration(force) : validateTwilioConfiguration(force);
}
