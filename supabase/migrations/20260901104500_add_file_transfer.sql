-- 檔案傳送：教師分享檔案給學生，以及學生回傳檔案給教師。
-- Bucket is public: download links can be handed out directly, and delete_session
-- clears every object under the session prefix.
insert into storage.buckets (id, name, public)
values ('interact-files', 'interact-files', true)
on conflict (id) do update set public = excluded.public;

-- Teacher -> students. Students read this table directly and build the public URL.
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

-- Students -> teacher, one row per uploaded file. Analysis is triggered per file by
-- the presenter, never automatically; unsupported types are marked, not attempted.
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
create index if not exists file_responses_question_idx on public.file_responses (question_id, submitted_at);

alter table public.shared_files enable row level security;
alter table public.file_responses enable row level security;

create policy "public read shared files" on public.shared_files
  for select to anon, authenticated using (true);

grant select on public.shared_files to anon, authenticated;
revoke all on public.file_responses from public, anon, authenticated;
grant all on public.shared_files, public.file_responses to service_role;

alter publication supabase_realtime add table public.shared_files;

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions add constraint questions_type_check check (
  type in ('send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer',
           'pronunciation', 'oral_response', 'custom_quiz', 'file_upload')
);
