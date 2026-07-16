create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  code text unique not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  danmaku_enabled boolean not null default true,
  anonymous_enabled boolean not null default true,
  current_question_id uuid null,
  short_join_url text null,
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  device_id text not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (session_id, device_id)
);

create table if not exists public.presenter_session_keys (
  session_id uuid primary key references public.sessions(id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  content text not null,
  anonymous_at_display boolean not null default true,
  displayed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.screenshots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  storage_path text not null,
  public_url text not null,
  screen_summary jsonb null,
  ai_status text not null default 'skipped' check (ai_status in ('pending', 'success', 'failed', 'skipped')),
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  screenshot_id uuid null references public.screenshots(id) on delete set null,
  type text not null check (type in ('send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer')),
  status text not null default 'active' check (status in ('draft', 'active', 'stopped', 'closed')),
  title text not null default '',
  options jsonb not null default '[]'::jsonb,
  correct_answer text null,
  started_at timestamptz null default now(),
  stopped_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.sessions
  add constraint sessions_current_question_id_fkey
  foreign key (current_question_id) references public.questions(id)
  on delete set null;

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  answer_value text null,
  answer_text text null,
  is_correct boolean null,
  submitted_at timestamptz not null default now(),
  unique (question_id, participant_id)
);

create table if not exists public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid null references public.questions(id) on delete cascade,
  type text not null check (type in ('screen_preview', 'short_answer_summary', 'question_analysis', 'exit_ticket_summary')),
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb not null default '{}'::jsonb,
  status text not null check (status in ('success', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists public.exit_tickets (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  most_useful text not null default '',
  still_confused text not null default '',
  understanding_score int not null check (understanding_score between 1 and 5),
  engagement_score int not null check (engagement_score between 1 and 5),
  next_suggestion text not null default '',
  submitted_at timestamptz not null default now(),
  unique (session_id, participant_id)
);

alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.presenter_session_keys enable row level security;
alter table public.messages enable row level security;
alter table public.screenshots enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.ai_summaries enable row level security;
alter table public.exit_tickets enable row level security;

create policy "mvp read sessions" on public.sessions for select using (true);
create policy "mvp insert sessions" on public.sessions for insert with check (true);
create policy "mvp update sessions" on public.sessions for update using (true) with check (true);

create policy "mvp read participants" on public.participants for select using (true);
create policy "mvp insert participants" on public.participants for insert with check (true);
create policy "mvp update participants" on public.participants for update using (true) with check (true);

create policy "mvp read messages" on public.messages for select using (true);
create policy "mvp insert messages" on public.messages for insert with check (true);
create policy "mvp update messages" on public.messages for update using (true) with check (true);

create policy "mvp read screenshots" on public.screenshots for select using (true);
create policy "mvp insert screenshots" on public.screenshots for insert with check (true);
create policy "mvp update screenshots" on public.screenshots for update using (true) with check (true);

create policy "mvp read questions" on public.questions for select using (true);
create policy "mvp insert questions" on public.questions for insert with check (true);
create policy "mvp update questions" on public.questions for update using (true) with check (true);

create policy "mvp read answers" on public.answers for select using (true);
create policy "mvp insert answers" on public.answers for insert with check (true);
create policy "mvp update answers" on public.answers for update using (true) with check (true);

create policy "mvp read ai summaries" on public.ai_summaries for select using (true);
create policy "mvp insert ai summaries" on public.ai_summaries for insert with check (true);

create policy "mvp read exit tickets" on public.exit_tickets for select using (true);
create policy "mvp insert exit tickets" on public.exit_tickets for insert with check (true);

alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.screenshots;
alter publication supabase_realtime add table public.questions;
alter publication supabase_realtime add table public.answers;
alter publication supabase_realtime add table public.exit_tickets;

insert into storage.buckets (id, name, public)
values ('interact-screenshots', 'interact-screenshots', true)
on conflict (id) do update set public = excluded.public;

create policy "mvp read screenshot objects"
on storage.objects for select
using (bucket_id = 'interact-screenshots');

create policy "mvp insert screenshot objects"
on storage.objects for insert
with check (bucket_id = 'interact-screenshots');

create policy "mvp update screenshot objects"
on storage.objects for update
using (bucket_id = 'interact-screenshots')
with check (bucket_id = 'interact-screenshots');
