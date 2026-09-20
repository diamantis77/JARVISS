-- JARVIS v0.4: additive voice session and finalized transcript persistence.
alter table public.settings
  add column if not exists jarvis_voice text not null default 'marin'
    check (jarvis_voice in ('marin','cedar','coral','alloy')),
  add column if not exists voice_mode text not null default 'conversation'
    check (voice_mode in ('conversation','push_to_talk'));

create table if not exists public.voice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider_session_id text,
  status text not null default 'connecting' check (status in ('connecting','active','ended','failed')),
  model text not null,
  voice text not null,
  metadata_json jsonb not null default '{}',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.voice_transcripts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  voice_session_id uuid not null references public.voice_sessions(id) on delete cascade,
  jarvis_run_id uuid references public.jarvis_runs(id) on delete set null,
  command_id text not null,
  role text not null check (role in ('user','assistant')),
  transcript_text text not null check (char_length(transcript_text) between 1 and 12000),
  created_at timestamptz not null default now(),
  unique (user_id, voice_session_id, command_id, role)
);

create index if not exists voice_sessions_user_started_idx on public.voice_sessions(user_id, started_at desc);
create index if not exists voice_transcripts_session_created_idx on public.voice_transcripts(voice_session_id, created_at);

alter table public.voice_sessions enable row level security;
alter table public.voice_transcripts enable row level security;

create policy "own voice sessions" on public.voice_sessions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own voice transcripts" on public.voice_transcripts for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.voice_sessions s where s.id = voice_transcripts.voice_session_id and s.user_id = auth.uid())
    and (jarvis_run_id is null or exists (select 1 from public.jarvis_runs r where r.id = voice_transcripts.jarvis_run_id and r.user_id = auth.uid()))
  );
