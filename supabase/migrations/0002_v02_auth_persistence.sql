-- JARVIS v0.2: additive persistence and ownership hardening.
alter table public.jarvis_runs
  add column if not exists current_step integer not null default 0,
  add column if not exists context_json jsonb not null default '{}',
  add column if not exists provider_response_id text;

alter table public.leads
  add column if not exists review_count integer check (review_count is null or review_count >= 0);

alter table public.lead_analysis
  add column if not exists evidence jsonb not null default '[]';

alter table public.jarvis_run_steps
  add column if not exists error_message text;

alter table public.approvals
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references auth.users(id) on delete set null,
  add column if not exists result_json jsonb,
  add column if not exists execution_error text,
  add column if not exists updated_at timestamptz not null default now();

alter table public.settings
  add column if not exists updated_at timestamptz not null default now();

create index if not exists run_steps_run_status_idx on public.jarvis_run_steps(run_id, status);
create index if not exists approvals_run_status_idx on public.approvals(run_id, status, created_at desc);
create index if not exists tasks_user_status_due_idx on public.tasks(user_id, status, due_at);
create index if not exists interactions_lead_created_idx on public.interactions(lead_id, created_at desc);
create index if not exists analysis_lead_created_idx on public.lead_analysis(lead_id, created_at desc);

-- A task may only point at another record owned by the same authenticated user.
drop policy if exists "own tasks" on public.tasks;
create policy "own tasks" on public.tasks for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (lead_id is null or exists (
      select 1 from public.leads l where l.id = tasks.lead_id and l.user_id = auth.uid()
    ))
  );

-- Child records inherit ownership through their lead or run. Both USING and
-- WITH CHECK are explicit so inserts and updates cannot cross tenant bounds.
drop policy if exists "own analysis through lead" on public.lead_analysis;
create policy "own analysis through lead" on public.lead_analysis for all
  using (exists (select 1 from public.leads l where l.id = lead_analysis.lead_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.leads l where l.id = lead_analysis.lead_id and l.user_id = auth.uid()));

drop policy if exists "own interactions through lead" on public.interactions;
create policy "own interactions through lead" on public.interactions for all
  using (exists (select 1 from public.leads l where l.id = interactions.lead_id and l.user_id = auth.uid()))
  with check (exists (select 1 from public.leads l where l.id = interactions.lead_id and l.user_id = auth.uid()));

drop policy if exists "own run steps" on public.jarvis_run_steps;
create policy "own run steps" on public.jarvis_run_steps for all
  using (exists (select 1 from public.jarvis_runs r where r.id = jarvis_run_steps.run_id and r.user_id = auth.uid()))
  with check (exists (select 1 from public.jarvis_runs r where r.id = jarvis_run_steps.run_id and r.user_id = auth.uid()));

drop policy if exists "own approvals through run" on public.approvals;
create policy "own approvals through run" on public.approvals for all
  using (exists (select 1 from public.jarvis_runs r where r.id = approvals.run_id and r.user_id = auth.uid()))
  with check (
    exists (select 1 from public.jarvis_runs r where r.id = approvals.run_id and r.user_id = auth.uid())
    and (resolved_by is null or resolved_by = auth.uid())
  );

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at before update on public.leads
for each row execute function public.set_updated_at();
drop trigger if exists approvals_set_updated_at on public.approvals;
create trigger approvals_set_updated_at before update on public.approvals
for each row execute function public.set_updated_at();
drop trigger if exists settings_set_updated_at on public.settings;
create trigger settings_set_updated_at before update on public.settings
for each row execute function public.set_updated_at();

-- Bootstrap a private profile/settings row for every newly confirmed account.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
