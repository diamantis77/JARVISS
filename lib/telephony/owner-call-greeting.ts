// Only application-authored event codes become a spoken call reason. Provider
// payloads and researched text must not be promoted into voice instructions.
const EVENT_REASONS: Record<string, string> = {
  DAILY_BRIEF_READY: "Σας καλώ για τη σημερινή αναφορά.",
  HOT_LEAD_DETECTED: "Σας καλώ γιατί προέκυψε ένας σημαντικός υποψήφιος πελάτης.",
  LEAD_REPLIED: "Σας καλώ γιατί λάβαμε μια σημαντική απάντηση από πελάτη.",
  OWNER_SELF_TEST_REPLY: "Λάβαμε την απάντησή σας στο δοκιμαστικό email.",
  MEETING_STARTING_SOON: "Σας καλώ για ένα προσεχές ραντεβού.",
  PROVIDER_DISCONNECTED: "Σας καλώ για μια επείγουσα λειτουργική ενημέρωση.",
  HIGH_VALUE_DEAL: "Σας καλώ για μια σημαντική επιχειρηματική ευκαιρία.",
  CUSTOM_PRIORITY_EVENT: "Σας καλώ για μια σημαντική ενημέρωση.",
  MISSION_IMPORTANT_RESULT: "Σας καλώ για ένα σημαντικό αποτέλεσμα της σημερινής αποστολής.",
};

export function ownerCallGreeting(context: Record<string, unknown>): string {
  if (context.source === "settings_manual_test") {
    if (context.testCallOrdinal === 4) return "Καλησπέρα κύριε. Είμαι ο JARVIS. Δοκιμάζουμε δύο συνεχόμενες διακοπές. Σας ακούω.";
    if (context.testCallOrdinal === 3) return "Καλησπέρα κύριε. Είμαι ο JARVIS. Δοκιμάζουμε τώρα τη νέα φωνή και την άμεση διακοπή. Σας ακούω.";
    if (context.testCallOrdinal === 2) return "Καλησπέρα κύριε. Είμαι ο JARVIS. Η δεύτερη δοκιμαστική τηλεφωνική σύνδεση είναι ενεργή. Σας ακούω.";
    return "Καλησπέρα κύριε. Η πρώτη τηλεφωνική σύνδεση του JARVIS είναι ενεργή. Σας ακούω.";
  }
  const eventType = typeof context.eventType === "string" ? context.eventType : "";
  const reason = EVENT_REASONS[eventType] ?? "Σας καλώ για μια σημαντική ενημέρωση.";
  return `Καλησπέρα κύριε. Είμαι ο JARVIS. ${reason} Σας ακούω.`;
}

export function ownerCallGreetingInstruction(greeting: string): string {
  return `Μίλα πρώτος τώρα στα ελληνικά, χωρίς να περιμένεις ερώτηση. Πες ακριβώς: ${greeting} Έπειτα σταμάτα να μιλάς και άκου τον καλούντα.`;
}
