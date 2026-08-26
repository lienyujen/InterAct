alter table public.sessions
  add column if not exists recording_enabled boolean not null default false;

update public.sessions
set recording_enabled = true
where captions_enabled = true;

alter table public.sessions
  drop constraint if exists sessions_captions_require_recording;

alter table public.sessions
  add constraint sessions_captions_require_recording
  check (not captions_enabled or recording_enabled);
