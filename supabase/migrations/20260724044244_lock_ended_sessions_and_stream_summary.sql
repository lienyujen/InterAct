-- The public web app may read sessions, but only the service-role backed
-- create-session function may create them.
drop policy if exists "mvp insert sessions" on public.sessions;
revoke insert on public.sessions from anon, authenticated;

drop policy if exists "mvp update sessions" on public.sessions;
create policy "update active sessions only"
  on public.sessions for update
  to anon, authenticated
  using (status = 'active')
  with check (status = 'active' and ended_at is null);

drop policy if exists "mvp insert participants" on public.participants;
create policy "join active sessions"
  on public.participants for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = participants.session_id
        and sessions.status = 'active'
    )
    and char_length(btrim(name)) between 1 and 80
    and char_length(device_id) between 1 and 200
  );

drop policy if exists "mvp update participants" on public.participants;
create policy "update participants in active sessions"
  on public.participants for update
  to anon, authenticated
  using (
    exists (
      select 1
      from public.sessions
      where sessions.id = participants.session_id
        and sessions.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = participants.session_id
        and sessions.status = 'active'
    )
    and char_length(btrim(name)) between 1 and 80
    and char_length(device_id) between 1 and 200
  );

drop policy if exists "mvp insert messages" on public.messages;
create policy "send messages to active sessions"
  on public.messages for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = messages.session_id
        and sessions.status = 'active'
    )
    and exists (
      select 1
      from public.participants
      where participants.id = messages.participant_id
        and participants.session_id = messages.session_id
        and participants.name = messages.participant_name
    )
    and char_length(btrim(content)) between 1 and 36
  );

drop policy if exists "mvp update messages" on public.messages;

drop policy if exists "mvp insert screenshots" on public.screenshots;
create policy "add screenshots to active sessions"
  on public.screenshots for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = screenshots.session_id
        and sessions.status = 'active'
    )
  );

drop policy if exists "mvp update screenshots" on public.screenshots;
create policy "update screenshots in active sessions"
  on public.screenshots for update
  to anon, authenticated
  using (
    exists (
      select 1
      from public.sessions
      where sessions.id = screenshots.session_id
        and sessions.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = screenshots.session_id
        and sessions.status = 'active'
    )
  );

drop policy if exists "mvp insert questions" on public.questions;
create policy "add questions to active sessions"
  on public.questions for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = questions.session_id
        and sessions.status = 'active'
    )
  );

drop policy if exists "mvp update questions" on public.questions;
create policy "update questions in active sessions"
  on public.questions for update
  to anon, authenticated
  using (
    exists (
      select 1
      from public.sessions
      where sessions.id = questions.session_id
        and sessions.status = 'active'
    )
  )
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = questions.session_id
        and sessions.status = 'active'
    )
  );

drop policy if exists "mvp insert answers" on public.answers;
create policy "answer active questions"
  on public.answers for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = answers.session_id
        and sessions.status = 'active'
    )
    and exists (
      select 1
      from public.questions
      where questions.id = answers.question_id
        and questions.session_id = answers.session_id
        and questions.status = 'active'
    )
    and exists (
      select 1
      from public.participants
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

drop policy if exists "mvp update answers" on public.answers;
create policy "grade answers before class ends"
  on public.answers for update
  to anon, authenticated
  using (
    exists (
      select 1
      from public.sessions
      where sessions.id = answers.session_id
        and sessions.status = 'active'
    )
    and exists (
      select 1
      from public.questions
      where questions.id = answers.question_id
        and questions.session_id = answers.session_id
        and questions.status in ('stopped', 'closed')
    )
  )
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = answers.session_id
        and sessions.status = 'active'
    )
    and exists (
      select 1
      from public.questions
      where questions.id = answers.question_id
        and questions.session_id = answers.session_id
        and questions.status in ('stopped', 'closed')
    )
  );

drop policy if exists "mvp insert exit tickets" on public.exit_tickets;
create policy "submit exit tickets to active sessions"
  on public.exit_tickets for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.sessions
      where sessions.id = exit_tickets.session_id
        and sessions.status = 'active'
        and sessions.exit_ticket_prompt is not null
    )
    and exists (
      select 1
      from public.participants
      where participants.id = exit_tickets.participant_id
        and participants.session_id = exit_tickets.session_id
        and participants.name = exit_tickets.participant_name
    )
    and coalesce(char_length(response_text), 0) <= 2000
  );

-- AI rows are written only by authenticated Edge Functions using service_role.
drop policy if exists "mvp insert ai summaries" on public.ai_summaries;
revoke insert on public.ai_summaries from anon, authenticated;

-- Stream the completed session summary to every participant still on the page.
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ai_summaries'
  ) then
    alter publication supabase_realtime add table public.ai_summaries;
  end if;
end
$$;

-- Screenshot object writes also stop as soon as the referenced session ends.
drop policy if exists "mvp insert screenshot objects" on storage.objects;
create policy "upload screenshots to active sessions"
  on storage.objects for insert
  to anon, authenticated
  with check (
    bucket_id = 'interact-screenshots'
    and (storage.foldername(name))[1] = 'sessions'
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.sessions
      where sessions.id = ((storage.foldername(name))[2])::uuid
        and sessions.status = 'active'
    )
  );

drop policy if exists "mvp update screenshot objects" on storage.objects;
create policy "replace screenshots in active sessions"
  on storage.objects for update
  to anon, authenticated
  using (
    bucket_id = 'interact-screenshots'
    and (storage.foldername(name))[1] = 'sessions'
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.sessions
      where sessions.id = ((storage.foldername(name))[2])::uuid
        and sessions.status = 'active'
    )
  )
  with check (
    bucket_id = 'interact-screenshots'
    and (storage.foldername(name))[1] = 'sessions'
    and (storage.foldername(name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and exists (
      select 1
      from public.sessions
      where sessions.id = ((storage.foldername(name))[2])::uuid
        and sessions.status = 'active'
    )
  );
