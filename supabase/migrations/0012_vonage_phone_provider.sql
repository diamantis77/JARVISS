alter table public.phone_calls drop constraint if exists phone_calls_provider_check;
alter table public.phone_calls add constraint phone_calls_provider_check check (provider in ('twilio', 'vonage'));
