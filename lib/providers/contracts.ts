import type { Lead } from "@/types";

export interface AiProvider { plan(request: string): Promise<{ intent: string; plan: string[] }> }
export interface EmailProvider { createDraft(input: { to: string; subject: string; body: string }): Promise<{ id: string }>; send(draftId: string): Promise<{ sent: boolean; reason?: string }> }
export interface LeadSearchProvider { search(input: { category: string; location: string; limit: number }): Promise<Lead[]> }
export interface TelephonyProvider { callOwner(): Promise<{ status: "unsupported" | "started" }>; callLead(phone: string): Promise<{ status: "unsupported" | "started" }>; endCall(id: string): Promise<void>; getCallStatus(id: string): Promise<string> }
export interface VoiceProvider { startSession(): Promise<void>; stopSession(): Promise<void>; transcribe(): Promise<string>; speak(text: string): Promise<void> }
