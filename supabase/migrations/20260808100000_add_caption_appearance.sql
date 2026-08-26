alter table public.sessions
  add column if not exists caption_font_size integer not null default 48,
  add column if not exists caption_font_bold boolean not null default true;

alter table public.sessions
  drop constraint if exists sessions_caption_font_size_check;

alter table public.sessions
  add constraint sessions_caption_font_size_check
  check (caption_font_size between 24 and 96);

update public.sessions
set caption_display_language = caption_source_language;
