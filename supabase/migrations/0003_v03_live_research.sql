-- JARVIS v0.3: additive live-research persistence and evidence provenance.
alter type public.run_status add value if not exists 'cancelled';

alter table public.leads
  add column if not exists score_components jsonb not null default '[]',
  add column if not exists evidence_ids uuid[] not null default '{}',
  add column if not exists research_confidence text not null default 'unknown'
    check (research_confidence in ('verified','high','medium','low','unknown')),
  add column if not exists last_researched_at timestamptz;

alter table public.settings
  add column if not exists research_max_leads integer not null default 20 check (research_max_leads between 1 and 50),
  add column if not exists research_max_pages_per_site integer not null default 5 check (research_max_pages_per_site between 1 and 5),
  add column if not exists research_fetch_timeout_ms integer not null default 8000 check (research_fetch_timeout_ms between 2000 and 20000),
  add column if not exists research_max_concurrency integer not null default 2 check (research_max_concurrency between 1 and 5),
  add column if not exists research_ai_analysis_enabled boolean not null default true;

create table if not exists public.research_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  jarvis_run_id uuid references public.jarvis_runs(id) on delete set null,
  query text not null,
  industry text not null,
  location text not null,
  requested_limit integer not null check (requested_limit between 1 and 50),
  status text not null default 'pending' check (status in ('pending','running','partial','completed','cancelled','failed')),
  discovered_count integer not null default 0,
  verified_count integer not null default 0,
  analyzed_count integer not null default 0,
  qualified_count integer not null default 0,
  failed_count integer not null default 0,
  processed_count integer not null default 0,
  config_json jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.research_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  research_run_id uuid not null references public.research_runs(id) on delete cascade,
  business_name text not null,
  normalized_key text not null,
  industry text not null,
  location text not null,
  official_website text,
  phone text,
  email text,
  status text not null default 'discovered' check (status in ('discovered','verified','analyzed','qualified','failed','skipped')),
  source_results jsonb not null default '[]',
  lead_id uuid references public.leads(id) on delete set null,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (research_run_id, normalized_key)
);

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  research_run_id uuid references public.research_runs(id) on delete set null,
  candidate_id uuid references public.research_candidates(id) on delete set null,
  lead_id uuid references public.leads(id) on delete cascade,
  source_type text not null check (source_type in ('official_website','official_profile','directory','search_result','website_page')),
  source_url text not null,
  title text not null default '',
  retrieved_at timestamptz not null default now(),
  provider text not null,
  metadata_json jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.lead_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  field_name text not null,
  value_text text not null,
  confidence text not null check (confidence in ('verified','high','medium','low','unknown')),
  source_id uuid not null references public.research_sources(id) on delete cascade,
  evidence_summary text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.website_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  candidate_id uuid references public.research_candidates(id) on delete set null,
  website_url text not null,
  status text not null check (status in ('completed','partial','failed')),
  title text,
  meta_description text,
  language text,
  has_viewport_meta boolean,
  has_contact_form boolean,
  has_booking boolean,
  has_clear_cta boolean,
  has_phone boolean,
  has_email boolean,
  has_https boolean not null,
  phone text,
  email text,
  pages_analyzed jsonb not null default '[]',
  analysis_json jsonb not null default '{}',
  confidence text not null check (confidence in ('verified','high','medium','low','unknown')),
  retrieved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists research_runs_user_status_idx on public.research_runs(user_id, status, created_at desc);
create index if not exists research_candidates_run_status_idx on public.research_candidates(research_run_id, status, created_at);
create index if not exists research_sources_lead_idx on public.research_sources(user_id, lead_id, created_at desc);
create index if not exists lead_evidence_lead_idx on public.lead_evidence(user_id, lead_id, created_at desc);
create index if not exists website_analyses_lead_idx on public.website_analyses(user_id, lead_id, created_at desc);

alter table public.research_runs enable row level security;
alter table public.research_candidates enable row level security;
alter table public.research_sources enable row level security;
alter table public.lead_evidence enable row level security;
alter table public.website_analyses enable row level security;

create policy "own research runs" on public.research_runs for all
  using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and (jarvis_run_id is null or exists (select 1 from public.jarvis_runs j where j.id = research_runs.jarvis_run_id and j.user_id = auth.uid()))
  );
create policy "own research candidates" on public.research_candidates for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.research_runs r where r.id = research_candidates.research_run_id and r.user_id = auth.uid()
  ) and (lead_id is null or exists (select 1 from public.leads l where l.id = research_candidates.lead_id and l.user_id = auth.uid())));
create policy "own research sources" on public.research_sources for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (lead_id is null or exists (select 1 from public.leads l where l.id = research_sources.lead_id and l.user_id = auth.uid()))
    and (research_run_id is null or exists (select 1 from public.research_runs r where r.id = research_sources.research_run_id and r.user_id = auth.uid()))
    and (candidate_id is null or exists (select 1 from public.research_candidates c where c.id = research_sources.candidate_id and c.user_id = auth.uid()))
  );
create policy "own lead evidence" on public.lead_evidence for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.leads l where l.id = lead_evidence.lead_id and l.user_id = auth.uid())
    and exists (select 1 from public.research_sources s where s.id = lead_evidence.source_id and s.user_id = auth.uid())
  );
create policy "own website analyses" on public.website_analyses for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (lead_id is null or exists (select 1 from public.leads l where l.id = website_analyses.lead_id and l.user_id = auth.uid()))
    and (candidate_id is null or exists (select 1 from public.research_candidates c where c.id = website_analyses.candidate_id and c.user_id = auth.uid()))
  );

create trigger research_runs_set_updated_at before update on public.research_runs
for each row execute function public.set_updated_at();
create trigger research_candidates_set_updated_at before update on public.research_candidates
for each row execute function public.set_updated_at();
