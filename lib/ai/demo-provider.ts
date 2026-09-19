import type { AiTurnRequest, AiTurnResult, JarvisAiProvider } from "./provider";

export class DemoJarvisProvider implements JarvisAiProvider {
  private command = "";
  async respond(request: AiTurnRequest): Promise<AiTurnResult> {
    if (request.input) this.command = request.input.includes("Owner command: ") ? request.input.split("Owner command: ").at(-1) ?? request.input : request.input;
    const responseId = `demo_response_${crypto.randomUUID()}`;
    if (request.toolOutputs?.length) {
      const greek = /[Α-ω]/u.test(this.command);
      return { responseId, toolCalls: [], text: greek ? "Ολοκλήρωσα την ασφαλή ενέργεια χρησιμοποιώντας μόνο τα διαθέσιμα demo δεδομένα. Τα αποτελέσματα εμφανίζονται στο run και δεν έγινε καμία πραγματική εξωτερική ενέργεια." : "I completed the safe operation using only the available demo data. The result is recorded in this run; no real external action occurred." };
    }
    const lower = this.command.toLowerCase();
    if (/send it|στείλ|αποστολ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "send_email", arguments: JSON.stringify({ draftId: "demo-draft", recipient: "demo@example.invalid", subject: "Demo outreach", preview: "Demo message preview — no email provider is connected." }) }] };
    if (/task|εργασ|υπενθύμ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "create_task", arguments: JSON.stringify({ title: this.command.slice(0, 280), priority: "medium" }) }] };
    if (/lead|crm|prospect|καλύτερ|ισχυρότερ/.test(lower)) return { responseId, text: "", toolCalls: [{ callId: `call_${crypto.randomUUID()}`, name: "search_crm", arguments: JSON.stringify({ query: "", limit: 5 }) }] };
    return { responseId, toolCalls: [], text: /[Α-ω]/u.test(this.command) ? "Είμαι έτοιμος. Σε Demo Mode μπορώ να αναζητήσω το δοκιμαστικό CRM, να δημιουργήσω εσωτερικές εργασίες και να προετοιμάσω approvals χωρίς πραγματικές εξωτερικές ενέργειες." : "I’m ready. In Demo Mode I can search the fictional CRM, create internal tasks, and prepare approvals without performing real external actions." };
  }
}
