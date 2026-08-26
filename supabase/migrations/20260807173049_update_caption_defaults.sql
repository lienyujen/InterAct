alter table public.sessions
  alter column caption_font_size set default 42,
  alter column caption_font_bold set default false;

update public.sessions
set caption_font_size = 42,
    caption_font_bold = false
where status = 'active'
  and caption_font_size = 48
  and caption_font_bold = true;
