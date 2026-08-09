-- Secure published_tests and add an admin-driven test assignment table.
--
-- This migration does not depend on Supabase auth claims because this app
-- uses Firebase UIDs in the client and anon-key access in Postgres. All
-- published_tests operations must therefore be routed through SECURITY
-- DEFINER RPCs rather than auth.uid()-based RLS.

-- 1) Add missing user_id support to published_tests so student-owned tests
--    can be distinguished in the DB and enforced at the row level.
alter table if exists public.published_tests
  add column if not exists user_id text;

-- 2) Add a first-class assignment table for admin-driven test distribution.
create table if not exists public.test_assignments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text not null,
  test_id uuid not null references public.published_tests(id) on delete cascade,
  assigned_to_user_uid text references public.users(firebase_uid),
  target_exam text,
  target_syllabus text,
  target_class_level text,
  is_active boolean not null default true,
  expires_at timestamptz,
  note text,
  constraint test_assignments_target_check check (
    assigned_to_user_uid is not null
    or target_exam is not null
    or target_syllabus is not null
    or target_class_level is not null
  )
);
create index if not exists idx_test_assignments_test_id on public.test_assignments(test_id);
create index if not exists idx_test_assignments_user_uid on public.test_assignments(assigned_to_user_uid);
create index if not exists idx_test_assignments_profile on public.test_assignments(target_exam, target_syllabus, target_class_level);

-- Lock down direct table access so every action goes through the safe RPC surface.
alter table if exists public.published_tests enable row level security;
alter table if exists public.test_assignments enable row level security;

drop policy if exists published_tests_open on public.published_tests;
drop policy if exists pt_select on public.published_tests;
drop policy if exists pt_insert_update_delete on public.published_tests;
drop policy if exists test_assignments_open on public.test_assignments;

-- 4) Create audit-safe published_tests RPCs.
create or replace function public.publish_test_by_student(
  p_uid text,
  p_title text,
  p_subject text,
  p_exam_type text,
  p_difficulty text,
  p_questions jsonb,
  p_duration_minutes int,
  p_blueprint_match_pct numeric default null
)
returns public.published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.published_tests;
begin
  if p_uid is null or p_uid = '' then
    raise exception 'student publishing requires a caller UID';
  end if;

  insert into public.published_tests (
    title, subject, exam_type, difficulty, questions,
    duration_minutes, is_published, question_count,
    blueprint_match_pct, created_by, user_id
  ) values (
    p_title, p_subject, p_exam_type, p_difficulty, p_questions,
    p_duration_minutes, true, coalesce(jsonb_array_length(p_questions), 0),
    p_blueprint_match_pct, 'student', p_uid
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.admin_publish_test(
  p_caller text,
  p_fields jsonb
)
returns public.published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row public.published_tests;
  v_created_by text;
  v_user_id text;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;

  v_created_by := coalesce(p_fields->>'created_by', 'admin');
  v_user_id := p_fields->>'user_id';
  if v_created_by = 'student' and (v_user_id is null or v_user_id = '') then
    raise exception 'student-owned published tests must include user_id';
  end if;

  insert into public.published_tests (
    title, subject, exam_type, difficulty, questions,
    duration_minutes, is_published, question_count,
    blueprint_match_pct, created_by, user_id
  ) values (
    p_fields->>'title', p_fields->>'subject', p_fields->>'exam_type', p_fields->>'difficulty',
    coalesce(p_fields->'questions', '[]'::jsonb),
    (p_fields->>'duration_minutes')::int, true,
    coalesce(jsonb_array_length(coalesce(p_fields->'questions', '[]'::jsonb)), 0),
    (p_fields->>'blueprint_match_pct')::numeric, v_created_by, v_user_id
  ) returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.get_published_tests_for_student(
  p_uid text
)
returns setof public.published_tests
language sql
security definer
set search_path = public
as $$
  select * from public.published_tests
  where is_published = true
    and (
      created_by != 'student'
      or user_id = p_uid
    )
  order by created_at desc;
$$;

create or replace function public.get_published_test_for_student(
  p_id uuid,
  p_uid text
)
returns public.published_tests
language sql
security definer
set search_path = public
as $$
  select * from public.published_tests
  where id = p_id
    and is_published = true
    and (
      created_by != 'student'
      or user_id = p_uid
    );
$$;

create or replace function public.admin_list_published_tests(
  p_caller text
)
returns setof public.published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  return query select * from public.published_tests order by created_at desc;
end;
$$;

create or replace function public.admin_get_published_test(
  p_caller text,
  p_id uuid
)
returns public.published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row public.published_tests;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  select * into v_row from public.published_tests where id = p_id;
  return v_row;
end;
$$;

create or replace function public.admin_search_published_tests(
  p_caller text,
  p_query text,
  p_limit int default 5
)
returns setof public.published_tests
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_term text := '%' || coalesce(p_query, '') || '%';
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  return query
    select * from public.published_tests
    where title ilike v_term
       or subject ilike v_term
       or exam_type ilike v_term
    order by created_at desc
    limit p_limit;
end;
$$;

create or replace function public.admin_delete_published_test(
  p_caller text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  delete from public.published_tests where id = p_id;
end;
$$;

-- 5) Assignments RPC surface.
create or replace function public.admin_list_test_assignments(
  p_caller text,
  p_test_id uuid default null
)
returns setof public.test_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  if p_test_id is null then
    return query select * from public.test_assignments order by created_at desc;
  end if;
  return query select * from public.test_assignments where test_id = p_test_id order by created_at desc;
end;
$$;

create or replace function public.admin_upsert_test_assignment(
  p_caller text,
  p_id uuid default null,
  p_fields jsonb
)
returns public.test_assignments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_row public.test_assignments;
  v_test_id uuid;
  v_assigned_to_user_uid text := null;
  v_target_exam text := null;
  v_target_syllabus text := null;
  v_target_class_level text := null;
  v_note text := null;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;

  v_test_id := (p_fields->>'test_id')::uuid;
  if v_test_id is null then
    raise exception 'test_id is required';
  end if;
  v_assigned_to_user_uid := nullif(p_fields->>'assigned_to_user_uid', '');
  v_target_exam := nullif(p_fields->>'target_exam', '');
  v_target_syllabus := nullif(p_fields->>'target_syllabus', '');
  v_target_class_level := nullif(p_fields->>'target_class_level', '');
  v_note := nullif(p_fields->>'note', '');

  if p_id is null then
    insert into public.test_assignments (
      created_by, test_id, assigned_to_user_uid,
      target_exam, target_syllabus, target_class_level,
      is_active, expires_at, note
    ) values (
      p_caller, v_test_id, v_assigned_to_user_uid,
      v_target_exam, v_target_syllabus, v_target_class_level,
      coalesce((p_fields->>'is_active')::boolean, true),
      nullif(p_fields->>'expires_at', '')::timestamptz,
      v_note
    ) returning * into v_row;
  else
    update public.test_assignments set
      assigned_to_user_uid = coalesce(v_assigned_to_user_uid, assigned_to_user_uid),
      target_exam = coalesce(v_target_exam, target_exam),
      target_syllabus = coalesce(v_target_syllabus, target_syllabus),
      target_class_level = coalesce(v_target_class_level, target_class_level),
      is_active = coalesce((p_fields->>'is_active')::boolean, is_active),
      expires_at = coalesce(nullif(p_fields->>'expires_at', '')::timestamptz, expires_at),
      note = coalesce(v_note, note),
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

create or replace function public.admin_delete_test_assignment(
  p_caller text,
  p_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role from public.admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;
  delete from public.test_assignments where id = p_id;
end;
$$;

create or replace function public.student_list_assigned_tests(
  p_uid text
)
returns setof public.published_tests
language sql
security definer
set search_path = public
as $$
  select distinct pt.* from public.published_tests pt
  join public.test_assignments ta on ta.test_id = pt.id and ta.is_active
  join public.users u on u.firebase_uid = p_uid
  where
    ta.assigned_to_user_uid = p_uid
    or (ta.target_exam is not null and ta.target_exam = u.target_exam)
    or (ta.target_syllabus is not null and ta.target_syllabus = u.syllabus)
    or (ta.target_class_level is not null and ta.target_class_level = u.class_level)
  order by pt.created_at desc;
$$;

-- 6) Grants for the safe RPC surface.
grant execute on function public.publish_test_by_student(text, text, text, text, text, jsonb, int, numeric) to anon;
grant execute on function public.admin_publish_test(text, jsonb) to anon;
grant execute on function public.get_published_tests_for_student(text) to anon;
grant execute on function public.get_published_test_for_student(uuid, text) to anon;
grant execute on function public.admin_list_published_tests(text) to anon;
grant execute on function public.admin_get_published_test(text, uuid) to anon;
grant execute on function public.admin_search_published_tests(text, text, int) to anon;
grant execute on function public.admin_delete_published_test(text, uuid) to anon;
grant execute on function public.admin_list_test_assignments(text, uuid) to anon;
grant execute on function public.admin_upsert_test_assignment(text, uuid, jsonb) to anon;
grant execute on function public.admin_delete_test_assignment(text, uuid) to anon;
grant execute on function public.student_list_assigned_tests(text) to anon;
