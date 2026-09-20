# JARVIS v0.5 · Google Workspace + Notifications

JARVIS is an authenticated, persistent AI business command center. v0.5 adds least-privilege Google OAuth, Gmail and Calendar providers, duplicate-safe synchronization, and a first-class notification center while preserving the v0.4 voice, research, RLS, tool loop, and approval gates.

## Google Workspace architecture

Google access is connected incrementally from Settings. The browser is redirected through a server-owned authorization-code flow with CSRF `state`, PKCE S256, fixed redirect URI, offline access, and server-side code exchange. Refresh/access tokens are stored only as versioned AES-256-GCM ciphertext; refresh tokens, client secrets, and the encryption key never reach browser JavaScript.

Capabilities and scopes:

- Gmail read: `gmail.readonly`, used for bounded thread/message reads and history synchronization.
- Gmail send: `gmail.send`, used only after an object-bound `send_email` approval.
- Calendar events: `calendar.events`, used for event reads and specifically approved create/update/delete operations.
- Calendar availability: `calendar.events.freebusy`, used for busy-block checks without requesting full calendar administration.
- `openid email` identifies the selected provider account. The app deliberately does not request `https://mail.google.com/` or the broad `calendar` scope.

Email bodies are marked as untrusted data before they reach JARVIS. They cannot change instructions, authorize tools, approve actions, or request secrets. Reads are bounded; JARVIS does not mirror a mailbox locally. Drafts are internal interactions. Gmail send validates the frozen recipient, subject, body, Gmail thread ID, and RFC reply message ID against the stored draft, claims one approval atomically, and records returned provider IDs.

Calendar reads are safe automatic tools. Create, update, and delete tools always stop at the existing approval gate. Event approvals freeze the calendar, title, start/end, IANA timezone, attendees, location, and description. Ambiguous dates or times fail validation and require clarification.

## Google Cloud setup

1. Create/select a Google Cloud project and enable **Gmail API**, **Google Calendar API**, and **Cloud Pub/Sub API**.
2. Configure the OAuth consent screen. During development select Testing and add the owner's Google account as a test user.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add the exact local redirect URI: `http://127.0.0.1:3000/api/integrations/google/callback`. Add the production HTTPS equivalent before deployment.
5. Put the client ID/secret in `.env.local`. Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded as base64; never commit it.
6. Run `supabase/migrations/0005_v05_google_workspace.sql` after migrations 0001–0004.
7. Set `GOOGLE_GMAIL_ENABLED=true` and/or `GOOGLE_CALENDAR_ENABLED=true`, restart JARVIS, then connect each capability from Settings.
8. Public apps using Gmail restricted scopes may require Google OAuth verification and an independent security assessment. Keep the app in Testing for private development until that process is complete.

### Production Gmail push

Create a Pub/Sub topic in the same Cloud project, grant `gmail-api-push@system.gserviceaccount.com` permission to publish, create a push subscription targeting `https://YOUR_HOST/api/webhooks/google/gmail?token=YOUR_RANDOM_TOKEN`, and set `GOOGLE_PUBSUB_TOPIC` plus `GOOGLE_PUBSUB_VERIFICATION_TOKEN`. Call the authenticated `/api/integrations/google/renew` service with `{ "capability": "gmail" }` daily; Gmail watches expire within seven days. Pub/Sub is only a signal—JARVIS calls Gmail history synchronization and persists the new checkpoint.

### Production Calendar watch

Set `GOOGLE_CALENDAR_WEBHOOK_BASE_URL` to the public HTTPS origin and generate a random `GOOGLE_CALENDAR_CHANNEL_TOKEN`. Renew through `/api/integrations/google/renew` with `{ "capability": "calendar" }`. The webhook validates channel/token/resource headers, then performs a fresh authorized Calendar read. Calendar notifications are not treated as event data.

Localhost cannot receive Google push webhooks. The Settings **Development Sync** buttons perform bounded manual Gmail history or Calendar synchronization and are explicitly labelled as development behavior; no background scheduler is faked.

## Notifications

The Command Center bell shows per-user, RLS-protected notifications with `info`, `important`, and `urgent` priority. Gmail message IDs and calendar occurrence keys provide duplicate suppression. Notifications may point to a lead, thread, approval, calendar event, research run, or provider connection. They never execute external actions.

Voice is an input/output layer, not a second business brain. GPT-Live receives and speaks audio over browser WebRTC, delegates business intent to the client, and the finalized utterance is executed by the existing authenticated `/api/jarvis/run` path. The server keeps the OpenAI API key, permissions, tools, approval decisions, and persistence authoritative.

Research can discover real public businesses, match official sites, safely inspect selected pages, extract deterministic signals, optionally interpret those signals with AI, calculate an evidence-only score, persist citations, and resume long jobs in small batches. It never contacts a business.

## Runtime modes

| Mode | Configuration | Behavior |
| --- | --- | --- |
| Demo | Supabase variables absent | Fictional `.example` businesses and fictional analysis, clearly labeled; no live web access |
| Live data, Demo AI | Supabase configured, no OpenAI key | Authenticated persistence; deterministic assistant; Live Research disabled |
| Live, research off | Supabase + OpenAI, `LIVE_RESEARCH_ENABLED=false` | Real AI and CRM; public research remains disabled |
| Live Research | Supabase + OpenAI, `LIVE_RESEARCH_ENABLED=true` | OpenAI Responses web search plus secure website analysis |

The header always reports the active research mode. Unknown is never treated as a negative fact.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:3000`. With empty credentials the app starts in Demo Mode and bypasses authentication locally.

Example commands:

- `Find 10 dentists in Athens`
- `Βρες μου 15 λογιστικά γραφεία στη Θεσσαλονίκη`
- `Research the website of lead <lead-id> again using https://example.com`

## Live setup

1. Create a Supabase project and run these files in order in the SQL Editor:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_v02_auth_persistence.sql`
   - `supabase/migrations/0003_v03_live_research.sql`
   - `supabase/migrations/0004_v04_voice.sql`
   - `supabase/migrations/0005_v05_google_workspace.sql`
2. Enable Supabase Email authentication. Configure local Site URL `http://localhost:3000` and callback `http://localhost:3000/auth/callback`.
3. Set the Supabase Project URL and publishable key in `.env.local`. Do not use a service-role key.
4. Set a server-only `OPENAI_API_KEY`, choose an available Responses API model, and set `LIVE_RESEARCH_ENABLED=true`.
5. Restart the server, sign in, and tune research caps under Settings.
6. To enable voice, set `VOICE_ENABLED=true`. Microphone access requires localhost or HTTPS and browser permission.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
OPENAI_RESEARCH_MODEL=gpt-5
LIVE_RESEARCH_ENABLED=true
VOICE_ENABLED=true
OPENAI_VOICE_MODEL=gpt-live-1
VOICE_IDLE_TIMEOUT_MS=120000
VOICE_MAX_SESSION_MINUTES=20
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://127.0.0.1:3000/api/integrations/google/callback
GOOGLE_TOKEN_ENCRYPTION_KEY=
GOOGLE_GMAIL_ENABLED=true
GOOGLE_CALENDAR_ENABLED=true
RESEARCH_MAX_LEADS=50
```

`OPENAI_RESEARCH_MODEL` is optional and falls back to `OPENAI_MODEL`. The application hard-caps a run at 50 candidates even if configuration is incorrect.

## Realtime voice architecture

```text
microphone -> browser WebRTC -> GPT-Live transcription/delegation
  -> finalized utterance -> /api/jarvis/run -> existing tools + approvals + persistence
  -> concise final report -> GPT-Live commentary -> remote audio
```

The browser renders real microphone/output RMS levels, supports mute, stop, one bounded reconnect, idle/max-session timeouts, and barge-in while JARVIS is speaking. Final user and assistant turns are persisted; partial transcripts and raw audio are not stored. Demo Mode does not simulate a working microphone: voice is explicitly unavailable until Supabase, OpenAI, and `VOICE_ENABLED=true` are configured.

Use a current Chromium, Edge, Safari, or Firefox release with WebRTC, Web Audio, and `getUserMedia` support. Localhost is accepted as a secure context for development; deployment must use HTTPS. The first microphone click requests browser permission, uses the default input/output devices, and keeps an obvious active indicator plus Stop Voice control for the entire session.

Lifecycle: `idle → requesting microphone → connecting → listening → user speaking → processing → JARVIS speaking`. A user interruption moves the session through `interrupted`; a transport drop permits one `reconnecting` attempt before voice shuts down safely. Explicit stop, two minutes of idle time, or the configured maximum duration closes the session without affecting text commands.

Voice cannot approve an action merely from an unbound “yes” or “ναι”. Approval remains tied to one specific pending approval and the application gate; ambiguous or multiple pending approvals require explicit UI confirmation.

## Research architecture

```text
owner command
  -> versioned JARVIS instructions + registered tools
  -> OpenAI Responses built-in web_search (discovery and citations)
  -> exact identity dedupe (domain, public phone, or exact normalized name + location)
  -> SSRF-hardened fetcher (HTTP/S only, DNS/IP checks, redirect revalidation, limits)
  -> deterministic HTML signal extraction
  -> optional AI interpretation inside an explicit untrusted-content boundary
  -> evidence-only deterministic scoring
  -> per-user Supabase persistence and incremental UI events
```

Discovery and verification are separate. Search snippets are not silently upgraded to verified facts. Similar names remain separate unless a strong identity key matches. The fetcher blocks localhost, credentials in URLs, private/reserved IPv4 and IPv6, internal host suffixes, redirects into blocked networks, unsupported content, excessive redirects, oversized bodies, and timeouts. It sends no auth headers, cookies, CRM data, or API keys.

Website content is untrusted data. It cannot change system instructions, authorize a tool, or bypass the fixed permission registry. Full HTML and extracted page text are not persisted; only structured signals, summaries, source URLs, and provenance are stored.

## Adding another discovery provider

The core depends on `BusinessDiscoveryProvider` and `WebResearchProvider` contracts in `lib/research/contracts.ts`, not on a provider-specific record format. A future adapter should return normalized `DiscoveredBusiness` candidates with source URLs and confidence, then be selected in `lib/research/factory.ts`. Keep provider labels and source metadata intact so the evidence model remains auditable.

A future Google Places adapter should remain a separate provider boundary. Before persisting any Places-derived content, review the current Google Maps Platform terms, caching limits, attribution requirements, and data-retention rules. Do not couple CRM lead records directly to Google identifiers or arbitrary provider payloads.

## Persistence and resume

Migration `0003_v03_live_research.sql` adds:

- research runs and deduplicated candidates;
- public source citations and lead evidence;
- historical website analyses;
- score components, evidence IDs, confidence, and last-researched time;
- research settings and per-user RLS checks across parent and child records.

Research processes persisted batches of five with configurable concurrency. Progress is written after every candidate. The browser resumes the next batch with a separate authenticated request, so long jobs do not depend on one request. Cancellation preserves completed evidence, and continuation only claims candidates still marked `discovered`.

## Scoring v2

Scores only contain components backed by persisted evidence references. Supported service fit, geography, activity, public contact paths, and verified website gaps may contribute points. Missing or failed research contributes zero; it does not imply that a website, booking flow, CTA, or mobile support is absent. Lead details show each score component and its evidence count.

## Approval and outreach boundary

Research, fetching, analysis, scoring, Gmail/Calendar reads, and internal persistence are safe automatic operations. External or sensitive tools—including Gmail send, calendar create/update/delete, and important CRM changes—stop at the authoritative application approval gate. Every approved email is matched against its stored draft, and every calendar mutation is bound to its frozen event payload. Demo Mode never contacts Google or performs an external action.

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

The 49-test suite covers SSRF URLs and redirects, timeout/size/content limits, injection boundaries, evidence-only scoring, deterministic dedupe, persisted resume/cancel behavior, user-scoped evidence, Google OAuth state and token encryption, watch renewal, notification dedupe/isolation, untrusted email handling, frozen and edited approvals, threaded at-most-once email delivery, Calendar timezone validation, the shared text/voice tool loop, and repository persistence. Tests do not call Google, OpenAI, or paid services.

## Troubleshooting

- **Header says RESEARCH OFF:** set both `OPENAI_API_KEY` and `LIVE_RESEARCH_ENABLED=true`, then restart Next.js.
- **Demo results appear:** Demo Mode deliberately uses fictional `.example` records. Configure Supabase to enter Live Mode.
- **Research returns no candidates:** the provider failed or returned no cited candidates; JARVIS does not fabricate replacements.
- **Website signals are Unknown:** the official site was not confidently identified or the secure fetcher rejected/timed out. Inspect the run steps and sources.
- **Database errors after upgrade:** run migrations in order through `0005_v05_google_workspace.sql`; do not skip the v0.2–v0.4 migrations.
- **A partial run remains:** reopening/continuing it is safe; processed candidates are not duplicated.
- **Google says redirect URI mismatch:** copy `GOOGLE_REDIRECT_URI` exactly into the OAuth Web Client authorized redirect URIs.
- **Gmail send is not available:** reconnect Gmail and grant both displayed Gmail scopes; sending still requires a specific approval.
- **Google needs reconnect:** the refresh token was revoked/expired; use Reconnect in Settings. JARVIS does not retry forever.
- **Push does not work locally:** expected. Use Development Sync; Gmail Pub/Sub and Calendar watches require public trusted endpoints (Calendar requires HTTPS).
- **Voice says unavailable:** voice intentionally requires Live Mode, `OPENAI_API_KEY`, and `VOICE_ENABLED=true`.
- **Microphone is blocked:** grant microphone permission to the localhost/HTTPS origin and start a new session.
- **Voice disconnects:** JARVIS attempts one bounded reconnect; text mode stays available throughout.

## Known limitations

Live Google behavior requires owner-provided OAuth credentials and a migrated Supabase project; it cannot be end-to-end tested with repository-only fixtures. Localhost supports manual Development Sync but cannot receive Google push delivery. Gmail and Calendar change notifications are signals and may be delayed or occasionally missed, so production should retain periodic bounded reconciliation. Live Research depends on public web availability and the configured model. Realtime voice depends on browser WebRTC/microphone support. JARVIS does not bypass access controls, solve CAPTCHAs, scrape authenticated pages, or guarantee exhaustive coverage. In-memory Demo Mode resets on server restart. Rate limiting and renewal scheduling are process-local hooks and should use shared production infrastructure.
