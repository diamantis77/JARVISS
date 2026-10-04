import type { CalendarEventRecord, EmailThreadDetail, EmailThreadSummary } from "../../types";

export interface EmailProvider {
  listThreads(input: { maxResults: number }): Promise<EmailThreadSummary[]>;
  searchThreads(input: { query: string; maxResults: number }): Promise<EmailThreadSummary[]>;
  getThread(threadId: string): Promise<EmailThreadDetail>;
  createDraft(input: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null }): Promise<{ draftId: string; messageId: string | null; threadId: string | null }>;
  sendMessage(input: { to: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string | null }): Promise<{ messageId: string; threadId: string }>;
}
export interface CalendarProvider {
  listEvents(input: { timeMin: string; timeMax: string; maxResults: number; timezone: string }): Promise<CalendarEventRecord[]>;
  getEvent(input: { calendarId: string; eventId: string; timezone: string }): Promise<CalendarEventRecord>;
  getAvailability(input: { timeMin: string; timeMax: string; timezone: string }): Promise<Array<{ start: string; end: string }>>;
  createEvent(input: Omit<CalendarEventRecord, "id" | "status">): Promise<CalendarEventRecord>;
  updateEvent(input: CalendarEventRecord): Promise<CalendarEventRecord>;
  deleteEvent(input: { calendarId: string; eventId: string }): Promise<{ deleted: true }>;
}
