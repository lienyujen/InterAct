alter table public.questions add column if not exists repeat_root_id uuid references public.questions(id) on delete set null;
alter table public.questions add column if not exists repeat_number integer not null default 1;
alter table public.questions add column if not exists repeat_request_id uuid unique;
alter table public.questions add column if not exists assignment_audience uuid[];

create or replace function public.capture_assignment_audience() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if NEW.assignment_audience is null then
    select coalesce(array_agg(id), '{}'::uuid[]) into NEW.assignment_audience
    from public.participants where session_id=NEW.session_id and removed_at is null
      and last_seen_at >= now()-interval '90 seconds';
  end if;
  return NEW;
end; $$;
revoke all on function public.capture_assignment_audience() from public, anon, authenticated;
drop trigger if exists capture_assignment_audience on public.questions;
create trigger capture_assignment_audience before insert on public.questions
for each row execute function public.capture_assignment_audience();

create or replace function public.repeat_assignment(target_session uuid, target_question uuid, request_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  q public.questions%rowtype; source public.questions%rowtype;
  quiz public.quizzes%rowtype; item public.quiz_items%rowtype;
  old_quiz uuid; old_item uuid; new_quiz uuid;
begin
  perform 1 from public.sessions where id=target_session and status='active' for update;
  if not found then raise exception '課堂已結束。'; end if;
  select * into q from public.questions where session_id=target_session and repeat_request_id=request_id;
  if found then return to_jsonb(q); end if;
  select * into source from public.questions where id=target_question and session_id=target_session;
  if not found then raise exception '找不到題目。'; end if;
  if source.type='camera_poll' then raise exception '相機作答請重新拍攝。'; end if;
  q:=source;
  q.id:=gen_random_uuid(); q.repeat_request_id:=request_id;
  q.repeat_root_id:=coalesce(source.repeat_root_id,source.id);
  select coalesce(max(greatest(repeat_number,answer_round)),1)+1 into q.repeat_number from public.questions
    where id=q.repeat_root_id or repeat_root_id=q.repeat_root_id;
  q.title:=regexp_replace(source.title,'（第[0-9]+輪）$','') || '（第' || q.repeat_number || '輪）';
  q.status:='active'; q.answer_round:=1; q.created_at:=now(); q.started_at:=now(); q.stopped_at:=null;
  q.assignment_audience:=null;
  if q.board_revealed_at is not null then q.board_revealed_at:=now(); end if;
  if source.type <> 'send_screen' then
    update public.questions set status='stopped',stopped_at=now()
      where session_id=target_session and status='active' and (type<>'board' or source.type='board');
  end if;
  insert into public.questions select q.* returning * into q;
  insert into public.question_keys(question_id,session_id,correct_values)
    select q.id,target_session,correct_values from public.question_keys where question_id=source.id;
  if q.type='custom_quiz' then
    select * into quiz from public.quizzes where question_id=source.id;
    if not found or not exists(select 1 from public.quiz_items where quiz_id=quiz.id) then
      raise exception '測驗尚未出題完成，請稍後重試。';
    end if;
    old_quiz:=quiz.id; quiz.id:=gen_random_uuid(); new_quiz:=quiz.id;
    quiz.question_id:=q.id; quiz.created_at:=now();
    insert into public.quizzes select quiz.*;
    for item in select * from public.quiz_items where quiz_id=old_quiz order by position loop
      old_item:=item.id; item.id:=gen_random_uuid(); item.quiz_id:=new_quiz; item.created_at:=now();
      insert into public.quiz_items select item.*;
      insert into public.quiz_item_keys(item_id,accepted_answers,rubric)
        select item.id,accepted_answers,rubric from public.quiz_item_keys where item_id=old_item;
    end loop;
  end if;
  update public.sessions set current_question_id=case when q.type='send_screen'
      then coalesce((select id from public.questions where session_id=target_session and status='active'
        and type not in ('send_screen','board') order by created_at desc limit 1),q.id) else q.id end,
    board_question_id=case when q.type='board' then q.id else board_question_id end where id=target_session;
  return to_jsonb(q);
end; $$;
revoke all on function public.repeat_assignment(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.repeat_assignment(uuid,uuid,uuid) to service_role;

create or replace function public.assignment_progress(target_session uuid, target_question uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  with q as (select * from public.questions where id=target_question and session_id=target_session),
  submitted as (
    select a.participant_id from public.answers a join q on q.id=a.question_id where a.round=q.answer_round
    union select a.participant_id from public.audio_responses a join q on q.id=a.question_id
    union select a.participant_id from public.file_responses a join q on q.id=a.question_id
    union select a.participant_id from public.quiz_attempts a join q on q.id=a.question_id
  )
  select jsonb_build_object('questionId',q.id,'status',q.status,'type',q.type,'round',q.repeat_number,
    'expectedIds',coalesce((select jsonb_agg(p.id) from public.participants p where p.session_id=target_session
      and p.removed_at is null and (p.id=any(q.assignment_audience) or (q.assignment_audience is null and p.joined_at<=q.created_at)
        or p.joined_at between q.created_at and coalesce(q.stopped_at,now()) or p.id in(select participant_id from submitted))), '[]'::jsonb),
    'submittedIds',coalesce((select jsonb_agg(participant_id) from submitted),'[]'::jsonb)) from q;
$$;
revoke all on function public.assignment_progress(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assignment_progress(uuid,uuid) to service_role;
notify pgrst,'reload schema';
