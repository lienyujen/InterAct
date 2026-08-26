alter table public.sessions
  add column if not exists caption_started_at timestamptz;
