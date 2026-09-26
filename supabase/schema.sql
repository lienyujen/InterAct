create extension if not exists pgcrypto;

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  code text unique not null,
  status text not null default 'active' check (status in ('active', 'ended')),
  danmaku_enabled boolean not null default true,
  anonymous_enabled boolean not null default true,
  current_question_id uuid null,
  -- The 討論板 that is open, which is not the same thing as the question the
  -- class is on. A board is a place rather than a moment: the presenter opens
  -- one for a topic, carries on teaching and dispatching other questions, and
  -- the class can go back to the board and add to it the whole time. Kept
  -- beside current_question_id rather than in it, because the student page
  -- shows exactly one current question and a board would have to fight it.
  board_question_id uuid null,
  short_join_url text null,
  exit_ticket_prompt text null,
  exit_ticket_prompt_en text null,
  exit_ticket_category text null check (exit_ticket_category in ('lesson_summary', 'learning_assessment', 'course_satisfaction', 'student_question')),
  exit_ticket_response_type text null check (exit_ticket_response_type in ('text', 'rating')),
  recording_enabled boolean not null default false,
  captions_enabled boolean not null default false,
  caption_status text not null default 'idle' check (caption_status in ('idle', 'starting', 'live', 'error')),
  caption_source_language text not null default 'zh-tw',
  caption_display_language text not null default 'zh-tw',
  caption_font_size integer not null default 32 check (caption_font_size between 24 and 96),
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
  unfocused_ms bigint not null default 0,
  focus_streak_ms bigint not null default 0,
  -- Set when the presenter removes someone from the class list. The row stays,
  -- because every answer, message and recording they made hangs off it by a
  -- cascading key — deleting it would take the lesson's evidence with it. The
  -- device_id is rewritten at the same time so the unique constraint below no
  -- longer blocks that device from joining again under a corrected name.
  removed_at timestamptz null,
  -- Set when the student asks to be called on, cleared when the presenter
  -- acknowledges it. A timestamp rather than a flag so the class list can put
  -- the longest-waiting hand first.
  hand_raised_at timestamptz null,
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
  type text not null check (type in ('send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'drawing', 'hotspot', 'ordering', 'matching', 'board')),
  status text not null default 'active' check (status in ('draft', 'active', 'stopped', 'closed')),
  title text not null default '',
  prompt_text text null,
  options jsonb not null default '[]'::jsonb,
  allow_multiple boolean not null default false,
  correct_answer text null,
  correct_answers text[] not null default '{}'::text[],
  started_at timestamptz null default now(),
  -- Null means untimed. Two clocks rather than one because the pause before
  -- speaking IS the exercise in a spoken challenge, while a written question
  -- has nothing to prepare; one combined field would lie about one of them.
  prepare_seconds integer null check (prepare_seconds is null or prepare_seconds between 5 and 300),
  answer_seconds integer null check (answer_seconds is null or answer_seconds between 5 and 600),
  -- How many points one student may drop on a hotspot image. Null everywhere else.
  max_pins integer null check (max_pins is null or max_pins between 1 and 10),
  -- The selectable side of a matching question. `options` holds the prompts,
  -- this holds what they are matched against, shuffled. Both are visible; only
  -- the pairing between them is secret, and that lives in question_keys.
  choices text[] not null default '{}'::text[],
  -- 排序題 only: the pieces are one sentence cut up, not a list of things to
  -- rank. Length cannot tell the two apart — four short opinions look exactly
  -- like four words — so the presenter says which it is when they dispatch.
  sentence_mode boolean not null default false,
  -- Whether the class sees the capture the question was made from. True for the
  -- types that are *about* the picture; 排序題 and 配對題 ask for it explicitly,
  -- because for a sliced ordering the uncut original is the answer key.
  share_screenshot boolean not null default true,
  -- Bumped by 再做一次 so the class can answer the same question twice and the
  -- two rounds can be compared. Answers carry the round they were given in.
  answer_round integer not null default 1,
  stopped_at timestamptz null,
  translations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Added ahead of the policies below, which read answer_seconds: on a database
-- created before timing existed the policy would otherwise be built against a
-- column that is not there yet.
alter table public.questions
  add column if not exists prepare_seconds integer null,
  add column if not exists answer_seconds integer null,
  add column if not exists max_pins integer null,
  add column if not exists choices text[] not null default '{}'::text[],
  add column if not exists sentence_mode boolean not null default false,
  add column if not exists share_screenshot boolean not null default true,
  -- 討論板 only. Which kinds of card the class may put on the board: any of
  -- 'text', 'link', 'image', 'file', 'audio'. Empty means the screen was
  -- dispatched with nothing to answer, which is the plain 派送畫面 it has
  -- always been — the board is the same dispatch with replies switched on.
  add column if not exists board_formats text[] not null default '{}'::text[],
  -- How many cards one student may put up. Null is the infinity option, and is
  -- the reason this is nullable rather than a large number: the presenter picks
  -- 1, 2, 3, 5 or ∞, and ∞ has to mean it.
  add column if not exists board_max_posts integer null,
  -- When the class could see each other's cards. Normally set the moment the
  -- board is dispatched, because a wall everyone can see is what a wall is for.
  -- Null means the presenter asked for 自行作答: each student sees only their
  -- own until the board is opened. Reversible in both directions — a presenter
  -- may want the class to think alone first and then look, or to share from the
  -- start and then close it again to settle everyone down.
  add column if not exists board_revealed_at timestamptz null,
  add column if not exists answer_round integer not null default 1;

alter table public.questions drop constraint if exists questions_board_max_posts_check;
alter table public.questions
  add constraint questions_board_max_posts_check
  check (board_max_posts is null or board_max_posts between 1 and 50);

-- The base table above only runs on a fresh database, so an existing one keeps
-- whatever list of types it was created with. Replacing the constraint outright
-- is how a new question type actually reaches a project already in use.
alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions
  add constraint questions_type_check check (type in (
    'send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer',
    'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'drawing',
    'hotspot', 'ordering', 'matching', 'board'
  ));

do $mig$ begin
  alter table public.questions
    add constraint questions_prepare_seconds_check
    check (prepare_seconds is null or prepare_seconds between 5 and 300);
exception when duplicate_object then null; end $mig$;

do $mig$ begin
  alter table public.questions
    add constraint questions_answer_seconds_check
    check (answer_seconds is null or answer_seconds between 5 and 600);
exception when duplicate_object then null; end $mig$;

alter table public.sessions
  drop constraint if exists sessions_current_question_id_fkey;

alter table public.sessions
  add constraint sessions_current_question_id_fkey
  foreign key (current_question_id) references public.questions(id)
  on delete set null;

alter table public.sessions
  add column if not exists board_question_id uuid null;

alter table public.sessions
  drop constraint if exists sessions_board_question_id_fkey;

alter table public.sessions
  add constraint sessions_board_question_id_fkey
  foreign key (board_question_id) references public.questions(id)
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
  round integer not null default 1,
  unique (question_id, participant_id, round)
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

create table if not exists public.shared_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 209715200),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists shared_files_session_idx on public.shared_files (session_id, created_at);

create table if not exists public.file_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  name text not null,
  mime_type text not null,
  file_size bigint not null check (file_size between 1 and 209715200),
  storage_path text not null unique,
  analysis_status text not null default 'pending'
    check (analysis_status in ('pending', 'analyzing', 'success', 'failed', 'unsupported')),
  analysis_json jsonb null,
  error_message text null,
  submitted_at timestamptz not null default now(),
  analyzed_at timestamptz null
);
-- Points a presenter hands out by tapping + beside a name. Separate from the
-- participation score, which is arithmetic over what the class actually did and
-- has to stay reproducible; this is the teacher's own judgement and belongs in
-- its own column. Stored per award rather than as a total so a mistaken tap can
-- be traced, and so the report can show what the points were for.
create table if not exists public.participant_points (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  points integer not null default 1 check (points between 1 and 10),
  created_at timestamptz not null default now()
);

create index if not exists participant_points_session_idx on public.participant_points (session_id, participant_id);

-- Cards on a 討論板. One row is one thing a student put on the wall: a note, a
-- link, a photograph, a file or a recording.
--
-- Deliberately not folded into file_responses or audio_responses, which already
-- hold student uploads. Those two are homework: one submission per student per
-- question (audio_responses enforces it with a unique key), private to the
-- presenter, and carrying an AI marking pipeline. A wall is the opposite on
-- every count — several cards per student, read by the whole class, and nothing
-- to mark. Reusing them would have meant weakening the parts that make them
-- right for what they already do.
create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  kind text not null check (kind in ('text', 'link', 'image', 'file', 'audio', 'drawing')),
  -- The words on the card: the note itself, or the caption under a photograph.
  body text null,
  url text null,
  storage_path text null,
  mime_type text null,
  file_size bigint null check (file_size is null or file_size between 1 and 209715200),
  duration_ms integer null check (duration_ms is null or duration_ms between 250 and 300000),
  -- A reply to another card. Replies do not count against the per-student
  -- limit: that limit is how many contributions to the topic one student may
  -- make, and a class where answering someone costs you your own card is not a
  -- discussion. Replies are only possible after the board is revealed, because
  -- before that there is nothing to reply to.
  reply_to uuid null references public.board_posts(id) on delete cascade,
  -- Whether the class saw a name on this card, decided when it was written.
  -- Kept per row rather than read from the session, so turning anonymity off
  -- later cannot retroactively put names on cards written under it.
  anonymous_at_display boolean not null default true,
  -- The student took their own card back down. Kept rather than deleted so the
  -- report still shows it was written, and so the per-student count cannot be
  -- reset by deleting and reposting.
  deleted_at timestamptz null,
  -- The student corrected their own card. Recorded so the wall can say a card
  -- was changed after the class read it, rather than quietly showing different
  -- words to whoever looks next.
  edited_at timestamptz null,
  -- The presenter took it down for everyone.
  hidden_at timestamptz null,
  -- The presenter pushed it to the front of the wall.
  pinned_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table public.board_posts drop constraint if exists board_posts_kind_check;
alter table public.board_posts
  add constraint board_posts_kind_check
  check (kind in ('text', 'link', 'image', 'file', 'audio', 'drawing'));

create index if not exists board_posts_question_idx on public.board_posts (question_id, created_at);
create index if not exists board_posts_participant_idx on public.board_posts (question_id, participant_id);
create index if not exists board_posts_reply_idx on public.board_posts (reply_to);

-- Who liked what. One row per student per card per emoji, so the primary key
-- does the de-duplication and a second tap is an ordinary delete.
create table if not exists public.board_reactions (
  post_id uuid not null references public.board_posts(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (post_id, participant_id, emoji)
);

create index if not exists board_reactions_session_idx on public.board_reactions (session_id);

create table if not exists public.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- The correct sequence, or the correct right-hand item for each left-hand
  -- one, in the order the left-hand items are stored on the question.
  correct_values text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create index if not exists file_responses_question_idx on public.file_responses (question_id, submitted_at);

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
alter table public.shared_files enable row level security;
alter table public.board_posts enable row level security;
alter table public.board_reactions enable row level security;
alter table public.participant_points enable row level security;
alter table public.question_keys enable row level security;
alter table public.file_responses enable row level security;

drop policy if exists "mvp read sessions" on public.sessions;
create policy "mvp read sessions" on public.sessions for select using (true);
revoke insert on public.sessions from anon, authenticated;

drop policy if exists "mvp read participants" on public.participants;
create policy "mvp read participants" on public.participants for select using (true);
drop policy if exists "join active sessions" on public.participants;
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
-- Read like the rest of a session's data, which the roster window and the report
-- both load directly. The matching grant is in the block near the end of this
-- file, which revokes everything from anon first — a policy on its own grants
-- nothing, and a table left out of that block is readable by nobody.
drop policy if exists "mvp read participant points" on public.participant_points;
create policy "mvp read participant points" on public.participant_points for select using (true);

drop policy if exists "mvp read messages" on public.messages;
create policy "mvp read messages" on public.messages for select using (true);
drop policy if exists "send messages to active sessions" on public.messages;
create policy "send messages to active sessions" on public.messages for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.sessions
    where sessions.id = messages.session_id and sessions.status = 'active'
      -- Switched off means switched off. A page left open on a phone, or one
      -- that missed the change, would otherwise keep writing into a table
      -- nobody is watching.
      and sessions.danmaku_enabled
  )
  and exists (
    select 1 from public.participants
    where participants.id = messages.participant_id
      and participants.session_id = messages.session_id
      and participants.name = messages.participant_name
  )
  and char_length(btrim(content)) between 1 and 180
);

-- A board card is readable by the class only once the presenter has revealed
-- the board. Enforced here rather than in the page, because 先遮後揭 stops
-- being worth anything the moment it is only a decision the client makes: a
-- student who reloads, or who looks at the network tab, would have the whole
-- wall. Before the reveal a student's own cards come back through
-- participant-action, which can prove who is asking; the presenter reads
-- everything through presenter-action on the service role, so the wall is
-- never hidden from the person running the class.
drop policy if exists "read a revealed board" on public.board_posts;
create policy "read a revealed board" on public.board_posts for select
to anon, authenticated
using (
  exists (
    select 1 from public.questions
    where questions.id = board_posts.question_id
      and questions.board_revealed_at is not null
  )
);

-- Both of these exist because a policy on board_posts cannot ask questions
-- about board_posts: the inner select is itself subject to the policy being
-- evaluated, and Postgres stops with "infinite recursion detected". A security
-- definer function runs as the owner and so is not re-checked. Neither returns
-- any content — one returns a count, the other a yes or no about whether a
-- card exists — so running them with the owner's rights gives nothing away.
create or replace function public.board_card_count(target_question uuid, target_participant uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $board$
  select count(*)::int from public.board_posts
  where question_id = target_question
    and participant_id = target_participant
    and reply_to is null
    -- Deleting gives the card back. The first version counted deleted cards so
    -- that nobody could delete their way past the limit, which turned out to
    -- punish the ordinary case: a student who posts, thinks better of it and
    -- wants to say it properly. The limit is there to stop one person filling
    -- the wall, and a card that is not on the wall is not filling it.
    and deleted_at is null
$board$;

create or replace function public.board_parent_exists(target_question uuid, target_parent uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $board$
  select exists (
    select 1 from public.board_posts
    where id = target_parent
      and question_id = target_question
      and reply_to is null
  )
$board$;

grant execute on function public.board_card_count(uuid, uuid) to anon, authenticated;
grant execute on function public.board_parent_exists(uuid, uuid) to anon, authenticated;

drop policy if exists "post to an open board" on public.board_posts;
create policy "post to an open board" on public.board_posts for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.questions q
    join public.sessions s on s.id = q.session_id
    where q.id = board_posts.question_id
      and q.session_id = board_posts.session_id
      and q.type = 'board'
      and q.status = 'active'
      and s.status = 'active'
      -- Only the kinds of card this board was opened for — and only for cards.
      -- The format list says how a student may ANSWER the topic; answering a
      -- classmate is a different act and is always words. Applying it to both
      -- meant that on a board opened for 電繪 alone, every reply was refused:
      -- a reply is text, text was not on the list, and the class was told
      -- 貼文失敗 with nothing to do about it.
      and (
        board_posts.reply_to is not null
        or board_posts.kind = any (q.board_formats)
      )
      -- A reply is text, on a card on this same board, and only once the board
      -- has been revealed — there is nothing to answer before that.
      and (
        board_posts.reply_to is null
        or (
          board_posts.kind = 'text'
          and q.board_revealed_at is not null
          and public.board_parent_exists(board_posts.question_id, board_posts.reply_to)
        )
      )
      -- The per-student limit, counted here rather than trusted from the page.
      -- Deleting frees a slot; see board_card_count. Replies are not counted,
      -- because a class where answering someone costs you your own card is not
      -- a discussion.
      and (
        board_posts.reply_to is not null
        or q.board_max_posts is null
        or public.board_card_count(board_posts.question_id, board_posts.participant_id) < q.board_max_posts
      )
  )
  and exists (
    select 1 from public.participants
    where participants.id = board_posts.participant_id
      and participants.session_id = board_posts.session_id
      and participants.name = board_posts.participant_name
  )
  -- A card has to be something. Which field carries it depends on the kind.
  and (
    case board_posts.kind
      when 'text' then char_length(btrim(coalesce(board_posts.body, ''))) between 1 and 1000
      when 'link' then char_length(btrim(coalesce(board_posts.url, ''))) between 4 and 2000
      else char_length(coalesce(board_posts.storage_path, '')) > 0
    end
  )
);

drop policy if exists "read reactions on a revealed board" on public.board_reactions;
create policy "read reactions on a revealed board" on public.board_reactions for select
to anon, authenticated
using (
  exists (
    select 1 from public.board_posts p
    join public.questions q on q.id = p.question_id
    where p.id = board_reactions.post_id and q.board_revealed_at is not null
  )
);

drop policy if exists "mvp read screenshots" on public.screenshots;
create policy "mvp read screenshots" on public.screenshots for select using (true);

drop policy if exists "mvp read questions" on public.questions;
create policy "mvp read questions" on public.questions for select using (true);

drop policy if exists "read dispatched quizzes" on public.quizzes;
create policy "read dispatched quizzes" on public.quizzes for select
to anon, authenticated
using (
  exists (
    select 1 from public.questions
    where questions.id = quizzes.question_id
      and questions.session_id = quizzes.session_id
  )
);

drop policy if exists "read dispatched quiz items" on public.quiz_items;
create policy "read dispatched quiz items" on public.quiz_items for select
to anon, authenticated
using (
  exists (
    select 1 from public.quizzes
    join public.questions on questions.id = quizzes.question_id
    where quizzes.id = quiz_items.quiz_id
  )
);

drop policy if exists "mvp read answers" on public.answers;
create policy "mvp read answers" on public.answers for select using (true);
drop policy if exists "answer active questions" on public.answers;
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
      and questions.answer_round = answers.round
      -- Three seconds of grace for the round trip on school wifi. Without it a
      -- student who taps at 29.8s is rejected at 30.2s, their answer vanishes,
      -- and the teacher sees a bug rather than a deadline. It is never shown:
      -- the grace quietly rescues an answer sent just before the deadline
      -- rather than advertising itself as extra time.
      and (
        questions.answer_seconds is null
        or questions.started_at is null
        or now() <= questions.started_at + make_interval(secs => questions.answer_seconds + 3)
      )
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
drop policy if exists "mvp read ai summaries" on public.ai_summaries;
create policy "mvp read ai summaries" on public.ai_summaries for select using (true);
revoke insert on public.ai_summaries from anon, authenticated;

drop policy if exists "mvp read exit tickets" on public.exit_tickets;
create policy "mvp read exit tickets" on public.exit_tickets for select using (true);
drop policy if exists "submit exit tickets to active sessions" on public.exit_tickets;
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

drop policy if exists "public read shared contents" on public.shared_contents;
create policy "public read shared contents" on public.shared_contents for select to anon, authenticated using (true);
drop policy if exists "public read shared files" on public.shared_files;
create policy "public read shared files" on public.shared_files for select to anon, authenticated using (true);
drop policy if exists "public read caption segments" on public.caption_segments;
create policy "public read caption segments" on public.caption_segments for select to anon, authenticated using (true);
drop policy if exists "public read session events" on public.session_events;
create policy "public read session events" on public.session_events for select to anon, authenticated using (true);

revoke all on all tables in schema public from anon, authenticated;
grant select on public.sessions, public.screenshots, public.questions, public.ai_summaries,
  public.shared_contents, public.session_events, public.caption_segments,
  public.quizzes, public.quiz_items, public.shared_files, public.participant_points to anon, authenticated;
grant select, insert on public.participants to anon, authenticated;
grant select, insert on public.messages, public.answers, public.exit_tickets to anon, authenticated;
-- A card is written straight from the page, the way a danmaku message is, so
-- it appears on the wall the instant it is sent. Taking one down, and liking
-- one, go through participant-action instead: those need to know WHICH student
-- is asking, and a policy cannot tell — it can only check that the row names
-- somebody who is in this session.
grant select, insert on public.board_posts to anon, authenticated;
grant select on public.board_reactions to anon, authenticated;
grant all on public.board_posts, public.board_reactions to service_role;

revoke all on public.participant_session_keys, public.audio_responses, public.file_responses, public.quiz_item_keys,
  public.quiz_attempts, public.quiz_item_answers, public.question_keys from public, anon, authenticated;
grant all on public.participant_session_keys, public.audio_responses, public.shared_files, public.file_responses, public.quizzes, public.quiz_items,
  public.quiz_item_keys, public.quiz_attempts, public.quiz_item_answers, public.question_keys to service_role;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sessions'
  ) then
    alter publication supabase_realtime add table public.sessions;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participants'
  ) then
    alter publication supabase_realtime add table public.participants;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participant_points'
  ) then
    alter publication supabase_realtime add table public.participant_points;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_posts'
  ) then
    alter publication supabase_realtime add table public.board_posts;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_reactions'
  ) then
    alter publication supabase_realtime add table public.board_reactions;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'screenshots'
  ) then
    alter publication supabase_realtime add table public.screenshots;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'questions'
  ) then
    alter publication supabase_realtime add table public.questions;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'answers'
  ) then
    alter publication supabase_realtime add table public.answers;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ai_summaries'
  ) then
    alter publication supabase_realtime add table public.ai_summaries;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exit_tickets'
  ) then
    alter publication supabase_realtime add table public.exit_tickets;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_contents'
  ) then
    alter publication supabase_realtime add table public.shared_contents;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'session_events'
  ) then
    alter publication supabase_realtime add table public.session_events;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'caption_segments'
  ) then
    alter publication supabase_realtime add table public.caption_segments;
  end if;
end $$;
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_files'
  ) then
    alter publication supabase_realtime add table public.shared_files;
  end if;
end $$;


-- Columns introduced by later migrations. `create table if not exists` above does
-- nothing when the table already exists, so without these an existing project
-- never gains them however many times this file is applied.

alter table public.answers
  add column if not exists answer_values text[] null,
  add column if not exists round integer not null default 1;

-- One answer per student per question BECOMES one per round. Dropping the old
-- constraint by its generated name is safe: it is what Postgres called the
-- inline `unique (question_id, participant_id)` on this table.
--
-- This has to sit down here, below the table, and not beside the question-type
-- migration it was written next to. Up there it ran before `create table
-- public.answers`, so on a project that did not have the table yet it raised
-- 42P01 — and the whole file is one transaction, so every table it had already
-- made was rolled back. A brand new project came out of a successful-looking
-- deployment with nothing in it at all.
do $mig$ begin
  alter table public.answers drop constraint if exists answers_question_id_participant_id_key;
  alter table public.answers
    add constraint answers_question_participant_round_key
    unique (question_id, participant_id, round);
exception when duplicate_table or duplicate_object then null; end $mig$;

alter table public.exit_tickets
  add column if not exists response_text text null,
  add column if not exists rating int null;

alter table public.questions
  add column if not exists allow_multiple boolean not null default false,
  add column if not exists correct_answers text[] not null default '{}'::text[],
  add column if not exists prompt_text text null,
  add column if not exists translations jsonb not null default '{}'::jsonb;

alter table public.sessions
  add column if not exists exit_ticket_prompt text null,
  add column if not exists exit_ticket_category text null,
  add column if not exists exit_ticket_response_type text null,
  add column if not exists captions_enabled boolean not null default false,
  add column if not exists caption_status text not null default 'idle'
    check (caption_status in ('idle', 'starting', 'live', 'error')),
  add column if not exists caption_source_language text not null default 'zh-tw',
  add column if not exists caption_display_language text not null default 'zh-tw',
  add column if not exists interpretation_enabled boolean not null default false,
  add column if not exists interpretation_languages text[] not null default '{}'::text[],
  add column if not exists caption_started_at timestamptz,
  add column if not exists interpretation_audio_enabled boolean not null default false,
  add column if not exists recording_enabled boolean not null default false,
  add column if not exists caption_font_size integer not null default 32,
  add column if not exists caption_font_bold boolean not null default true,
  add column if not exists exit_ticket_prompt_en text,
  add column if not exists caption_position text not null default 'bottom';

-- Defaults that changed after the column already existed. `add column if not
-- exists` above leaves an existing column exactly as it was, so a project that
-- has been deployed once would keep handing out the old value forever.
alter table public.sessions
  alter column caption_font_size set default 32;

-- Tracks how long a student had the class page in the background. Added here
-- rather than only in the table above so a project deployed earlier gains it.
alter table public.participants
  add column if not exists unfocused_ms bigint not null default 0,
  add column if not exists focus_streak_ms bigint not null default 0,
  add column if not exists removed_at timestamptz null,
  -- Set when the student asks to be called on, cleared when the presenter
  -- acknowledges it. A timestamp rather than a flag so the class list can put
  -- the longest-waiting hand first.
  add column if not exists hand_raised_at timestamptz null;

-- Students may now correct a card instead of withdrawing it, which cost them
-- one of their allotted cards.
alter table public.board_posts
  add column if not exists edited_at timestamptz null;

-- Accumulating a column cannot be expressed through the REST API, and reading
-- then writing would lose concurrent heartbeats.
create or replace function public.bump_participant_presence(
  target_id uuid,
  unfocused_delta bigint,
  focus_streak bigint default 0
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.participants
  set last_seen_at = now(),
      unfocused_ms = unfocused_ms + greatest(unfocused_delta, 0)
        -- A silence far longer than the heartbeat interval means the page was
        -- not running at all — closed, or on a sleeping device — and a page
        -- that is not running cannot report the time it was away.
        --
        -- That absence used to live only in the gap between last_seen_at and
        -- now, which is a live reading and nothing more: the first heartbeat
        -- back moved last_seen_at to the present and the whole absence
        -- vanished. A student who shut the tab for twenty minutes and came
        -- back looked exactly like one who never left. Folding it in here is
        -- what makes it survive their return, and it cannot double count —
        -- whatever the client did manage to measure is taken off first.
        + case
            when now() - last_seen_at > interval '90 seconds' then
              greatest(
                extract(epoch from (now() - last_seen_at)) * 1000
                  - greatest(unfocused_delta, 0),
                0
              )::bigint
            else 0
          end,
      -- The client reports its current unbroken stretch, which resets to zero
      -- when the student leaves; keeping the largest is what "was focused for
      -- ten minutes at a time" means.
      focus_streak_ms = greatest(focus_streak_ms, greatest(focus_streak, 0))
  where id = target_id;
$$;


insert into storage.buckets (id, name, public)
values ('interact-screenshots', 'interact-screenshots', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('interact-files', 'interact-files', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('interact-recordings', 'interact-recordings', false, 10485760, array['audio/wav']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- PostgREST answers from a cached copy of the schema, so a column added above is
-- invisible until it reloads — the app would keep reporting PGRST204 for a column
-- that already exists.
notify pgrst, 'reload schema';
