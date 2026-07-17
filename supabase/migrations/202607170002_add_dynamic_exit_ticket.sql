alter table public.questions
  add column if not exists prompt_text text null;

alter table public.sessions
  add column if not exists exit_ticket_prompt text null,
  add column if not exists exit_ticket_category text null,
  add column if not exists exit_ticket_response_type text null;

alter table public.sessions
  drop constraint if exists sessions_exit_ticket_category_check,
  add constraint sessions_exit_ticket_category_check
    check (exit_ticket_category in ('lesson_summary', 'learning_assessment', 'course_satisfaction', 'student_question')),
  drop constraint if exists sessions_exit_ticket_response_type_check,
  add constraint sessions_exit_ticket_response_type_check
    check (exit_ticket_response_type in ('text', 'rating'));

alter table public.exit_tickets
  alter column understanding_score drop not null,
  alter column engagement_score drop not null,
  add column if not exists response_text text null,
  add column if not exists rating int null;

alter table public.exit_tickets
  drop constraint if exists exit_tickets_rating_check,
  add constraint exit_tickets_rating_check check (rating between 1 and 5);
