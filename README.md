# JARVIS v0.6 · Production Operations

JARVIS is an authenticated, persistent AI business command center. v0.6 adds durable PostgreSQL-backed operations, workers, scheduling, retries, dead letters, authenticated Pub/Sub push, incremental synchronization, provider health, meeting reminders, morning briefs, diagnostics, and an Operations view while preserving all v0.5 approval and privacy boundaries.

The canonical long-term product and architecture direction is defined in [Project North Star](docs/PROJECT_NORTH_STAR.md). All new work should preserve one JARVIS identity, memory, business brain, tool system, security model, and audit trail across every interface.

## Public repository and Netlify handoff

This repository contains source code, migrations, and configuration examples only. Never commit `.env.local`, another populated `.env` file, Cloudflare/Vonage private keys, runtime logs, or customer data. Use `.env.example` as a list of variable names; enter real values only in the deployment platform's environment-variable settings. Rotate a credential if it is ever exposed in a public commit.

To deploy the web application from GitHub, import this repository in Netlify using its Next.js preset and `npm run build`. Configure the required environment variables in Netlify's UI for both build and Functions runtime; do not put secrets in `netlify.toml`. Add the final Netlify HTTPS callback URL to the Google OAuth application's authorized redirect URIs and set `GOOGLE_REDIRECT_URI` to that exact URL before connecting Gmail on the deployed site. Verify login and a read-only authenticated page on the deployed URL before enabling any external action.

**Runtime boundary:** Netlify's Next.js adapter runs pages and route handlers as serverless functions. The current JARVIS phone media gateway (`scripts/next-with-telephony.ts`) requires a long-lived WebSocket upgrade server, and `npm run worker` / `npm run scheduler` require continuously supervised processes. Importing this repository into Netlify does **not** start those processes and is not a complete production deployment of phone calls or autonomous background operations. Keep phone notifications disabled and do not point Vonage media callbacks at the Netlify URL. Those capabilities need a separate, stable always-on runtime before they can be advertised as production-ready. A local Quick Tunnel is not a substitute for production hosting.

## Production operations architecture

Provider notifications and recurring schedules never depend on an open browser or process-local job state:

```text
Google signal / scheduler / user diagnostic
  → validated server boundary
  → durable background_jobs row with deterministic deduplication key
  → atomic PostgreSQL claim (FOR UPDATE SKIP LOCKED)
  → leased worker execution
  → completed / bounded retry / dead_letter
  → provider health, internal event, notification and operation log
```

`background_jobs` is provider-neutral. Claims are performed by the `claim_background_job` database function, available only to the Supabase service role. Workers record a unique attempt, periodically extend the durable lease, and only complete a job while they still own its `locked_by` value. A dead worker's stale lease is reclaimable. Multiple instances can therefore run safely without process-local locks.

### Job lifecycle and retries

Statuses are `pending`, `scheduled`, `running`, `retrying`, `completed`, `failed`, `cancelled`, and `dead_letter`. Retryable network, 429, and temporary 5xx failures receive bounded exponential backoff with jitter (approximately 1 minute, 5 minutes, 15 minutes, and 1 hour). Credentials, permission failures, and malformed payloads are not retried indefinitely. Exhausted jobs remain inspectable in **System / Operations** and create a safe user notification without raw provider errors.

Deterministic keys cover Pub/Sub message IDs, Calendar channel/message numbers, provider history checkpoints, meeting reminders, watch renewal windows, reconciliation windows, daily briefs, internal events, and notifications. Existing approval-bound email and Calendar mutations remain synchronous and at-most-once; background analysis can summarize, classify, suggest, or draft but cannot approve or send anything.

### Worker and scheduler

```powershell
npm run worker          # continuously claims durable work
npm run worker:once     # one claim, useful for development and health checks
npm run scheduler       # scans recurring work every minute
npm run scheduler:once  # one durable scheduling pass
```

Both processes identify themselves, publish health heartbeats, handle `SIGINT`/`SIGTERM`, stop claiming new work during shutdown, and print structured safe status. With no Supabase configuration they exit in clearly labelled Demo Mode without contacting providers.

The platform-neutral scheduler enqueues watch renewal 48 hours before risk, provider health checks, hourly bounded reconciliation, daily cleanup, and user-configured morning briefs. Production must run the worker and scheduler as separately supervised services; localhost is not represented as production cron infrastructure.

### Gmail production flow

Gmail `watch` publishes to Cloud Pub/Sub. The push subscription sends a Google-signed OIDC JWT. `/api/webhooks/google/gmail` verifies the signature through Google's auth library, issuer, exact audience, expiration, verified email claim, and exact allowed service-account identity. It validates the Pub/Sub envelope, enqueues one `gmail_sync` job per Pub/Sub message ID, and acknowledges immediately. The worker later uses `history.list` from the persisted checkpoint. The checkpoint advances only after every selected message is processed; an expired history ID triggers a bounded seven-day reconciliation rather than a full mailbox download.

Configure an authenticated push subscription with:

```text
Push endpoint: https://YOUR_HOST/api/webhooks/google/gmail
OIDC audience: GOOGLE_PUBSUB_EXPECTED_AUDIENCE (normally the exact endpoint URL)
OIDC service account: GOOGLE_PUBSUB_ALLOWED_SERVICE_ACCOUNT
```

Grant the Pub/Sub service agent `roles/iam.serviceAccountTokenCreator` on the selected push-auth service account, and grant the creator `iam.serviceAccounts.actAs`. A shared query token is not accepted as a replacement for signed OIDC authentication.

```powershell
gcloud pubsub topics add-iam-policy-binding projects/PROJECT_ID/topics/TOPIC_ID --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" --role="roles/pubsub.publisher"
gcloud pubsub subscriptions create jarvis-gmail-push --topic="projects/PROJECT_ID/topics/TOPIC_ID" --push-endpoint="https://YOUR_HOST/api/webhooks/google/gmail" --push-auth-service-account="jarvis-pubsub-push@PROJECT_ID.iam.gserviceaccount.com" --push-auth-token-audience="https://YOUR_HOST/api/webhooks/google/gmail"
gcloud iam service-accounts add-iam-policy-binding "jarvis-pubsub-push@PROJECT_ID.iam.gserviceaccount.com" --member="serviceAccount:service-PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" --role="roles/iam.serviceAccountTokenCreator"
```

### Calendar production flow

Every Calendar watch uses a new random channel ID and channel token; only its SHA-256 token hash is stored. Channel ID, resource ID, token hash, expiration, connection, renewal attempt/success, and safe renewal error are persisted. The webhook matches all channel metadata against active durable state, enqueues `calendar_sync`, and returns quickly. Renewing a channel creates the replacement first and then stops the old Google channel where supported.

Calendar synchronization persists Google's `nextSyncToken`, follows bounded pagination, processes changes before advancing the token, and handles `410 Gone` with a bounded initial reconciliation. Timed meetings enqueue a duplicate-safe reminder job for 15 minutes before start.

### Provider health and observability

Settings shows connection diagnostics, granted capabilities, refresh-token presence without revealing it, token expiry, last sync, watch expiry, and safe Gmail/Calendar read tests. **System / Operations** shows provider health, running/scheduled/failed/dead-letter/recent jobs, attempts, worker/scheduler heartbeats, safe errors, retry and cancel actions, and compact metrics. Correlation IDs link webhook signals, jobs, provider processing, internal events, interactions, and notifications. Logs intentionally exclude tokens, keys, email bodies, and private Calendar descriptions.

Completed operational jobs and logs default to 30-day retention. Dead letters and business history are retained. Cleanup never removes CRM interactions, approvals, leads, or business evidence.

### Morning brief

Settings provides Daily Brief enabled/time/timezone. The scheduler creates one idempotent `daily_brief` job per local business day. The resulting JARVIS notification summarizes important notifications, meetings, high-priority leads, open tasks, and approvals. `get_daily_brief` provides the same real stored briefing on demand through text or voice without taking an external action.

### Production deployment checklist

1. Deploy the application behind public HTTPS and run migrations 0001 through `0006_v06_production_operations.sql` in order.
2. Configure Supabase public credentials only for the app; provide `SUPABASE_SERVICE_ROLE_KEY` only to the application server, trusted webhook runtime, worker, and scheduler.
3. Set the Google OAuth variables and a stable 32-byte token-encryption key.
4. Configure the Gmail Pub/Sub topic and authenticated push subscription with the exact audience and allowed service-account email.
5. Grant Gmail's publisher identity permission on the topic and Pub/Sub's service agent token-creator permission for the push identity.
6. Configure `GOOGLE_CALENDAR_WEBHOOK_BASE_URL` to the same public HTTPS deployment.
7. Start at least one supervised `npm run worker` process and exactly one or more safely duplicated `npm run scheduler` processes.
8. Use Settings diagnostics, then inspect System / Operations for worker and scheduler heartbeats.
9. Run `npm run scheduler:once`, `npm run worker:once`, renew both watches, send a duplicate test signal, and verify that only one job/notification is produced.
10. Configure production alerting around dead letters, `needs_reconnect`, expiring watches, and missing runtime heartbeats.

### Tests

```powershell
npm run typecheck
npm run lint
npm test
npm run build

# Start the app separately, then:
npm run test:e2e

# Explicit read-only dedicated Google test account only:
$env:RUN_LIVE_GOOGLE_TESTS='true'
$env:GOOGLE_LIVE_TEST_REFRESH_TOKEN='...'
npm run test:live-google
```

Live Google tests are skipped by default and never send email or mutate Calendar data. Any future write test must use an additional explicit opt-in flag.

## Google Workspace architecture

Google access is connected incrementally from Settings. The browser is redirected through a server-owned authorization-code flow with CSRF `state`, PKCE S256, fixed redirect URI, offline access, and server-side code exchange. Refresh/access tokens are stored only as versioned AES-256-GCM ciphertext; refresh tokens, client secrets, and the encryption key never reach browser JavaScript.

Capabilities and scopes:

- Gmail read: `gmail.readonly`, used for bounded thread/message reads and history synchronization.
- Gmail drafts/send: `gmail.compose`, used for Gmail drafts and only after an object-bound `send_email` approval for sending. This replaces the older `gmail.send` request; existing connections must reconnect to grant it.
- Calendar events: `calendar.events`, used for event reads and specifically approved create/update/delete operations.
- Calendar availability: `calendar.events.freebusy`, used for busy-block checks without requesting full calendar administration.
- `openid email` identifies the selected provider account. The app deliberately does not request `https://mail.google.com/` or the broad `calendar` scope.

Email bodies are marked as untrusted data before they reach JARVIS. They cannot change instructions, authorize tools, approve actions, or request secrets. Reads are bounded; JARVIS does not mirror a mailbox locally. Drafts are internal interactions; the provider adapter also supports creating a Gmail draft, but this is not an authorization to send. Gmail send validates the frozen recipient, subject, body, sending account, Gmail thread ID, and RFC reply message ID against the stored draft, claims one approval atomically, and records returned provider IDs. A draft is claimed before the provider send request; an ambiguous provider outcome remains in `sending` and is not automatically retried.

Calendar reads are safe automatic tools. Create, update, and delete tools always stop at the existing approval gate. Event approvals freeze the calendar, title, start/end, IANA timezone, attendees, location, and description. Ambiguous dates or times fail validation and require clarification.

## Google Cloud setup

1. Create/select a Google Cloud project and enable **Gmail API**. Calendar API is only needed for the separate Calendar integration; Pub/Sub is optional for push notifications.
2. Configure the OAuth consent screen. During development select Testing and add the owner's Google account as a test user.
3. Create an OAuth 2.0 Client ID of type **Web application**.
4. Add the exact local redirect URI: `http://127.0.0.1:3000/api/integrations/google/callback`. Add the production HTTPS equivalent before deployment.
5. Put the client ID/secret in `.env.local`. Generate `GOOGLE_TOKEN_ENCRYPTION_KEY` as 32 cryptographically random bytes encoded as base64; never commit it.
6. Run `supabase/migrations/0005_v05_google_workspace.sql` and `0006_v06_production_operations.sql` after migrations 0001–0004.
7. Set `GOOGLE_GMAIL_ENABLED=true` and/or `GOOGLE_CALENDAR_ENABLED=true`, restart JARVIS, then connect each capability from Settings.
8. Public apps using Gmail restricted scopes may require Google OAuth verification and an independent security assessment. Keep the app in Testing for private development until that process is complete.

### Production Gmail push

Create a Pub/Sub topic in the same Cloud project, grant `gmail-api-push@system.gserviceaccount.com` permission to publish, and create an authenticated push subscription targeting `https://YOUR_HOST/api/webhooks/google/gmail`. Set the exact OIDC audience and push service-account identity in `GOOGLE_PUBSUB_EXPECTED_AUDIENCE` and `GOOGLE_PUBSUB_ALLOWED_SERVICE_ACCOUNT`. The durable scheduler renews Gmail watches ahead of expiration; Pub/Sub remains only a signal and never performs synchronization inside the webhook request.

### Production Calendar watch

Set `GOOGLE_CALENDAR_WEBHOOK_BASE_URL` to the public HTTPS origin. JARVIS generates a different cryptographically random token for every channel and stores only its hash. The scheduler renews channels ahead of expiration, replaces old channels safely, and the webhook validates persisted channel/token/resource state before enqueuing an incremental sync.

Localhost cannot receive Google push webhooks. Without Pub/Sub, the durable scheduler uses hourly reconciliation and the Settings sync button provides an on-demand bounded read. Push/watch jobs are not scheduled until their public provider configuration exists.

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
   - `supabase/migrations/0006_v06_production_operations.sql`
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
GOOGLE_PUBSUB_TOPIC=
GOOGLE_PUBSUB_EXPECTED_AUDIENCE=
GOOGLE_PUBSUB_ALLOWED_SERVICE_ACCOUNT=
GOOGLE_CALENDAR_WEBHOOK_BASE_URL=
JOB_LOCK_TIMEOUT_SECONDS=300
JOB_MAX_ATTEMPTS=4
OPERATIONS_RETENTION_DAYS=30
RESEARCH_MAX_LEADS=50
```

`OPENAI_RESEARCH_MODEL` is optional and falls back to `OPENAI_MODEL`. The application hard-caps a run at 50 candidates even if configuration is incorrect.

## MULTI-PROVIDER AI SETUP

1. Put `GROQ_API_KEY`, `GEMINI_API_KEY`, and `OPENROUTER_API_KEY` in the **server-only** `.env.local` at the project root. Do not prefix them with `NEXT_PUBLIC_`; do not commit `.env.local`.
2. Restart `npm run dev` (or the full JARVIS stack). The normal text/tool agent and Greek outreach/website interpretation try Groq → Gemini → OpenRouter Free → OpenAI. Missing keys are skipped. A configured provider is not considered live-verified until it successfully answers a request.
3. Change `GROQ_MODEL`, `GEMINI_MODEL`, `OPENROUTER_MODEL`, or `OPENAI_FALLBACK_MODEL` in `.env.local` when provider model availability changes. OpenRouter accepts only `openrouter/free` or a model slug ending `:free`; a paid slug is refused. The default Groq model is `openai/gpt-oss-120b` and the Gemini default is `gemini-3.8-flash` (verify availability for your account).
4. Set `AI_ALLOW_PAID_FALLBACK=false` and restart to disable paid OpenAI routing **and** the OpenAI-only citation-backed live research service. With only the existing OpenAI key, leave the default `true` to retain the prior text-agent behavior. Voice/phone OpenAI Live is a separate, explicitly enabled integration, not a router fallback.
5. View provider status and process-local counters in **Operations → AI Providers**. Expand a JARVIS run to see final provider, model, latency and the attempt chain. Metrics exclude prompts, outputs, keys and response bodies; they reset on app-process restart.
6. To test Groq, configure `GROQ_API_KEY`, open the local JARVIS command center, ask a harmless text question, then inspect the run and Operations. To force a safe local Groq failure, configure Groq **and** Gemini keys, set `AI_DEV_FORCE_GROQ_429=true` in `.env.local`, restart the development server, and make one harmless text request. The run should show `Groq RATE_LIMIT → Gemini SUCCESS`; reset the flag afterward. This simulation is ignored outside `NODE_ENV=development`. HTTP 400 intentionally does not trigger provider hopping.
7. To verify OpenRouter Free fallback, configure its key with `OPENROUTER_MODEL=openrouter/free` and use the router tests or a genuine Groq/Gemini quota/outage. A missing upstream key skips that provider; the OpenRouter attempt must report a free model/router, and OpenAI must not be attempted if OpenRouter succeeds.

The final paid text-agent fallback still uses the OpenAI Responses API with the existing typed tool contract. Existing OpenAI Responses-based citation research and Live voice/phone bridges remain specialized: generic free text responses cannot be silently substituted for web-search citations or real-time audio. The router does not store full prompts or responses in metrics. Provider-account billing is controlled by the provider account; Groq/Gemini model pricing can differ between free and paid tiers, so configure those accounts' own spending controls if strict zero spend is required. Free-tier provider policies may permit processing submitted business data for product improvement; review each account's data controls before routing sensitive CRM content.

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

The unit/security suite covers SSRF URLs and redirects, timeout/size/content limits, injection boundaries, evidence-only scoring, deterministic dedupe, durable job concurrency, stale lease recovery, bounded retries, dead letters, user isolation, signed Pub/Sub claim validation, Calendar channel validation, Google OAuth state and token encryption, notification dedupe, untrusted email handling, frozen approvals, at-most-once email delivery, Calendar timezone validation, the shared text/voice tool loop, and repository persistence. Playwright separately covers the critical credential-free browser flows. Default tests do not call Google, OpenAI, or paid services.

## Troubleshooting

- **Header says RESEARCH OFF:** set both `OPENAI_API_KEY` and `LIVE_RESEARCH_ENABLED=true`, then restart Next.js.
- **Demo results appear:** Demo Mode deliberately uses fictional `.example` records. Configure Supabase to enter Live Mode.
- **Research returns no candidates:** the provider failed or returned no cited candidates; JARVIS does not fabricate replacements.
- **Website signals are Unknown:** the official site was not confidently identified or the secure fetcher rejected/timed out. Inspect the run steps and sources.
- **Database errors after upgrade:** run migrations in order through `0006_v06_production_operations.sql`; do not skip any earlier migration.
- **A partial run remains:** reopening/continuing it is safe; processed candidates are not duplicated.
- **Google says redirect URI mismatch:** copy `GOOGLE_REDIRECT_URI` exactly into the OAuth Web Client authorized redirect URIs.
- **Gmail send is not available:** reconnect Gmail and grant both displayed Gmail scopes; sending still requires a specific approval.
- **Google needs reconnect:** the refresh token was revoked/expired; use Reconnect in Settings. JARVIS does not retry forever.
- **Push does not work locally:** expected. Use explicit diagnostic sync; Gmail Pub/Sub and Calendar watches require public trusted HTTPS endpoints. Run the worker and scheduler separately.
- **Voice says unavailable:** voice intentionally requires Live Mode, `OPENAI_API_KEY`, and `VOICE_ENABLED=true`.
- **Microphone is blocked:** grant microphone permission to the localhost/HTTPS origin and start a new session.
- **Voice disconnects:** JARVIS attempts one bounded reconnect; text mode stays available throughout.

## Known limitations

Live Google behavior requires owner-provided OAuth credentials and a migrated Supabase project; it cannot be end-to-end tested with repository-only fixtures. Localhost supports explicit diagnostics but cannot receive Google push delivery. Gmail and Calendar change notifications are signals and may be delayed or occasionally missed, so production retains periodic bounded reconciliation. Live Research depends on public web availability and the configured model. Realtime voice depends on browser WebRTC/microphone support. JARVIS does not bypass access controls, solve CAPTCHAs, scrape authenticated pages, or guarantee exhaustive coverage. In-memory Demo Mode resets on server restart. Production rate limits, jobs, leases, schedules, health, and renewal state are shared in PostgreSQL, but the worker and scheduler processes must still be deployed and supervised by the operator.
