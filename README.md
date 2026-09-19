# JARVIS v0.2 · Personal AI Business OS

JARVIS is an authenticated, persistent AI command center for business operations. A natural-language command becomes a stored run, the AI may select narrowly scoped tools, every visible step represents real backend work, and sensitive or external actions stop at an application-enforced approval gate.

The existing premium interface remains demo-first: the app works without credentials using fictional in-memory data, while configured installations use Supabase and optionally OpenAI.

## Runtime modes

| Mode | Activated when | Data | AI |
| --- | --- | --- | --- |
| **Demo Mode** | Supabase variables are absent | Fictional seeded data, reset on server restart | Deterministic local demo provider |
| **Live Mode · Demo AI** | Supabase is configured but `OPENAI_API_KEY` is absent | Authenticated, persistent Supabase data | Deterministic demo provider |
| **Live Mode** | Supabase and OpenAI are configured | Authenticated, persistent Supabase data | OpenAI Responses API |

Demo Mode never reports that an external action succeeded. Email, website research, lead search, telephony, calendar, and voice providers remain disconnected in v0.2.

## Quick start in Demo Mode

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Leave the Supabase and OpenAI values empty, then open `http://localhost:3000`. Authentication is intentionally bypassed only in Demo Mode.

## Architecture

```text
app/                         Next.js pages, auth actions, and API routes
components/                  Existing command center, CRM, auth, approval UI
lib/ai/                      Provider-neutral AI contract, OpenAI and demo adapters
lib/ai/instructions/         Versioned server-only JARVIS instructions
lib/jarvis/tool-loop.ts      Persistent model/tool/approval execution loop
lib/repositories/            Typed interfaces plus demo and Supabase implementations
lib/supabase/                Cookie-aware browser, server, and middleware clients
lib/tools/                   Zod schemas, registry, permission gate, tool handlers
supabase/migrations/         Additive PostgreSQL schema and RLS hardening
tests/                       Security, repository, tools, loop, and persistence tests
```

The browser never calls OpenAI or the database with a supplied user ID. Live repositories obtain the authenticated user on the server, add an explicit `user_id` predicate to user-owned queries, and are backed by Row Level Security.

## Environment variables

Copy `.env.example` to `.env.local`.

| Variable | Required | Where it comes from |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Live Mode | Supabase Dashboard → Project Settings → Data API → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Live Mode | Supabase Dashboard → Project Settings → API Keys → Publishable key |
| `OPENAI_API_KEY` | Real AI | OpenAI Platform → API keys; server-only, never prefix with `NEXT_PUBLIC_` |
| `OPENAI_MODEL` | Optional | Defaults to `gpt-5`; choose a Responses API model available to the project |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY` | Not used yet | Reserved provider boundary; email sending remains disabled |
| `TELEPHONY_PROVIDER`, `TELEPHONY_API_KEY` | Not used yet | Reserved provider boundary; calling remains disabled |

Do not add a Supabase service-role key. Normal v0.2 operations use the signed-in user's cookie session and RLS.

## Exact Supabase setup

1. Create a Supabase project.
2. Open **SQL Editor** and run, in order:
   - `supabase/migrations/0001_initial_schema.sql`
   - `supabase/migrations/0002_v02_auth_persistence.sql`
3. In **Authentication → Providers**, enable Email. Decide whether email confirmation is required for the project.
4. In **Authentication → URL Configuration** set:
   - Site URL for local development: `http://localhost:3000`
   - Redirect URL: `http://localhost:3000/auth/callback`
   - Add the equivalent HTTPS callback URL for each deployed environment.
5. Copy the Project URL and Publishable key into `.env.local`.
6. Restart `npm run dev`, visit `/auth/sign-up`, confirm the email if enabled, then complete `/onboarding`.

The second migration is additive. It preserves the original schema, adds run context and approval resolution data, supplies missing indexes and update triggers, hardens child-table `USING` and `WITH CHECK` policies, and creates profile/settings rows after signup.

## Exact OpenAI setup

1. Create or select an OpenAI API project in the OpenAI Platform.
2. Create a project API key and store it as `OPENAI_API_KEY` in `.env.local`.
3. Optionally set `OPENAI_MODEL`; otherwise JARVIS uses `gpt-5`.
4. Restart the development server.

All requests use the server-side OpenAI SDK and the Responses API. The provider only asks for tool calls; application code validates arguments, checks permissions, executes registered tools, persists results, and returns tool output to the model.

## Authentication and route protection

`middleware.ts` refreshes the cookie-based Supabase session and verifies identity with `getClaims()`. In Live Mode every application and API route is protected except the sign-in, sign-up, password recovery, update-password, and auth callback routes. Sign out is a server action and clears only the current local session.

Password reset emails return through `/auth/callback?next=/auth/update-password`. If confirmation or reset links return to the wrong host, recheck Supabase Site URL and Redirect URLs.

## Tool architecture

Every tool has:

- a stable name and user-facing description;
- Zod input and output schemas;
- a JSON schema exposed to the model;
- a fixed `SAFE_AUTOMATIC` or `REQUIRES_USER_APPROVAL` permission;
- a handler that receives only the scoped repository bundle and runtime mode.

Safe persistent tools include CRM lookup/search/save, tasks, activity, analysis, scoring, and draft creation. `search_leads`, `get_business_details`, and `analyze_website` report that no external provider is connected instead of fabricating research.

## JARVIS tool loop

1. Validate the command and create a persistent `jarvis_run`.
2. Persist the real “Understanding request” step.
3. Load business settings and only a small structured summary of recent runs.
4. Ask the selected AI provider for a response and optional registered tool calls.
5. Parse and validate every argument with Zod.
6. Execute safe tools through the registry, persist step output, and return it to the model.
7. Repeat up to the bounded iteration limit or persist the concise final response.
8. Stream newline-delimited JSON run, step, approval, completion, or error events to the command center.

Hidden chain-of-thought is never displayed. The UI shows only plan labels, tool names, state changes, and concise outputs.

## Approval security

The model cannot grant approval. `send_email` and sensitive CRM updates are marked `REQUIRES_USER_APPROVAL` in source code. When requested, the loop validates the payload, creates an approval record, marks the run `waiting_for_approval`, and returns without calling the handler.

Approve, Edit, and Reject operate on the authenticated user's persistent approval. Approval execution reloads the record, verifies it is still pending, re-resolves the registered tool and permission, revalidates the stored payload against the current schema, and only then invokes the single approved action. The result or failure and resolver identity are persisted and logged.

Email still returns `sent: false` because no email provider is connected; approval never implies successful delivery.

## Quality checks

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

Tests do not contact OpenAI or require paid services. They cover protected-route decisions, explicit repository user scoping and cross-user isolation, safe and approval-only tool execution, malformed input, direct and multi-tool AI turns, approval pauses, graceful failures, and run/step/approval persistence.

## Troubleshooting

- **The app says Demo Mode:** both Supabase public variables must be non-empty; restart Next.js after changing `.env.local`.
- **Sign-in redirects back to sign-in:** verify the Project URL/key pair, Email provider, browser cookies, and local callback URL.
- **A new user has no settings:** confirm `0002_v02_auth_persistence.sql` ran successfully and the `on_auth_user_created` trigger exists.
- **Database permission error:** do not use a service key. Confirm both migrations ran and that requests carry the authenticated user's cookie session.
- **JARVIS says it could not complete a run:** verify the OpenAI key/model and network access. Stored data remains intact; remove the OpenAI key to use Demo AI while diagnosing.
- **An external lookup returns Unknown:** this is expected in v0.2 because no live research provider is connected.
- **An approved email is not sent:** expected; email delivery is deliberately unimplemented and never simulated as successful.

## Known limitations

v0.2 intentionally does not implement scraping, Gmail, mass outreach, Twilio/phone calls, voice sessions, calendars, autonomous outreach, or multi-agent orchestration. Rate limiting is per running application instance, and production deployments should replace it with a shared store. Demo repositories are in memory and reset when the server restarts.
