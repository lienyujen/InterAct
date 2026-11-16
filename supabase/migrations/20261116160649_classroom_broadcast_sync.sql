-- Public invalidation hints contain IDs only, never answers or AI content.
-- Keep legacy publications for installed presenters and unmigrated browsers.
create or replace function public.notify_classroom_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare row_data jsonb;
begin
  if TG_TABLE_NAME = 'participants' and TG_OP = 'UPDATE' then
    if (to_jsonb(OLD) - array['last_seen_at','unfocused_ms','focus_streak_ms'])
      is not distinct from (to_jsonb(NEW) - array['last_seen_at','unfocused_ms','focus_streak_ms']) then
      return null;
    end if;
  end if;
  if TG_OP = 'DELETE' then row_data := to_jsonb(OLD); else row_data := to_jsonb(NEW); end if;
  perform realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'eventType', TG_OP,
    'id', row_data->>'id', 'session_id', row_data->>'session_id'),
    'change:' || TG_TABLE_NAME, 'classroom-changes:' || (row_data->>'session_id'), false);
  return null;
end;
$$;
revoke all on function public.notify_classroom_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['questions','screenshots','ai_summaries','shared_contents','session_events','participants'] loop
    execute format('drop trigger if exists classroom_change_broadcast on public.%I', t);
    execute format('create trigger classroom_change_broadcast after insert or update or delete on public.%I for each row execute function public.notify_classroom_change()', t);
  end loop;
end;
$$;
-- Advertise support only after all notification triggers exist.
alter table public.sessions add column if not exists classroom_sync_version integer not null default 1;
notify pgrst, 'reload schema';
