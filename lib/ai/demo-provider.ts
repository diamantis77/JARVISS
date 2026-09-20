import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "./provider";

export class DemoJarvisProvider implements JarvisAiProvider {
  private command = "";
  async respond(request: AiTurnRequest): Promise<AiTurnResult> {
    if (request.input) this.command = request.input.includes("Owner command: ") ? request.input.split("Owner command: ").at(-1) ?? request.input : request.input;
    const responseId = `demo_response_${crypto.randomUUID()}`;
    if (request.toolOutputs?.length) {
      const greek = /[Α-ω]/u.test(this.command);
      const research = request.toolOutputs.map((item) => { try { return JSON.parse(item.output) as { researchRunId?: string; status?: string; discoveredCount?: number; processedCount?: number }; } catch { return null; } }).find((item) => item?.researchRunId);
      if (research) return { responseId, toolCalls: [], text: greek ? `Η Demo Research είναι αποκλειστικά φανταστική. Αποθηκεύτηκαν ${research.processedCount ?? 0}/${research.discoveredCount ?? 0} υποψήφιες επιχειρήσεις χωρίς καμία εξωτερική επικοινωνία.` : `Demo Research is explicitly fictional. ${research.processedCount ?? 0}/${research.discoveredCount ?? 0} candidate businesses were persisted, with no external contact.` };
      return { responseId, toolCalls: [], text: greek ? "Ολοκλήρωσα την ασφαλή ενέργεια χρησιμοποιώντας μόνο τα διαθέσιμα demo δεδομένα. Τα αποτελέσματα εμφανίζονται στο run και δεν έγινε καμία πραγματική εξωτερική ενέργεια." : "I completed the safe operation using only the available demo data. The result is recorded in this run; no real external action occurred." };
    }
    const lower = this.command.toLowerCase();
    if (/send it|στείλ|αποστολ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "send_email", arguments: JSON.stringify({ draftId: "demo-draft", recipient: "demo@example.invalid", subject: "Demo outreach", body: "Demo message preview — no email provider is connected.", threadId: null, inReplyTo: null }) }] };
    if (/email|mail|ηλεκτρον|μήνυμ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "list_email_threads", arguments: JSON.stringify({ maxResults: 5 }) }] };
    if (/calendar|schedule|tomorrow|ημερολόγ|πρόγραμμ|αύριο/.test(lower)) {
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + (/tomorrow|αύριο/.test(lower) ? 1 : 0));
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 1);
      return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "list_calendar_events", arguments: JSON.stringify({ timeMin: start.toISOString(), timeMax: end.toISOString(), timezone: "Europe/Athens", maxResults: 10 }) }] };
    }
    if (/task|εργασ|υπενθύμ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "create_task", arguments: JSON.stringify({ title: this.command.slice(0, 280), priority: "medium" }) }] };
    if (/strongest|my leads|my crm|ισχυρότερ|καλύτερ.*lead|crm/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "search_crm", arguments: JSON.stringify({ query: "", limit: 5 }) }] };
    const englishResearch = this.command.match(/(?:find|research|discover)(?:\s+me)?\s+(?:(\d+)\s+)?(.+?)\s+in\s+(.+)/i);
    const greekResearch = this.command.match(/(?:βρες|ερεύνησε|ανακάλυψε)(?:\s+μου)?\s+(?:(\d+)\s+)?(.+?)\s+(?:στην|στη|στο|σε)\s+(.+)/i);
    const research = englishResearch ?? greekResearch;
    if (research) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "search_leads", arguments: JSON.stringify({ limit: Math.min(Number(research[1] ?? 10), 50), industry: research[2].trim(), location: research[3].trim(), criteria: {} }) }] };
    if (/lead|prospect|υποψήφι/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "search_crm", arguments: JSON.stringify({ query: "", limit: 5 }) }] };
    return { responseId, toolCalls: [], text: /[Α-ω]/u.test(this.command) ? "Είμαι έτοιμος. Σε Demo Mode μπορώ να αναζητήσω το δοκιμαστικό CRM, να δημιουργήσω εσωτερικές εργασίες και να προετοιμάσω approvals χωρίς πραγματικές εξωτερικές ενέργειες." : "I’m ready. In Demo Mode I can search the fictional CRM, create internal tasks, and prepare approvals without performing real external actions." };
  }
}
