-- PART B (batch 7): onboarding's board/class/exam options were hardcoded in
-- OnboardingPage.jsx (EXAM_OPTIONS/BOARD_OPTIONS/CLASS_OPTIONS), completely
-- disconnected from Categories (exam_categories) — the same "declared shared
-- source of truth that isn't wired up" bug shape as the Syllabus Manager fix
-- in batch 6. Not rewired at the time because the hardcoded version carries
-- real curated presentation (icons, descriptions, groupings like "Class 8-9"
-- spanning two real Categories rows) that doesn't map 1:1 onto flat
-- Categories entries.
--
-- This table makes the PRESENTATION admin-editable while the actual saved
-- value (option_key) stays byte-identical to what OnboardingPage.jsx already
-- saved — 'NEET', 'BOTH', 'CLASS_8_9', etc. — so every downstream consumer
-- (normalizeExamType, getExamLabel, buildExamType, profile display, exam
-- pattern lookups) keeps working completely unchanged. category_keys is
-- purely a validation aid (which real Categories rows this option
-- corresponds to), never part of what's actually written to a student's
-- profile.
create table if not exists onboarding_category_display (
  id                  uuid primary key default gen_random_uuid(),
  option_type         text not null check (option_type in ('exam', 'board', 'class')),
  -- The exact raw id OnboardingPage.jsx has always saved to
  -- target_exam / syllabus / class_level — e.g. 'NEET', 'BOTH', 'CLASS_8_9'.
  option_key          text not null,
  -- Real Categories exam_key(s) this option corresponds to — informational/
  -- validation only. A combo like "NEET + JEE" has two; "Repeater/Dropper"
  -- (a class-step option with no real Categories row) has zero, which is
  -- valid and expected, not an error.
  category_keys       text[] not null default '{}',
  title               text not null,
  description         text not null default '',
  -- lucide-react export name, e.g. 'Dna', 'Atom' — resolved dynamically via
  -- `LucideIcons[icon_name]` on the client, same approach as any
  -- string-driven icon picker, not a bespoke icon enum.
  icon_name           text not null default 'BookOpen',
  -- Matches OnboardingPage.jsx's existing COLOR_MAP keys (rose/blue/violet/
  -- amber/sky/emerald/teal/green/indigo/slate/purple) so colors stay within
  -- the palette Tailwind's content scanner already picks up at build time.
  color               text not null default 'slate',
  sort_order          integer not null default 0,
  is_active           boolean not null default true,
  -- Exam-step-only behavioral fields — preserves getSteps()'s original
  -- branching (which exam choices prompt a follow-up board/class step) and
  -- getDefaultClass()'s pre-fill, now data-driven instead of hardcoded id
  -- arrays. Irrelevant (left null/false) for option_type='board'|'class'.
  needs_board         boolean not null default false,
  needs_class         boolean not null default false,
  default_class_level text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (option_type, option_key)
);

alter table onboarding_category_display enable row level security;
-- No direct policies — all access via SECURITY DEFINER RPCs below, same
-- pattern as every other table in this app (Firebase auth has no
-- auth.uid() in Postgres).

-- Public read (students hit this during onboarding, before any admin
-- context exists) — only active rows, ordered for direct rendering.
create or replace function public.get_onboarding_options()
returns setof onboarding_category_display
language sql
security definer
set search_path = public
as $$
  select * from onboarding_category_display
  where is_active = true
  order by option_type, sort_order;
$$;

create or replace function public.admin_list_onboarding_options(p_caller text)
returns setof onboarding_category_display
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from onboarding_category_display order by option_type, sort_order;
end;
$$;

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
  p_default_class_level text default null
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
    default_class_level, updated_at
  )
  values (
    coalesce(p_id, gen_random_uuid()), p_option_type, p_option_key, p_category_keys,
    p_title, p_description, p_icon_name, p_color, p_sort_order, p_is_active,
    p_needs_board, p_needs_class, p_default_class_level, now()
  )
  on conflict (id) do update set
    option_type = excluded.option_type, option_key = excluded.option_key,
    category_keys = excluded.category_keys, title = excluded.title,
    description = excluded.description, icon_name = excluded.icon_name,
    color = excluded.color, sort_order = excluded.sort_order,
    is_active = excluded.is_active, needs_board = excluded.needs_board,
    needs_class = excluded.needs_class, default_class_level = excluded.default_class_level,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_delete_onboarding_option(p_caller text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  delete from onboarding_category_display where id = p_id;
end;
$$;

grant execute on function public.get_onboarding_options() to anon, authenticated;
grant execute on function public.admin_list_onboarding_options(text) to anon, authenticated;
grant execute on function public.admin_upsert_onboarding_option(text, uuid, text, text, text[], text, text, text, text, integer, boolean, boolean, boolean, text) to anon, authenticated;
grant execute on function public.admin_delete_onboarding_option(text, uuid) to anon, authenticated;

-- Seed with the exact 23 options already hardcoded in OnboardingPage.jsx
-- (12 exam + 5 board + 6 class) — same key/title/description/icon/color/
-- order, so nothing visually changes for students on this deploy.
insert into onboarding_category_display
  (option_type, option_key, category_keys, title, description, icon_name, color, sort_order, needs_board, needs_class, default_class_level)
values
  ('exam', 'NEET',         array['NEET'],                    'NEET UG',        'Medical entrance — PCB',        'Dna',          'rose',    0,  true,  true,  null),
  ('exam', 'JEE_MAIN',     array['JEE Main'],                 'JEE Main',       'Engineering entrance — PCM',    'Atom',         'blue',    1,  true,  true,  null),
  ('exam', 'JEE_ADVANCED', array['JEE Advanced'],             'JEE Advanced',   'IIT entrance — advanced PCM',   'FlaskConical', 'violet',  2,  true,  true,  null),
  ('exam', 'BOTH',         array['NEET', 'JEE Main'],         'NEET + JEE',     'Double preparation',            'Rocket',       'amber',   3,  true,  true,  null),
  ('exam', 'CLASS_10',     array['Class 10'],                 'Class 10 Boards','CBSE / ICSE / State Board',     'BookOpen',     'sky',     4,  true,  true,  '10'),
  ('exam', 'CLASS_12',     array['Class 12'],                 'Class 12 Boards','CBSE / ICSE / State Board',     'GraduationCap','emerald', 5,  true,  true,  '12'),
  ('exam', 'CLASS_8_9',    array['Class 8', 'Class 9'],       'Class 8-9',      'Foundation level',              'BookMarked',   'teal',    6,  true,  true,  '9'),
  ('exam', 'CLASS_11',     array['Class 11'],                 'Class 11',       'Junior college / Senior school','Sprout',       'green',   7,  true,  true,  '11'),
  ('exam', 'UPSC',         array['UPSC'],                     'UPSC CSE',       'Civil Services Exam',           'Landmark',     'indigo',  8,  false, false, null),
  ('exam', 'SSC',          array['SSC CGL'],                  'SSC CGL / CHSL', 'Staff Selection Commission',    'ClipboardList','slate',   9,  false, false, null),
  ('exam', 'CUET',         array['CUET'],                     'CUET',           'Central University Entrance',   'School',       'purple', 10,  false, false, null),
  ('exam', 'OLYMPIAD',     array['Olympiad'],                 'Olympiad',       'Science / Math Olympiads',      'Trophy',       'amber',  11,  false, false, null),

  ('board', 'CBSE',         array['CBSE'],        'CBSE',              'Central Board of Secondary Education', 'BookOpen',      'blue',    0, false, false, null),
  ('board', 'ICSE',         array['ICSE'],        'ICSE / ISC',        'Council for Indian School Certificate','BookOpenCheck', 'emerald', 1, false, false, null),
  ('board', 'KERALA_STATE', array['Kerala State'],'Kerala State',      'SCERT Kerala',                         'TreePalm',      'teal',    2, false, false, null),
  ('board', 'OTHER_STATE',  array['State Board'], 'Other State Board', 'Maharashtra, Tamil Nadu, etc.',        'Building2',     'slate',   3, false, false, null),
  ('board', 'NA',           array[]::text[],      'Not applicable',    'Competitive exam only',                'MinusCircle',   'slate',   4, false, false, null),

  ('class', '8',        array['Class 8'],  'Class 8',            '',                                  'BookOpen',      'sky',     0, false, false, null),
  ('class', '9',        array['Class 9'],  'Class 9',            '',                                  'BookOpen',      'sky',     1, false, false, null),
  ('class', '10',       array['Class 10'], 'Class 10',           '',                                  'BookOpen',      'blue',    2, false, false, null),
  ('class', '11',       array['Class 11'], 'Class 11',           '',                                  'Sprout',        'green',   3, false, false, null),
  ('class', '12',       array['Class 12'], 'Class 12',           '',                                  'GraduationCap', 'emerald', 4, false, false, null),
  ('class', 'REPEATER', array[]::text[],   'Repeater / Dropper', 'Gap year / second attempt',        'RotateCcw',     'amber',   5, false, false, null)
on conflict (option_type, option_key) do nothing;
