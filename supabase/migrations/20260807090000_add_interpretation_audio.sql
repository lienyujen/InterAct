alter table public.sessions
  add column if not exists interpretation_audio_enabled boolean not null default false;
