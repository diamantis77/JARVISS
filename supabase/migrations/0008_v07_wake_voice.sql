-- Browser-safe wake mode preferences. No credentials or audio are stored here.
alter table public.settings
  add column if not exists wake_mode_enabled boolean not null default true,
  add column if not exists wake_phrase text not null default 'Hey Jarvis'
    check (wake_phrase = 'Hey Jarvis'),
  add column if not exists preferred_form_of_address text not null default 'κύριε'
    check (char_length(preferred_form_of_address) between 1 and 80),
  add column if not exists wake_sound_enabled boolean not null default true,
  add column if not exists voice_conversation_idle_timeout_ms integer not null default 120000
    check (voice_conversation_idle_timeout_ms between 30000 and 600000),
  add column if not exists voice_microphone_device_id text not null default '';

alter table public.settings alter column jarvis_voice set default 'cedar';
update public.settings set jarvis_voice = 'cedar' where jarvis_voice <> 'cedar';
