import type { RuntimeMode } from "../config/runtime";
import type { Repositories } from "../repositories/contracts";
import { hasCapability } from "../google/scopes";

/** This narrow path is only for a test message to the connected Gmail inbox. */
export async function selfTestEmailBlockReason(repositories: Repositories, mode: RuntimeMode, recipient: string, accountEmail: string): Promise<string | null> {
  if (mode !== "live") return "Το Demo Mode δεν αποστέλλει email.";
  if (process.env.GOOGLE_GMAIL_ENABLED !== "true") return "Η αποστολή Gmail δεν είναι ενεργή.";
  const connection = await repositories.connections.getGoogle();
  if (!connection || connection.status !== "connected" || !connection.refreshTokenEncrypted || !hasCapability(connection.scopes, "gmail"))
    return "Το Gmail δεν είναι συνδεδεμένο με δικαίωμα αποστολής.";
  const connectedAddress = connection.providerEmail.trim().toLowerCase();
  if (!connectedAddress || recipient.trim().toLowerCase() !== connectedAddress || accountEmail.trim().toLowerCase() !== connectedAddress)
    return "Το δοκιμαστικό email επιτρέπεται μόνο προς την ακριβή διεύθυνση του συνδεδεμένου Gmail.";
  return null;
}
