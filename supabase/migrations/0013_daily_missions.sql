-- Daily Missions: additive, owner-scoped state. Applying this migration does
-- not activate a mission or authorize email/phone/calendar mutations.
alter table public.background_jobs drop constraint if exists background_jobs_job_type_check;
alter table public.background_jobs add constraint background_jobs_job_type_check
  check (job_type in ('gmail_sync','gmail_watch_renewal','calendar_sync','calendar_watch_renewal','provider_health_check','research_continue','notification_process','notification_cleanup','provider_reconciliation','daily_brief','outbound_jarvis_call','mission_tick','mission_brief'));

create unique index if not exists leads_id_user_unique_idx on public.leads(id, user_id);
create unique index if not exists research_runs_id_user_unique_idx on public.research_runs(id, user_id);
create unique index if not exists research_candidates_id_user_unique_idx on public.research_candidates(id, user_id);

create table if not exists public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 3 and 200),
  industry text not null check (length(industry) between 2 and 160),
  geography text not null check (length(geography) between 2 and 160),
  goal text not null check (length(goal) between 3 and 1000),
  criteria_json jsonb not null default '{}',
  daily_target_limit integer not null default 20 check (daily_target_limit between 1 and 50),
  work_start time not null default '09:00',
  work_end time not null default '20:30',
  briefing_time time not null default '20:30',
  timezone text not null default 'Europe/Athens',
  status text not null default 'paused' check (status in ('active','paused','stopped')),
  outreach_mode text not null default 'APPROVAL_REQUIRED' check (outreach_mode in ('DRAFT_ONLY','APPROVAL_REQUIRED','PREAPPROVED_CAMPAIGN')),
  outreach_policy_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, user_id)
);

create table if not exists public.mission_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  local_date date not null,
  status text not null default 'pending' check (status in ('pending','running','partial','completed','paused','failed')),
  research_run_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mission_id, local_date), unique(id, user_id),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
  foreign key (research_run_id,user_id) references public.research_runs(id,user_id) on delete set null (research_run_id)
);

create table if not exists public.mission_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  mission_run_id uuid not null,
  normalized_key text not null,
  lead_id uuid,
  status text not null default 'discovered' check (status in ('discovered','analyzed','qualified','contacted','replied','declined','interested','meeting','do_not_contact')),
  source_candidate_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(mission_id,normalized_key), unique(id,user_id),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
  foreign key (mission_run_id,user_id) references public.mission_runs(id,user_id) on delete cascade,
  foreign key (lead_id,user_id) references public.leads(id,user_id) on delete set null (lead_id),
  foreign key (source_candidate_id,user_id) references public.research_candidates(id,user_id) on delete set null (source_candidate_id)
);

create table if not exists public.mission_outreach (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  target_id uuid not null,
  status text not null default 'draft' check (status in ('draft','pending_approval','approved','sent','rejected','blocked')),
  recipient_email text not null,
  subject text not null,
  body text not null,
  payload_hash text not null,
  draft_interaction_id uuid unique references public.interactions(id) on delete set null,
  approval_id uuid references public.approvals(id) on delete set null,
  provider_message_id text,
  provider_thread_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(target_id), unique(mission_id,payload_hash), unique(id,user_id),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
  foreign key (target_id,user_id) references public.mission_targets(id,user_id) on delete cascade
);
create unique index if not exists mission_outreach_provider_message_idx on public.mission_outreach(provider_message_id) where provider_message_id is not null;

create table if not exists public.contact_suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  normalized_email text not null,
  reason text not null check (reason in ('unsubscribe','do_not_contact','declined')),
  source_key text not null,
  created_at timestamptz not null default now(),
  unique(user_id,normalized_email)
);

create table if not exists public.mission_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  outreach_id uuid not null,
  provider_message_id text not null,
  classification text not null check (classification in ('INTERESTED','QUESTION','MEETING_REQUEST','NOT_INTERESTED','UNSUBSCRIBE','UNCLEAR')),
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(id,user_id), unique(user_id,provider_message_id),
  foreign key (outreach_id,user_id) references public.mission_outreach(id,user_id) on delete cascade
);

create table if not exists public.mission_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  target_id uuid not null unique,
  status text not null default 'open' check (status in ('open','meeting_requested','meeting_booked','won','lost')),
  estimated_value_eur numeric(12,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,user_id),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
  foreign key (target_id,user_id) references public.mission_targets(id,user_id) on delete cascade
);

create table if not exists public.mission_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_id uuid not null,
  source_reply_id uuid,
  provider_event_id text unique,
  person_name text,
  business_name text,
  source_email text,
  requested_time_text text,
  context_text text,
  requested_at timestamptz,
  scheduled_at timestamptz,
  status text not null default 'requested' check (status in ('requested','pending_approval','booked','cancelled')),
  created_at timestamptz not null default now(),
  unique(source_reply_id),
  foreign key (opportunity_id,user_id) references public.mission_opportunities(id,user_id) on delete cascade,
  foreign key (source_reply_id,user_id) references public.mission_replies(id,user_id) on delete set null (source_reply_id)
);

create table if not exists public.mission_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  mission_run_id uuid,
  event_type text not null,
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  source_key text not null,
  metadata_json jsonb not null default '{}',
  phone_dispatch_status text not null default 'not_requested' check (phone_dispatch_status in ('not_requested','reserved','queued','blocked','unknown')),
  phone_call_id uuid references public.phone_calls(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(mission_id,source_key),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade,
  foreign key (mission_run_id,user_id) references public.mission_runs(id,user_id) on delete set null (mission_run_id)
);

create table if not exists public.mission_notification_rules (
  mission_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  priority text not null check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  dashboard_enabled boolean not null default true,
  phone_enabled boolean not null default false,
  cooldown_minutes integer not null default 120 check (cooldown_minutes between 5 and 1440),
  last_phone_queued_at timestamptz,
  primary key(mission_id,priority),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade
);

create table if not exists public.mission_daily_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mission_id uuid not null,
  local_date date not null,
  metrics_json jsonb not null,
  summary text not null,
  generated_at timestamptz not null default now(),
  unique(mission_id,local_date),
  foreign key (mission_id,user_id) references public.missions(id,user_id) on delete cascade
);

create index if not exists missions_scheduler_idx on public.missions(status,work_start,work_end);
create index if not exists mission_runs_owner_date_idx on public.mission_runs(user_id,local_date desc);
create index if not exists mission_targets_mission_status_idx on public.mission_targets(mission_id,status);
create index if not exists mission_events_owner_time_idx on public.mission_events(user_id,created_at desc);
create index if not exists mission_outreach_owner_status_idx on public.mission_outreach(user_id,status);

alter table public.missions enable row level security;
alter table public.mission_runs enable row level security;
alter table public.mission_targets enable row level security;
alter table public.mission_outreach enable row level security;
alter table public.contact_suppressions enable row level security;
alter table public.mission_replies enable row level security;
alter table public.mission_opportunities enable row level security;
alter table public.mission_appointments enable row level security;
alter table public.mission_events enable row level security;
alter table public.mission_notification_rules enable row level security;
alter table public.mission_daily_briefings enable row level security;

create policy "own missions" on public.missions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission runs" on public.mission_runs for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission targets" on public.mission_targets for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission outreach" on public.mission_outreach for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own contact suppressions" on public.contact_suppressions for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission replies" on public.mission_replies for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission opportunities" on public.mission_opportunities for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission appointments" on public.mission_appointments for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission events" on public.mission_events for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission notification rules" on public.mission_notification_rules for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
create policy "own mission briefings" on public.mission_daily_briefings for all using (auth.uid()=user_id) with check (auth.uid()=user_id);

create trigger missions_set_updated_at before update on public.missions for each row execute function public.set_updated_at();
create trigger mission_runs_set_updated_at before update on public.mission_runs for each row execute function public.set_updated_at();
create trigger mission_targets_set_updated_at before update on public.mission_targets for each row execute function public.set_updated_at();
create trigger mission_outreach_set_updated_at before update on public.mission_outreach for each row execute function public.set_updated_at();
create trigger mission_opportunities_set_updated_at before update on public.mission_opportunities for each row execute function public.set_updated_at();
