-- JARVIS Phone: owner-only outbound calls, conservative policy, and auditable state.
alter table public.background_jobs drop constraint if exists background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('gmail_sync','gmail_watch_renewal','calendar_sync','calendar_watch_renewal','provider_health_check','research_continue','notification_process','notification_cleanup','provider_reconciliation','daily_brief','outbound_jarvis_call'));

create table if not exists public.phone_notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  allowed_start time not null default '09:00',
  allowed_end time not null default '23:00',
  outside_hours text not null default 'never' check (outside_hours in ('never','urgent_only')),
  morning_brief boolean not null default false,
  hot_lead boolean not null default false,
  meeting_soon boolean not null default false,
  important_failure boolean not null default false,
  max_call_minutes integer not null default 10 check (max_call_minutes between 1 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  direction text not null default 'outbound' check (direction = 'outbound'),
  provider text not null default 'twilio' check (provider = 'twilio'),
  provider_call_id text,
  provider_status text,
  status text not null default 'queued' check (status in ('queued','dialing','ringing','in_progress','completed','failed','busy','no_answer','cancelled')),
  reason text not null check (char_length(reason) between 2 and 500),
  context_json jsonb not null default '{}',
  jarvis_run_id uuid references public.jarvis_runs(id) on delete set null,
  deduplication_key text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  live_session_duration_seconds integer check (live_session_duration_seconds is null or live_session_duration_seconds >= 0),
  error_category text,
  error_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider_call_id),
  unique(deduplication_key)
);

create index if not exists phone_calls_user_created_idx on public.phone_calls(user_id, created_at desc);
create index if not exists phone_calls_provider_idx on public.phone_calls(provider_call_id) where provider_call_id is not null;

alter table public.phone_notification_settings enable row level security;
alter table public.phone_calls enable row level security;

create policy "own phone notification settings" on public.phone_notification_settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "read own phone calls" on public.phone_calls for select
  using (auth.uid() = user_id);

drop trigger if exists phone_notification_settings_set_updated_at on public.phone_notification_settings;
create trigger phone_notification_settings_set_updated_at before update on public.phone_notification_settings
  for each row execute function public.set_updated_at();
drop trigger if exists phone_calls_set_updated_at on public.phone_calls;
create trigger phone_calls_set_updated_at before update on public.phone_calls
  for each row execute function public.set_updated_at();
