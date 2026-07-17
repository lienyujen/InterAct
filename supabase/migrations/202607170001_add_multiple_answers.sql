alter table public.questions
  add column if not exists allow_multiple boolean not null default false,
  add column if not exists correct_answers text[] not null default '{}'::text[];

alter table public.answers
  add column if not exists answer_values text[] null;
