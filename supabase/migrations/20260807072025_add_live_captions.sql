alter table public.sessions
  add column if not exists captions_enabled boolean not null default false,
  add column if not exists caption_status text not null default 'idle'
    check (caption_status in ('idle', 'starting', 'live', 'error')),
  add column if not exists caption_source_language text not null default 'zh-tw',
  add column if not exists caption_display_language text not null default 'zh-tw',
  add column if not exists interpretation_enabled boolean not null default false,
  add column if not exists interpretation_languages text[] not null default '{}'::text[];

create table if not exists public.caption_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  language text not null check (char_length(language) between 2 and 20),
  source_language text not null check (char_length(source_language) between 2 and 20),
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  is_translation boolean not null default false,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists caption_segments_session_created_idx
  on public.caption_segments (session_id, created_at);

alter table public.caption_segments enable row level security;
create policy "public read caption segments"
  on public.caption_segments for select to anon, authenticated using (true);

revoke all on public.caption_segments from public, anon, authenticated;
grant select on public.caption_segments to anon, authenticated;
grant all on public.caption_segments to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'caption_segments'
  ) then
    alter publication supabase_realtime add table public.caption_segments;
  end if;
end $$;
