import { el } from "../locales/el";
import { en } from "../locales/en";

export const DEFAULT_LOCALE = "el-GR" as const;
export const FALLBACK_LOCALE = "en" as const;
export const DEFAULT_TIMEZONE = "Europe/Athens" as const;

export function tr(key: string, values: Record<string, string | number> = {}, locale: string = DEFAULT_LOCALE) {
  const dictionary = locale.startsWith("el") ? el : en;
  let text = dictionary[key] ?? en[key] ?? key;
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

export function formatDateTime(value: string | Date, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, { timeZone: DEFAULT_TIMEZONE, dateStyle: "short", timeStyle: "short", ...options }).format(new Date(value));
}

const labels: Record<string, string> = {
  idle: "ΕΤΟΙΜΟΣ", wake_initializing: "ΕΚΚΙΝΗΣΗ WAKE MODE", wake_waiting: "ΑΝΑΜΟΝΗ ΓΙΑ \"HEY JARVIS\"", wake_detected: "HEY JARVIS · ΕΝΤΟΠΙΣΤΗΚΕ", requesting_microphone: "ΑΝΑΜΟΝΗ ΜΙΚΡΟΦΩΝΟΥ", connecting: "ΣΥΝΔΕΣΗ…", listening: "ΑΚΟΥΩ", user_speaking: "ΣΕ ΑΚΟΥΩ", processing: "ΕΠΕΞΕΡΓΑΣΙΑ", jarvis_speaking: "Ο JARVIS ΜΙΛΑΕΙ", interrupted: "ΔΙΑΚΟΠΗ", reconnecting: "ΕΠΑΝΑΣΥΝΔΕΣΗ…", error: "ΠΡΟΒΛΗΜΑ ΦΩΝΗΣ", disconnected: "ΑΠΟΣΥΝΔΕΔΕΜΕΝΟ",
  pending: "Σε αναμονή", scheduled: "Προγραμματισμένο", running: "Σε εκτέλεση", retrying: "Νέα προσπάθεια", completed: "Ολοκληρωμένο", failed: "Απέτυχε", cancelled: "Ακυρώθηκε", dead_letter: "Dead Letter", healthy: "Υγιές", degraded: "Υποβαθμισμένο", needs_reconnect: "Απαιτεί επανασύνδεση", watch_expiring: "Το watch λήγει σύντομα", connected: "Συνδεδεμένο", disconnected_provider: "Αποσυνδεδεμένο", new: "Νέο", analyzed: "Αναλύθηκε", qualified: "Κατάλληλο", contacted: "Έγινε επικοινωνία", interested: "Ενδιαφέρεται", meeting: "Συνάντηση", won: "Κερδήθηκε", lost: "Χάθηκε", high: "Υψηλή", medium: "Μεσαία", low: "Χαμηλή",
};

export function localizeStatus(value: string) { return labels[value] ?? value.replaceAll("_", " "); }
