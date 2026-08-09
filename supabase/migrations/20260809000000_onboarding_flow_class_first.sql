-- Onboarding rebuild: class -> board -> optional competitive exam.
--
-- WHY: the exam step mixed real goals (NEET, JEE_MAIN) with class levels
-- (CLASS_8..CLASS_12) and the class step then asked for class AGAIN, so a
-- student could end up as target_exam='CLASS_10' with class_level='12'. The
-- deeper problem was that the goal was treated as exclusive — a Class 12 CBSE
-- student preparing for NEET is preparing for BOTH, which a single
-- target_exam value can't express.
--
-- New model: class_level and syllabus are universal and asked first;
-- target_exam becomes the OPTIONAL competitive add-on ('NONE' when the student
-- is board-only). allowed_class_levels gates which competitive exams are
-- offered, so a Class 8 student is never shown NEET.
--
-- Scope narrowed per product decision: classes 8-12 only, boards CBSE and
-- Kerala State only.

begin;

/* ── 1. Gate competitive options by class ──────────────────────────────── */

alter table onboarding_category_display
  add column if not exists allowed_class_levels text[] not null default '{}';

comment on column onboarding_category_display.allowed_class_levels is
  'Which class_level values this option is offered for. Empty = every class. '
  'Exam-step only; ignored for board/class options.';

-- MUST drop before recreating: adding a defaulted parameter creates a second
-- OVERLOAD rather than replacing the function, and PostgREST cannot
-- disambiguate two overloads of the same name — that is exactly the PGRST203
-- failure that silently broke every flashcard review in production
-- (see docs/CHANGELOG.md, BUG-004).
drop function if exists public.admin_upsert_onboarding_option(
  text, uuid, text, text, text[], text, text, text, text, integer, boolean, boolean, boolean, text
);

create or replace function public.admin_upsert_onboarding_option(
  p_caller text,
  p_id uuid,
  p_option_type text,
  p_option_key text,
  p_category_keys text[],
  p_title text,
  p_description text,
  p_icon_name text,
  p_color text,
  p_sort_order integer,
  p_is_active boolean,
  p_needs_board boolean default false,
  p_needs_class boolean default false,
  p_default_class_level text default null,
  p_allowed_class_levels text[] default '{}'
)
returns onboarding_category_display
language plpgsql
security definer
set search_path = public
as $$
declare v_role text; v_row onboarding_category_display;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  insert into onboarding_category_display (
    id, option_type, option_key, category_keys, title, description,
    icon_name, color, sort_order, is_active, needs_board, needs_class,
    default_class_level, allowed_class_levels, updated_at
  )
  values (
    coalesce(p_id, gen_random_uuid()), p_option_type, p_option_key, p_category_keys,
    p_title, p_description, p_icon_name, p_color, p_sort_order, p_is_active,
    p_needs_board, p_needs_class, p_default_class_level, coalesce(p_allowed_class_levels, '{}'), now()
  )
  on conflict (id) do update set
    option_type = excluded.option_type, option_key = excluded.option_key,
    category_keys = excluded.category_keys, title = excluded.title,
    description = excluded.description, icon_name = excluded.icon_name,
    color = excluded.color, sort_order = excluded.sort_order,
    is_active = excluded.is_active, needs_board = excluded.needs_board,
    needs_class = excluded.needs_class, default_class_level = excluded.default_class_level,
    allowed_class_levels = excluded.allowed_class_levels,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.admin_upsert_onboarding_option(
  text, uuid, text, text, text[], text, text, text, text, integer, boolean, boolean, boolean, text, text[]
) to anon, authenticated;

-- get_onboarding_options() returns `setof onboarding_category_display`, so the
-- new column flows through with no change needed there.

/* ── 2. Re-seed the onboarding options to the new flow ─────────────────── */

-- Retire everything, then re-activate exactly what the new flow offers. Rows
-- are deactivated rather than deleted so nothing that referenced them breaks
-- and an admin can re-enable an option instead of re-creating it.
update onboarding_category_display set is_active = false, updated_at = now();

-- Step 1 — class (8-12 + repeater)
insert into onboarding_category_display
  (option_type, option_key, category_keys, title, description, icon_name, color, sort_order, is_active)
values
  ('class', '8',        '{"Class 8"}',  'Class 8',            '',                                'BookOpen',      'sky',     10, true),
  ('class', '9',        '{"Class 9"}',  'Class 9',            '',                                'BookOpen',      'sky',     20, true),
  ('class', '10',       '{"Class 10"}', 'Class 10',           '',                                'BookOpen',      'blue',    30, true),
  ('class', '11',       '{"Class 11"}', 'Class 11',           '',                                'Sprout',        'green',   40, true),
  ('class', '12',       '{"Class 12"}', 'Class 12',           '',                                'GraduationCap', 'emerald', 50, true),
  ('class', 'REPEATER', '{}',           'Repeater / Dropper', 'Gap year / second attempt',       'RotateCcw',     'amber',   60, true)
on conflict (option_type, option_key) do update set
  title = excluded.title, description = excluded.description, icon_name = excluded.icon_name,
  color = excluded.color, sort_order = excluded.sort_order, is_active = true,
  category_keys = excluded.category_keys, updated_at = now();

-- Step 2 — board (CBSE + Kerala State only)
insert into onboarding_category_display
  (option_type, option_key, category_keys, title, description, icon_name, color, sort_order, is_active)
values
  ('board', 'CBSE',         '{"CBSE"}',         'CBSE',         'Central Board of Secondary Education', 'BookOpen', 'blue', 10, true),
  ('board', 'KERALA_STATE', '{"Kerala State"}', 'Kerala State', 'SCERT Kerala',                         'TreePalm', 'teal', 20, true)
on conflict (option_type, option_key) do update set
  title = excluded.title, description = excluded.description, icon_name = excluded.icon_name,
  color = excluded.color, sort_order = excluded.sort_order, is_active = true,
  category_keys = excluded.category_keys, updated_at = now();

-- Step 3 — optional competitive add-on, gated by class.
-- 'NONE' has an empty allowed_class_levels so it is offered for every class;
-- it is also the value written when the step is skipped entirely.
insert into onboarding_category_display
  (option_type, option_key, category_keys, title, description, icon_name, color, sort_order, is_active, allowed_class_levels)
values
  ('exam', 'NONE',         '{}',                     'Board exams only', 'Focus on my school syllabus', 'BookOpen',     'slate',  10, true, '{}'),
  ('exam', 'NEET',         '{"NEET"}',               'NEET UG',          'Medical entrance — PCB',      'Dna',          'rose',   20, true, '{11,12,REPEATER}'),
  ('exam', 'JEE_MAIN',     '{"JEE Main"}',           'JEE',              'Engineering entrance — PCM',  'Atom',         'blue',   30, true, '{11,12,REPEATER}'),
  ('exam', 'JEE_ADVANCED', '{"JEE Advanced"}',       'JEE Advanced',     'IIT entrance — advanced PCM', 'FlaskConical', 'violet', 40, true, '{11,12,REPEATER}'),
  ('exam', 'BOTH',         '{"NEET","JEE Main"}',    'NEET + JEE',       'Double preparation',          'Rocket',       'amber',  50, true, '{11,12,REPEATER}')
on conflict (option_type, option_key) do update set
  title = excluded.title, description = excluded.description, icon_name = excluded.icon_name,
  color = excluded.color, sort_order = excluded.sort_order, is_active = true,
  category_keys = excluded.category_keys,
  allowed_class_levels = excluded.allowed_class_levels, updated_at = now();

/* ── 3. Narrow exam_categories to classes 8-12, CBSE + Kerala State ────── */

-- Deactivated, not deleted: existing content rows still reference these
-- exam_type keys, and is_active is already the flag loadCategories() filters
-- on, so deactivating removes them from every picker without orphaning data.
update exam_categories set is_active = false, updated_at = now()
where exam_key in ('ICSE', 'Class 6', 'Class 7')
   or exam_key like 'ICSE Class %'
   or exam_key in (
     'CBSE Class 6', 'CBSE Class 7',
     'Kerala State Class 6', 'Kerala State Class 7'
   );

-- Make sure every combo the new flow can produce actually exists.
-- Subject tiers mirror the existing CBSE rows: 8-10 school subjects,
-- 11-12 senior subjects.
insert into exam_categories (exam_key, label, category_kind, board_key, class_key, group_label, subjects, sort_order, is_active)
values
  ('Kerala State Class 8',  'Kerala State Class 8',  'board_class', 'Kerala State', '8',  'Kerala State Board',
   '{Mathematics,Science,"Social Studies",English,Hindi}', 42, true),
  ('Kerala State Class 9',  'Kerala State Class 9',  'board_class', 'Kerala State', '9',  'Kerala State Board',
   '{Mathematics,Science,"Social Studies",English,Hindi}', 43, true),
  ('Kerala State Class 10', 'Kerala State Class 10', 'board_class', 'Kerala State', '10', 'Kerala State Board',
   '{Mathematics,Science,"Social Studies",English,Hindi,Sanskrit}', 44, true),
  ('Kerala State Class 11', 'Kerala State Class 11', 'board_class', 'Kerala State', '11', 'Kerala State Board',
   '{Physics,Chemistry,Biology,Mathematics,English,Economics,Accountancy,"Business Studies","Computer Science"}', 45, true),
  ('Kerala State Class 12', 'Kerala State Class 12', 'board_class', 'Kerala State', '12', 'Kerala State Board',
   '{Physics,Chemistry,Biology,Mathematics,English,Economics,Accountancy,"Business Studies","Computer Science"}', 46, true)
on conflict (exam_key) do update set
  category_kind = excluded.category_kind, board_key = excluded.board_key,
  class_key = excluded.class_key, group_label = excluded.group_label,
  is_active = true, updated_at = now();

-- Re-activate the in-scope rows in case a previous narrowing turned them off.
update exam_categories set is_active = true, updated_at = now()
where exam_key in ('CBSE', 'Kerala State', 'NEET', 'JEE Main')
   or exam_key in ('Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12')
   or exam_key in ('CBSE Class 8', 'CBSE Class 9', 'CBSE Class 10', 'CBSE Class 11', 'CBSE Class 12');

commit;
