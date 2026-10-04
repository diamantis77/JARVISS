# Daily Missions (local implementation)

Daily Missions use the existing owner-scoped Supabase database, durable worker,
research service, CRM, approval system, Gmail synchronization and JARVIS tool
loop. The schema is in `supabase/migrations/0013_daily_missions.sql`.

## Activation boundary

- Migration 0013 must be applied once to the intended Supabase project. The UI
  reports unavailable until the remote `missions` table is actually readable.
- A newly created mission is **paused**. Research begins only after an owner
  resumes it, within its configured working hours.
- Outreach is a draft. The default is `APPROVAL_REQUIRED`; sending requires a
  connected Gmail provider and the existing exact-payload approval flow.
- `PREAPPROVED_CAMPAIGN` is represented in the schema but is deliberately not
  accepted by the API until a complete owner-defined campaign policy and
  rate-limit/stop-condition executor are implemented. No bulk send is active.
- Mission phone notifications are disabled by default, even if per-mission
  rules are saved. Deployment opt-in requires
  `MISSION_PHONE_NOTIFICATIONS_ENABLED=true`, an owner-enabled HIGH/URGENT
  mission rule, and the existing global phone policy. Calls remain owner-only,
  respect calling hours and cooldown, and have no automatic provider retry.
- Calendar booking is not automatic. A meeting request is stored as a request
  with source reply and linked opportunity; any external booking still needs
  the existing calendar approval tool.

## Data integrity

Mission rows, runs, targets, outreach, replies, opportunities, appointments,
events and briefings are owner-scoped. Mission runs, targets, provider replies,
outreach payloads and phone event dispatches have stable deduplication keys.
Opt-outs are stored separately from mission state and checked again immediately
before an approved email is sent. Daily briefing counts are calculated from
persisted rows in the mission's configured timezone; no estimated counts are
substituted for missing data.
