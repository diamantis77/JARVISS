# JARVIS v0.4 · Realtime Voice

JARVIS is an authenticated, persistent AI business command center. v0.4 adds full-duplex Greek/English voice while preserving the same v0.3 tool loop, Supabase isolation, research pipeline, streaming runs, and approval gates.

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

Research, fetching, analysis, scoring, and internal persistence are safe automatic operations. External or sensitive tools such as email sending and important CRM changes still stop at the authoritative application approval gate. No Gmail, Twilio, calendar, mass outreach, or autonomous contacting capability is added in v0.3. Approval does not imply delivery; the email provider remains disconnected.

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Tests cover SSRF URLs and redirects, timeout/size/content limits, injection boundaries, evidence-only scoring, deterministic dedupe, persisted resume/cancel behavior, user-scoped evidence, tool authorization, the existing tool loop, approvals, voice state transitions, ambiguous voice approval protection, and repository persistence. Tests do not call OpenAI or paid services.

## Troubleshooting

- **Header says RESEARCH OFF:** set both `OPENAI_API_KEY` and `LIVE_RESEARCH_ENABLED=true`, then restart Next.js.
- **Demo results appear:** Demo Mode deliberately uses fictional `.example` records. Configure Supabase to enter Live Mode.
- **Research returns no candidates:** the provider failed or returned no cited candidates; JARVIS does not fabricate replacements.
- **Website signals are Unknown:** the official site was not confidently identified or the secure fetcher rejected/timed out. Inspect the run steps and sources.
- **Database errors after upgrade:** run migration `0003_v03_live_research.sql` after the first two migrations.
- **A partial run remains:** reopening/continuing it is safe; processed candidates are not duplicated.
- **An approved email is not sent:** expected. v0.3 does not connect an email provider.
- **Voice says unavailable:** voice intentionally requires Live Mode, `OPENAI_API_KEY`, and `VOICE_ENABLED=true`.
- **Microphone is blocked:** grant microphone permission to the localhost/HTTPS origin and start a new session.
- **Voice disconnects:** JARVIS attempts one bounded reconnect; text mode stays available throughout.

## Known limitations

Live Research depends on public web availability, the configured OpenAI model's web-search support, and the target site's willingness to serve public HTML. Realtime voice depends on browser WebRTC/microphone support and the configured GPT-Live model. It does not execute JavaScript, bypass access controls, solve CAPTCHAs, scrape authenticated pages, or guarantee exhaustive market coverage. In-memory Demo Mode resets on server restart. Rate limiting is process-local and should use shared infrastructure in multi-instance production.
