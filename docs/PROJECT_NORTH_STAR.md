# Project North Star — JARVIS

## Product promise

JARVIS is a personal AI business operating system: one trusted assistant that understands the owner's business, remembers its state, communicates naturally, and helps move work forward across voice, text, CRM, research, email, calendar, and future interfaces.

It is not a chatbot with a dashboard, a collection of disconnected automations, or a cinematic demo. The product succeeds when the owner can ask what happened, what matters, and what to do next—and receive accurate answers grounded in real business data.

The long-term feeling is:

> JARVIS knows what is happening in my business and is ready whenever I need him.

## One JARVIS

Every interface must use the same:

- identity and communication style;
- business memory and CRM records;
- orchestrator and business reasoning;
- typed tool system;
- approval and permission model;
- audit trail and security boundaries.

Voice, text, wake mode, phone, desktop, and mobile are interfaces to one system. None may become a second business brain or a shortcut around permissions.

## Primary user experience

The default experience is a calm, premium, Greek-first command center built around a single living JARVIS core.

- Locale: Greek (`el-GR`).
- Timezone: `Europe/Athens`.
- Currency: EUR.
- Tone: concise, calm, professional, warm, and direct.
- Visual identity: deep navy, blue/cyan energy, minimal, precise, futuristic, and original.

The core communicates real system state honestly:

```text
standby → connecting → listening → thinking/researching → speaking → standby
```

Wake mode should be local and inexpensive. A live voice session starts only after wake detection and closes when the interaction ends. The user must never wonder whether JARVIS heard them.

## Truth before theatre

Every visible or spoken fact must be one of:

- retrieved from a real provider;
- read from persisted business data;
- calculated deterministically from structured data;
- explicitly unavailable or unknown.

Never invent believable business names, metrics, pipeline, revenue, weather, meetings, messages, or activity. Demo data must remain clearly labelled and must never mix with Live Mode.

Useful fallback language includes:

- `Δεν υπάρχουν αρκετά δεδομένα`;
- `Μη διαθέσιμο`;
- `Άγνωστο`.

Unknown is not false.

## CRM as business memory

The CRM is JARVIS's persistent memory. A business record can accumulate identity, industry, location, website, contacts, evidence, research, score, interactions, messages, tasks, meetings, drafts, deal stage, estimated value, actual revenue, next action, and history.

JARVIS should resolve natural references such as “Τι έγινε με τον Παπαδόπουλο;” against existing records and context, while asking for clarification when identity is ambiguous.

## Evidence-first intelligence

Public business research must separate discovery from verification and preserve provenance. Research can discover candidates, verify identity, inspect public websites, extract signals, score deterministically, cite sources, and persist findings. It must never invent businesses or silently promote a search snippet into a verified fact.

JARVIS must be able to explain why a score or recommendation exists using stored evidence.

Metrics are deterministic:

- Pipeline Value = sum of open deal values.
- Weighted Expected Revenue = estimated value × structured stage probability.
- Closed Revenue = actual won revenue.

AI must not invent financial estimates.

## Action and approval model

Application code—not the language model—enforces permissions.

Safe reads and analysis may execute within configured access. External or high-impact mutations require explicit approval bound to the exact payload, including:

- sending email;
- creating, updating, or deleting calendar events;
- calling an external person;
- deleting important CRM data;
- any future action with comparable impact.

The AI cannot approve its own work. A generic “yes” must never approve an ambiguous or different action.

## Integrations

Gmail and Calendar reads can support summaries, search, schedule awareness, CRM linking, drafts, meeting preparation, and availability checks. Writes stay behind the authoritative approval system.

Background work—provider synchronization, watch renewal, research continuation, notifications, reminders, briefings, and health checks—must use durable jobs rather than browser timers.

Proactive JARVIS may detect and summarize important changes, prepare responses, and notify the owner. It must not perform unapproved external actions.

## Daily operational value

The highest-value interactions include:

- “Τι έγινε σήμερα;”
- “Ποιος απάντησε;”
- “Τι έχω αύριο;”
- “Βρες μου πελάτες.”
- “Ετοίμασε απάντηση.”
- “Πόσο pipeline έχουμε;”
- “Τι πρέπει να κάνω τώρα;”

Answers must use actual business state. “Τι πρέπει να κάνω τώρα;” should prioritize high-value replies, imminent meetings, pending approvals, overdue tasks, near-closing deals, and important leads—not generic motivation.

The daily briefing should be deterministic, concise when spoken, and richer in the UI. It may include completed work, leads, replies, meetings, approvals, tasks, pipeline, weather, and meaningful changes since the last session.

## Security and privacy boundaries

JARVIS never receives unrestricted shell, filesystem, raw SQL, credential, or secret access. Capabilities are narrow, typed, validated tools.

Websites, email, documents, API content, and search results are untrusted data. They cannot modify JARVIS rules, approve actions, reveal secrets, authorize tools, or execute commands.

Collect and retain only useful structured business information. Do not permanently store raw microphone audio, precise location without a clear need, massive webpage HTML, or unnecessary email content. Prefer city/region/country over precise GPS and use a configured city when location permission is denied.

## Reliability, latency, and cost

Reliability and security come before feature count. Ten dependable capabilities are better than fifty mediocre ones. If wake word, microphone, voice, CRM, or research are unreliable, fix them before expanding the surface area.

Perceived latency matters. Activation and state changes should be immediate and honest.

Use deterministic logic when AI is unnecessary. Use cost-efficient capable models for ordinary work and higher-capability models only when justified. Do not keep OpenAI Live active while waiting for a wake word, and do not send unnecessary context.

## Auditability

The owner must be able to see what JARVIS actually did: research completed, CRM updated, draft prepared, email sent, meeting created, or approval requested. Never report success unless the underlying operation succeeded.

## Future interfaces

Phone, desktop, and mobile are planned interfaces to the same JARVIS—not separate products.

- Phone: the owner can call JARVIS, and JARVIS may call the owner only under explicit configurable rules, quiet hours, and approval boundaries.
- Desktop: a background-capable Windows experience can provide persistent wake, notifications, voice, a system tray, and the core UI without unsafe unrestricted computer control.
- Mobile: notifications, voice, approvals, calls, meetings, and CRM updates can follow later.

These interfaces do not outrank reliability of the core system.

## Default development priority

1. Reliability and security
2. Voice and wake interaction
3. Real business data
4. CRM intelligence
5. Business research
6. Email and Calendar
7. Business metrics and revenue
8. Background operation
9. Proactive intelligence
10. Phone JARVIS
11. Desktop JARVIS
12. Further expansion

Do not sacrifice priorities 1–4 merely to reach a later interface sooner.

## Decision gate

Before accepting architecture, product, or UI work, ask whether it makes JARVIS:

- more useful;
- more reliable;
- more natural;
- more aware of the business;
- easier to talk to;
- more trustworthy.

If it does not materially improve one of these qualities—or protects none of the non-negotiable boundaries above—it is probably not a priority.

## Final rule

Do not turn JARVIS into a pile of features.

One identity. One memory. One business brain. One tool system. One security model. Multiple interfaces.
