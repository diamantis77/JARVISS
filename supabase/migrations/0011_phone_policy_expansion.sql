-- Add the remaining conservative phone trigger preferences without modifying existing data.
alter table public.phone_notification_settings
  add column if not exists important_customer_reply boolean not null default false,
  add column if not exists high_value_deal boolean not null default false,
  add column if not exists custom_priority_event boolean not null default false;

alter table public.phone_calls
  add column if not exists live_session_duration_seconds integer
    check (live_session_duration_seconds is null or live_session_duration_seconds >= 0);
