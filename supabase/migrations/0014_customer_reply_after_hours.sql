-- Owner-controlled, reply-specific exception. Existing calling hours and urgent policy are unchanged.
alter table public.phone_notification_settings
  add column if not exists customer_reply_outside_hours boolean not null default false;
