-- Whole-class camera responses store only the teacher-reviewed aggregate.
-- The camera frame is sent transiently to the Edge Function and is never
-- inserted into Storage or the database.
alter table public.questions
  add column if not exists camera_gesture_map text[] not null default '{}'::text[],
  add column if not exists camera_result jsonb null,
  add column if not exists camera_published_at timestamptz null;

alter table public.questions drop constraint if exists questions_type_check;
alter table public.questions
  add constraint questions_type_check check (type in (
    'send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer',
    'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'drawing',
    'hotspot', 'ordering', 'matching', 'board', 'camera_poll'
  ));

alter table public.questions drop constraint if exists questions_camera_result_check;
alter table public.questions add constraint questions_camera_result_check check (
  camera_result is null or (
    jsonb_typeof(camera_result) = 'object'
    and jsonb_typeof(camera_result -> 'counts') = 'array'
    and jsonb_typeof(camera_result -> 'unknownCount') = 'number'
    and jsonb_typeof(camera_result -> 'totalDetected') = 'number'
  )
);
