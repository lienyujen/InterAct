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
  exit_ticket_prompt text null,
  exit_ticket_category text null check (exit_ticket_category in ('lesson_summary', 'learning_assessment', 'course_satisfaction', 'student_question')),
  exit_ticket_response_type text null check (exit_ticket_response_type in ('text', 'rating')),
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
  prompt_text text null,
  options jsonb not null default '[]'::jsonb,
  allow_multiple boolean not null default false,
  correct_answer text null,
  correct_answers text[] not null default '{}'::text[],
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
  answer_values text[] null,
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
  understanding_score int null check (understanding_score between 1 and 5),
  engagement_score int null check (engagement_score between 1 and 5),
  next_suggestion text not null default '',
  response_text text null,
  rating int null check (rating between 1 and 5),
  submitted_at timestamptz not null default now(),
  unique (session_id, participant_id)
);

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
  event_type text not null check (event_type in ('lottery', 'lottery_result', 'buzzer')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists session_events_session_type_created_idx
  on public.session_events (session_id, event_type, created_at desc);

create or replace function public.claim_buzzer(
  p_event_id uuid,
  p_session_id uuid,
  p_participant_id uuid
)
returns setof public.session_events
language sql
security invoker
set search_path = ''
as $$
  with winner as (
    select participant.id, participant.name
    from public.participants as participant
    where participant.id = p_participant_id
      and participant.session_id = p_session_id
  ),
  claimed as (
    update public.session_events as event
    set payload = event.payload || jsonb_build_object(
      'winner_id', winner.id,
      'winner_name', winner.name,
      'accepting', false,
      'finalized', true,
      'finalized_at', now(),
      'duration_ms', 6000
    )
    from winner
    where event.id = p_event_id
      and event.session_id = p_session_id
      and event.event_type = 'buzzer'
      and coalesce((event.payload ->> 'accepting')::boolean, false) = true
      and coalesce((event.payload ->> 'finalized')::boolean, false) = false
      and coalesce((event.payload ->> 'cancelled')::boolean, false) = false
      and (event.payload ->> 'expires_at')::timestamptz > now()
      and coalesce(event.payload -> 'candidate_ids', '[]'::jsonb) ? p_participant_id::text
    returning event.*
  )
  select * from claimed
  union all
  select event.*
  from public.session_events as event
  where event.id = p_event_id
    and event.session_id = p_session_id
    and event.event_type = 'buzzer'
    and not exists (select 1 from claimed)
  limit 1;
$$;

revoke all on function public.claim_buzzer(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_buzzer(uuid, uuid, uuid) to service_role;

alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.presenter_session_keys enable row level security;
alter table public.messages enable row level security;
alter table public.screenshots enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.ai_summaries enable row level security;
alter table public.exit_tickets enable row level security;
alter table public.shared_contents enable row level security;
alter table public.session_events enable row level security;

create policy "mvp read sessions" on public.sessions for select using (true);
revoke insert on public.sessions from anon, authenticated;
create policy "update active sessions only" on public.sessions for update
to anon, authenticated
using (status = 'active')
with check (status = 'active' and ended_at is null);

create policy "mvp read participants" on public.participants for select using (true);
create policy "join active sessions" on public.participants for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = participants.session_id and sessions.status = 'active'
  )
  and char_length(btrim(name)) between 1 and 80
  and char_length(device_id) between 1 and 200
);
create policy "update participants in active sessions" on public.participants for update
to anon, authenticated
using (
  exists (
    select 1 from public.sessions
    where sessions.id = participants.session_id and sessions.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = participants.session_id and sessions.status = 'active'
  )
  and char_length(btrim(name)) between 1 and 80
  and char_length(device_id) between 1 and 200
);

create policy "mvp read messages" on public.messages for select using (true);
create policy "send messages to active sessions" on public.messages for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = messages.session_id and sessions.status = 'active'
  )
  and exists (
    select 1 from public.participants
    where participants.id = messages.participant_id
      and participants.session_id = messages.session_id
      and participants.name = messages.participant_name
  )
  and char_length(btrim(content)) between 1 and 36
);

create policy "mvp read screenshots" on public.screenshots for select using (true);
create policy "add screenshots to active sessions" on public.screenshots for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = screenshots.session_id and sessions.status = 'active'
  )
);
create policy "update screenshots in active sessions" on public.screenshots for update
to anon, authenticated
using (
  exists (
    select 1 from public.sessions
    where sessions.id = screenshots.session_id and sessions.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = screenshots.session_id and sessions.status = 'active'
  )
);

create policy "mvp read questions" on public.questions for select using (true);
create policy "add questions to active sessions" on public.questions for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = questions.session_id and sessions.status = 'active'
  )
);
create policy "update questions in active sessions" on public.questions for update
to anon, authenticated
using (
  exists (
    select 1 from public.sessions
    where sessions.id = questions.session_id and sessions.status = 'active'
  )
)
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = questions.session_id and sessions.status = 'active'
  )
);

create policy "mvp read answers" on public.answers for select using (true);
create policy "answer active questions" on public.answers for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = answers.session_id and sessions.status = 'active'
  )
  and exists (
    select 1 from public.questions
    where questions.id = answers.question_id
      and questions.session_id = answers.session_id
      and questions.status = 'active'
  )
  and exists (
    select 1 from public.participants
    where participants.id = answers.participant_id
      and participants.session_id = answers.session_id
      and participants.name = answers.participant_name
  )
  and is_correct is null
  and coalesce(char_length(answer_value), 0) <= 500
  and coalesce(char_length(answer_text), 0) <= 1000
  and coalesce(array_length(answer_values, 1), 0) <= 20
  and not exists (
    select 1
    from unnest(coalesce(answer_values, '{}'::text[])) as submitted_value
    where char_length(submitted_value) > 500
  )
);
create policy "grade answers before class ends" on public.answers for update
to anon, authenticated
using (
  exists (
    select 1 from public.sessions
    where sessions.id = answers.session_id and sessions.status = 'active'
  )
  and exists (
    select 1 from public.questions
    where questions.id = answers.question_id
      and questions.session_id = answers.session_id
      and questions.status in ('stopped', 'closed')
  )
)
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = answers.session_id and sessions.status = 'active'
  )
  and exists (
    select 1 from public.questions
    where questions.id = answers.question_id
      and questions.session_id = answers.session_id
      and questions.status in ('stopped', 'closed')
  )
);

create policy "mvp read ai summaries" on public.ai_summaries for select using (true);
revoke insert on public.ai_summaries from anon, authenticated;

create policy "mvp read exit tickets" on public.exit_tickets for select using (true);
create policy "submit exit tickets to active sessions" on public.exit_tickets for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = exit_tickets.session_id
      and sessions.status = 'active'
      and sessions.exit_ticket_prompt is not null
  )
  and exists (
    select 1 from public.participants
    where participants.id = exit_tickets.participant_id
      and participants.session_id = exit_tickets.session_id
      and participants.name = exit_tickets.participant_name
  )
  and coalesce(char_length(response_text), 0) <= 2000
);

create policy "public read shared contents" on public.shared_contents for select to anon, authenticated using (true);
create policy "public read session events" on public.session_events for select to anon, authenticated using (true);

grant select on public.shared_contents to anon, authenticated;
grant select on public.session_events to anon, authenticated;

alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.participants;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.screenshots;
alter publication supabase_realtime add table public.questions;
alter publication supabase_realtime add table public.answers;
alter publication supabase_realtime add table public.ai_summaries;
alter publication supabase_realtime add table public.exit_tickets;
alter publication supabase_realtime add table public.shared_contents;
alter publication supabase_realtime add table public.session_events;

insert into storage.buckets (id, name, public)
values ('interact-screenshots', 'interact-screenshots', true)
on conflict (id) do update set public = excluded.public;

create policy "upload screenshots to active sessions"
on storage.objects for insert
to anon, authenticated
with check (
  bucket_id = 'interact-screenshots'
  and (storage.foldername(name))[1] = 'sessions'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.sessions
    where sessions.id = ((storage.foldername(name))[2])::uuid
      and sessions.status = 'active'
  )
);

create policy "replace screenshots in active sessions"
on storage.objects for update
to anon, authenticated
using (
  bucket_id = 'interact-screenshots'
  and (storage.foldername(name))[1] = 'sessions'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.sessions
    where sessions.id = ((storage.foldername(name))[2])::uuid
      and sessions.status = 'active'
  )
)
with check (
  bucket_id = 'interact-screenshots'
  and (storage.foldername(name))[1] = 'sessions'
  and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and exists (
    select 1 from public.sessions
    where sessions.id = ((storage.foldername(name))[2])::uuid
      and sessions.status = 'active'
  )
);
