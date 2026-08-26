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
  recording_enabled boolean not null default false,
  captions_enabled boolean not null default false,
  caption_status text not null default 'idle' check (caption_status in ('idle', 'starting', 'live', 'error')),
  caption_source_language text not null default 'zh-tw',
  caption_display_language text not null default 'zh-tw',
  caption_font_size integer not null default 36 check (caption_font_size between 24 and 96),
  caption_font_bold boolean not null default false,
  caption_position text not null default 'bottom' check (caption_position in ('top', 'center', 'bottom')),
  caption_started_at timestamptz null,
  interpretation_enabled boolean not null default false,
  interpretation_audio_enabled boolean not null default false,
  interpretation_languages text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  ended_at timestamptz null,
  constraint sessions_captions_require_recording check (not captions_enabled or recording_enabled)
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

create table if not exists public.participant_session_keys (
  participant_id uuid primary key references public.participants(id) on delete cascade,
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
  type text not null check (type in ('send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response', 'custom_quiz')),
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

create table if not exists public.audio_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  storage_path text not null unique,
  mime_type text not null,
  duration_ms integer not null check (duration_ms between 250 and 180000),
  file_size integer not null check (file_size between 1 and 10485760),
  analysis_status text not null default 'pending' check (analysis_status in ('pending', 'success', 'failed')),
  detected_language text null,
  transcript text null,
  score integer null check (score between 0 and 100),
  analysis_json jsonb null,
  error_message text null,
  submitted_at timestamptz not null default now(),
  analyzed_at timestamptz null,
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

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null unique references public.questions(id) on delete cascade,
  title text not null,
  direction text not null,
  requested_count integer null check (requested_count between 1 and 10),
  requested_type text not null check (requested_type in ('random', 'multiple_choice', 'fill_blank', 'short_answer')),
  total_points integer not null default 100 check (total_points = 100),
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_items (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position integer not null check (position between 1 and 10),
  type text not null check (type in ('multiple_choice', 'fill_blank', 'short_answer')),
  prompt_text text not null check (char_length(prompt_text) between 1 and 2000),
  options jsonb not null default '[]'::jsonb,
  points integer not null check (points between 1 and 100),
  translations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (quiz_id, position)
);

create table if not exists public.quiz_item_keys (
  item_id uuid primary key references public.quiz_items(id) on delete cascade,
  accepted_answers text[] not null default '{}'::text[],
  rubric text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  status text not null default 'grading' check (status in ('grading', 'graded', 'failed')),
  total_score numeric(6,2) null check (total_score between 0 and 100),
  max_score integer not null default 100 check (max_score = 100),
  feedback jsonb null,
  error_message text null,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz null,
  unique (question_id, participant_id)
);

create table if not exists public.quiz_item_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  item_id uuid not null references public.quiz_items(id) on delete cascade,
  answer_text text null check (coalesce(char_length(answer_text), 0) <= 4000),
  answer_values text[] null,
  score numeric(6,2) null check (score >= 0),
  feedback jsonb null,
  created_at timestamptz not null default now(),
  unique (attempt_id, item_id)
);

create table if not exists public.caption_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  language text not null check (char_length(language) between 2 and 20),
  source_language text not null check (char_length(source_language) between 2 and 20),
  text text not null check (char_length(btrim(text)) between 1 and 4000),
  is_translation boolean not null default false,
  started_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists shared_contents_session_created_idx
  on public.shared_contents (session_id, created_at desc);
create index if not exists caption_segments_session_created_idx
  on public.caption_segments (session_id, created_at);

create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  event_type text not null check (event_type in ('lottery', 'lottery_result', 'buzzer')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists session_events_session_type_created_idx
  on public.session_events (session_id, event_type, created_at desc);

create index if not exists ai_summaries_question_id_idx on public.ai_summaries (question_id);
create index if not exists ai_summaries_session_id_idx on public.ai_summaries (session_id);
create index if not exists answers_participant_id_idx on public.answers (participant_id);
create index if not exists answers_session_id_idx on public.answers (session_id);
create index if not exists audio_responses_session_id_idx on public.audio_responses (session_id);
create index if not exists audio_responses_question_id_idx on public.audio_responses (question_id);
create index if not exists audio_responses_participant_id_idx on public.audio_responses (participant_id);
create index if not exists exit_tickets_participant_id_idx on public.exit_tickets (participant_id);
create index if not exists messages_participant_id_idx on public.messages (participant_id);
create index if not exists messages_session_id_idx on public.messages (session_id);
create index if not exists questions_screenshot_id_idx on public.questions (screenshot_id);
create index if not exists questions_session_id_idx on public.questions (session_id);
create index if not exists screenshots_session_id_idx on public.screenshots (session_id);
create index if not exists sessions_current_question_id_idx on public.sessions (current_question_id);
create index if not exists quizzes_session_id_idx on public.quizzes (session_id);
create index if not exists quiz_items_quiz_id_idx on public.quiz_items (quiz_id, position);
create index if not exists quiz_attempts_question_id_idx on public.quiz_attempts (question_id, submitted_at);
create index if not exists quiz_attempts_participant_id_idx on public.quiz_attempts (participant_id, submitted_at);
create index if not exists quiz_attempts_quiz_id_idx on public.quiz_attempts (quiz_id, submitted_at);
create index if not exists quiz_attempts_session_id_idx on public.quiz_attempts (session_id, submitted_at);
create index if not exists quiz_item_answers_attempt_id_idx on public.quiz_item_answers (attempt_id);
create index if not exists quiz_item_answers_item_id_idx on public.quiz_item_answers (item_id);

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
alter table public.participant_session_keys enable row level security;
alter table public.messages enable row level security;
alter table public.screenshots enable row level security;
alter table public.questions enable row level security;
alter table public.answers enable row level security;
alter table public.audio_responses enable row level security;
alter table public.ai_summaries enable row level security;
alter table public.exit_tickets enable row level security;
alter table public.shared_contents enable row level security;
alter table public.caption_segments enable row level security;
alter table public.session_events enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_items enable row level security;
alter table public.quiz_item_keys enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_item_answers enable row level security;

create policy "mvp read sessions" on public.sessions for select using (true);
revoke insert on public.sessions from anon, authenticated;

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
  and char_length(btrim(content)) between 1 and 180
);

create policy "mvp read screenshots" on public.screenshots for select using (true);

create policy "mvp read questions" on public.questions for select using (true);

create policy "read dispatched quizzes" on public.quizzes for select
to anon, authenticated
using (
  exists (
    select 1 from public.questions
    where questions.id = quizzes.question_id
      and questions.session_id = quizzes.session_id
  )
);

create policy "read dispatched quiz items" on public.quiz_items for select
to anon, authenticated
using (
  exists (
    select 1 from public.quizzes
    join public.questions on questions.id = quizzes.question_id
    where quizzes.id = quiz_items.quiz_id
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
      and questions.type <> 'custom_quiz'
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
create policy "public read caption segments" on public.caption_segments for select to anon, authenticated using (true);
create policy "public read session events" on public.session_events for select to anon, authenticated using (true);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.sessions, public.screenshots, public.questions, public.ai_summaries,
  public.shared_contents, public.session_events, public.caption_segments,
  public.quizzes, public.quiz_items to anon, authenticated;
grant select, insert on public.participants to anon, authenticated;
grant select, insert on public.messages, public.answers, public.exit_tickets to anon, authenticated;

revoke all on public.participant_session_keys, public.audio_responses, public.quiz_item_keys,
  public.quiz_attempts, public.quiz_item_answers from public, anon, authenticated;
grant all on public.participant_session_keys, public.audio_responses, public.quizzes, public.quiz_items,
  public.quiz_item_keys, public.quiz_attempts, public.quiz_item_answers to service_role;

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
alter publication supabase_realtime add table public.caption_segments;

insert into storage.buckets (id, name, public)
values ('interact-screenshots', 'interact-screenshots', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('interact-recordings', 'interact-recordings', false, 10485760, array['audio/wav']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
