create table if not exists public.shared_contents (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  body text null,
  url text null,
  created_at timestamptz not null default now(),
  constraint shared_contents_has_content check (
    nullif(btrim(coalesce(body, '')), '') is not null
    or nullif(btrim(coalesce(url, '')), '') is not null
  )
);

create index if not exists shared_contents_session_created_idx
  on public.shared_contents (session_id, created_at desc);

create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  event_type text not null check (event_type in ('lottery')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists session_events_session_type_created_idx
  on public.session_events (session_id, event_type, created_at desc);

alter table public.shared_contents enable row level security;
alter table public.session_events enable row level security;

create policy "public read shared contents"
  on public.shared_contents for select
  to anon, authenticated
  using (true);

create policy "public read session events"
  on public.session_events for select
  to anon, authenticated
  using (true);

grant select on public.shared_contents to anon, authenticated;
grant select on public.session_events to anon, authenticated;

alter publication supabase_realtime add table public.shared_contents;
alter publication supabase_realtime add table public.session_events;
