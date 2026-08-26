alter table public.sessions
  alter column caption_font_size set default 36;

update public.sessions
set caption_font_size = 36
where caption_font_size = 42;

alter table public.sessions
  add column if not exists caption_position text not null default 'bottom';

alter table public.sessions
  drop constraint if exists sessions_caption_position_check;

alter table public.sessions
  add constraint sessions_caption_position_check
  check (caption_position in ('top', 'center', 'bottom'));
