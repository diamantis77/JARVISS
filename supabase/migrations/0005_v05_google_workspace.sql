-- JARVIS v0.5: Google Workspace connections, synchronization and notifications.
alter table public.settings add column if not exists timezone text not null default 'Europe/Athens';
create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google')),
  provider_account_id text not null,
  provider_email text not null,
  status text not null check (status in ('connected','needs_reconnect','disconnected','error')),
  scopes text[] not null default '{}',
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

create table if not exists public.provider_sync_state (
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  capability text not null check (capability in ('gmail','calendar')),
  checkpoint text,
  watch_expiration timestamptz,
  last_successful_sync_at timestamptz,
  last_notification_id text,
  updated_at timestamptz not null default now(),
  primary key(connection_id, capability)
);

create table if not exists public.email_thread_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  provider_thread_id text not null,
  provider_message_id text,
  lead_id uuid references public.leads(id) on delete set null,
  sender_email text,
  subject text,
  summary text,
  classification text,
  classification_confidence text check (classification_confidence is null or classification_confidence in ('low','medium','high')),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, connection_id, provider_thread_id)
);

create table if not exists public.provider_watch_channels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  capability text not null check (capability in ('gmail','calendar')),
  channel_id text,
  resource_id text,
  calendar_id text,
  verification_token_hash text,
  expiration timestamptz,
  status text not null default 'active' check (status in ('active','expired','stopped','error')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, capability, channel_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  priority text not null check (priority in ('info','important','urgent')),
  title text not null,
  body text not null,
  entity_type text,
  entity_id text,
  read_at timestamptz,
  dismissed_at timestamptz,
  metadata jsonb not null default '{}',
  dedupe_key text,
  created_at timestamptz not null default now(),
  unique(user_id, dedupe_key)
);

alter table public.interactions
  add column if not exists provider text,
  add column if not exists provider_thread_id text,
  add column if not exists provider_message_id text,
  add column if not exists recipient_email text,
  add column if not exists metadata_json jsonb not null default '{}';

create index if not exists provider_connections_user_status_idx on public.provider_connections(user_id, status);
create index if not exists email_thread_links_user_message_idx on public.email_thread_links(user_id, last_message_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, read_at, created_at desc) where dismissed_at is null;
create index if not exists provider_watch_expiration_idx on public.provider_watch_channels(status, expiration);

alter table public.provider_connections enable row level security;
alter table public.provider_sync_state enable row level security;
alter table public.email_thread_links enable row level security;
alter table public.provider_watch_channels enable row level security;
alter table public.notifications enable row level security;

create policy "own provider connections" on public.provider_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own provider sync state" on public.provider_sync_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.provider_connections c where c.id = connection_id and c.user_id = auth.uid()));
create policy "own email links" on public.email_thread_links for all using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.provider_connections c where c.id = connection_id and c.user_id = auth.uid()) and (lead_id is null or exists (select 1 from public.leads l where l.id = lead_id and l.user_id = auth.uid())));
create policy "own watch channels" on public.provider_watch_channels for all using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.provider_connections c where c.id = connection_id and c.user_id = auth.uid()));
create policy "own notifications" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists provider_connections_set_updated_at on public.provider_connections;
create trigger provider_connections_set_updated_at before update on public.provider_connections for each row execute function public.set_updated_at();
drop trigger if exists provider_sync_state_set_updated_at on public.provider_sync_state;
create trigger provider_sync_state_set_updated_at before update on public.provider_sync_state for each row execute function public.set_updated_at();
drop trigger if exists email_thread_links_set_updated_at on public.email_thread_links;
create trigger email_thread_links_set_updated_at before update on public.email_thread_links for each row execute function public.set_updated_at();
drop trigger if exists provider_watch_channels_set_updated_at on public.provider_watch_channels;
create trigger provider_watch_channels_set_updated_at before update on public.provider_watch_channels for each row execute function public.set_updated_at();
