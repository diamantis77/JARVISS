-- JARVIS v0.6: durable production operations.
alter table public.settings
  add column if not exists daily_brief_enabled boolean not null default false,
  add column if not exists daily_brief_time time not null default '08:30';

alter table public.provider_watch_channels
  add column if not exists last_renewal_attempt_at timestamptz,
  add column if not exists last_renewal_success_at timestamptz,
  add column if not exists renewal_error text;

create table if not exists public.background_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  job_type text not null check (job_type in ('gmail_sync','gmail_watch_renewal','calendar_sync','calendar_watch_renewal','provider_health_check','research_continue','notification_process','notification_cleanup','provider_reconciliation','daily_brief')),
  status text not null default 'pending' check (status in ('pending','scheduled','running','retrying','completed','failed','cancelled','dead_letter')),
  payload jsonb not null default '{}',
  priority integer not null default 50 check (priority between 0 and 100),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 20),
  scheduled_for timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  deduplication_key text,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint background_jobs_dedupe_unique unique (deduplication_key)
);

create table if not exists public.job_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.background_jobs(id) on delete cascade,
  attempt integer not null,
  worker_id text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outcome text check (outcome is null or outcome in ('completed','retrying','failed','dead_letter')),
  duration_ms integer,
  safe_error text,
  unique(job_id, attempt)
);

create table if not exists public.internal_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}',
  correlation_id uuid not null,
  deduplication_key text,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  unique(deduplication_key)
);

create table if not exists public.provider_health (
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('gmail','calendar')),
  status text not null default 'healthy' check (status in ('healthy','degraded','needs_reconnect','watch_expiring','disconnected','error')),
  last_successful_api_call_at timestamptz,
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  watch_expiration timestamptz,
  consecutive_failures integer not null default 0,
  last_error_category text,
  last_error_summary text,
  updated_at timestamptz not null default now(),
  primary key(connection_id, capability)
);

create table if not exists public.operation_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade,
  correlation_id uuid,
  job_id uuid references public.background_jobs(id) on delete set null,
  provider text,
  job_type text,
  attempt integer,
  outcome text not null,
  duration_ms integer,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  task_key text not null,
  job_type text not null,
  payload jsonb not null default '{}',
  interval_seconds integer check (interval_seconds is null or interval_seconds >= 60),
  local_time time,
  timezone text,
  enabled boolean not null default true,
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists scheduled_tasks_owner_key_idx on public.scheduled_tasks(coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), task_key);

create table if not exists public.operation_runtime (
  runtime_id text primary key,
  runtime_type text not null check (runtime_type in ('worker','scheduler')),
  version text not null,
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);

create table if not exists public.distributed_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  request_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists background_jobs_claim_idx on public.background_jobs(status, scheduled_for, priority desc, created_at);
create index if not exists background_jobs_user_created_idx on public.background_jobs(user_id, created_at desc);
create index if not exists job_attempts_job_idx on public.job_attempts(job_id, attempt desc);
create index if not exists internal_events_user_time_idx on public.internal_events(user_id, occurred_at desc);
create index if not exists operation_logs_created_idx on public.operation_logs(created_at desc);
create index if not exists scheduled_tasks_due_idx on public.scheduled_tasks(enabled, next_run_at);
create unique index if not exists interactions_provider_message_unique_idx on public.interactions(provider, provider_message_id) where provider_message_id is not null;

alter table public.background_jobs enable row level security;
alter table public.job_attempts enable row level security;
alter table public.internal_events enable row level security;
alter table public.provider_health enable row level security;
alter table public.operation_logs enable row level security;
alter table public.scheduled_tasks enable row level security;
alter table public.operation_runtime enable row level security;
alter table public.distributed_rate_limits enable row level security;

create policy "read own background jobs" on public.background_jobs for select using (auth.uid() = user_id);
create policy "read own job attempts" on public.job_attempts for select using (exists (select 1 from public.background_jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy "read own internal events" on public.internal_events for select using (auth.uid() = user_id);
create policy "read own provider health" on public.provider_health for select using (auth.uid() = user_id);
create policy "read own operation logs" on public.operation_logs for select using (auth.uid() = user_id);
create policy "own scheduled tasks" on public.scheduled_tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "authenticated runtime health" on public.operation_runtime for select using (auth.role() = 'authenticated');

create or replace function public.claim_background_job(p_worker_id text, p_lock_timeout_seconds integer default 300)
returns setof public.background_jobs
language plpgsql
security definer
set search_path = public
as $$
declare v_job_id uuid;
begin
  select id into v_job_id
  from public.background_jobs
  where attempt_count < max_attempts
    and (
      (status in ('pending','scheduled','retrying') and scheduled_for <= now())
      or (status = 'running' and locked_at < now() - make_interval(secs => greatest(p_lock_timeout_seconds, 30)))
    )
  order by priority desc, scheduled_for, created_at
  for update skip locked
  limit 1;
  if v_job_id is null then return; end if;
  update public.background_jobs
  set status = 'running', locked_at = now(), locked_by = p_worker_id,
      attempt_count = attempt_count + 1, started_at = coalesce(started_at, now()), last_error = null
  where id = v_job_id;
  insert into public.job_attempts(job_id, attempt, worker_id)
  select id, attempt_count, p_worker_id from public.background_jobs where id = v_job_id
  on conflict (job_id, attempt) do nothing;
  return query select * from public.background_jobs where id = v_job_id;
end;
$$;

create or replace function public.consume_rate_limit(p_bucket_key text, p_limit integer, p_window_seconds integer)
returns table(allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.distributed_rate_limits%rowtype;
begin
  insert into public.distributed_rate_limits(bucket_key, window_started_at, request_count)
  values (p_bucket_key, now(), 1)
  on conflict (bucket_key) do update set
    window_started_at = case when distributed_rate_limits.window_started_at <= now() - make_interval(secs => greatest(p_window_seconds, 1)) then now() else distributed_rate_limits.window_started_at end,
    request_count = case when distributed_rate_limits.window_started_at <= now() - make_interval(secs => greatest(p_window_seconds, 1)) then 1 else distributed_rate_limits.request_count + 1 end,
    updated_at = now()
  returning * into v_row;
  allowed := v_row.request_count <= p_limit;
  retry_after := greatest(0, ceil(extract(epoch from (v_row.window_started_at + make_interval(secs => p_window_seconds) - now())))::integer);
  return next;
end;
$$;

revoke all on function public.claim_background_job(text, integer) from public, anon, authenticated;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.claim_background_job(text, integer) to service_role;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

drop trigger if exists provider_health_set_updated_at on public.provider_health;
create trigger provider_health_set_updated_at before update on public.provider_health for each row execute function public.set_updated_at();
drop trigger if exists scheduled_tasks_set_updated_at on public.scheduled_tasks;
create trigger scheduled_tasks_set_updated_at before update on public.scheduled_tasks for each row execute function public.set_updated_at();
