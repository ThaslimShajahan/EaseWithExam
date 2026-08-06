-- PART A3: applying sql/0054_bug002_coaching_rls_PROPOSED.sql (re-verified
-- current, no changes needed to the drafted design) plus 3 additional RPCs
-- the plan flagged as an open decision: AdminCoaching.jsx is a PLATFORM
-- ADMIN screen managing assignments for ANY centre it picks, not just "its
-- own" — the coaching-admin-scoped coaching_upsert_assignment (centre
-- derived from _coaching_admin_centre(p_caller)) doesn't fit that caller.
-- Giving it its own admin_* variant with an explicit p_centre_id.

-- ── 1. Lock down direct table access — drop every wide-open policy ──
drop policy if exists coaching_centres_open        on public.coaching_centres;
drop policy if exists coaching_students_open       on public.coaching_students;
drop policy if exists coaching_assignments_open     on public.coaching_assignments;
drop policy if exists cpt_all                       on public.centre_published_tests;
drop policy if exists cpt_select                    on public.centre_published_tests;
drop policy if exists centre_tests_select_student   on public.centre_published_tests;
drop policy if exists csr_insert                    on public.centre_student_results;
drop policy if exists csr_select                    on public.centre_student_results;
drop policy if exists centre_results_select_self    on public.centre_student_results;
drop policy if exists centre_results_insert_self    on public.centre_student_results;

create or replace function public._coaching_admin_centre(p_caller text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select centre_id from coaching_admins
  where uid = p_caller and is_active = true
  limit 1;
$$;

create or replace function public.admin_list_coaching_centres(p_caller text)
returns setof coaching_centres
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from coaching_centres order by created_at desc;
end; $$;

create or replace function public.admin_upsert_coaching_centre(p_caller text, p_id uuid default null, p_fields jsonb default '{}'::jsonb)
returns coaching_centres
language plpgsql security definer set search_path = public as $$
declare v_role text; v_row coaching_centres;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  if p_id is null then
    insert into coaching_centres select * from jsonb_populate_record(null::coaching_centres, p_fields) returning * into v_row;
  else
    update coaching_centres set
      name = coalesce(p_fields->>'name', name),
      city = coalesce(p_fields->>'city', city),
      contact_email = coalesce(p_fields->>'contact_email', contact_email),
      contact_phone = coalesce(p_fields->>'contact_phone', contact_phone),
      plan = coalesce(p_fields->>'plan', plan),
      max_students = coalesce((p_fields->>'max_students')::int, max_students),
      status = coalesce(p_fields->>'status', status),
      notes = coalesce(p_fields->>'notes', notes),
      brand_color = coalesce(p_fields->>'brand_color', brand_color),
      website_url = coalesce(p_fields->>'website_url', website_url),
      phone = coalesce(p_fields->>'phone', phone),
      tagline = coalesce(p_fields->>'tagline', tagline),
      updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.coaching_get_own_centre(p_caller text)
returns coaching_centres
language sql security definer set search_path = public as $$
  select c.* from coaching_centres c
  where c.id = public._coaching_admin_centre(p_caller);
$$;

create or replace function public.admin_list_active_centres_lite(p_caller text)
returns table(id uuid, name text, city text)
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select c.id, c.name, c.city from coaching_centres c where c.status = 'active';
end; $$;

create or replace function public.admin_get_coaching_centre_count(p_caller text)
returns bigint
language plpgsql security definer set search_path = public as $$
declare v_role text; v_count bigint;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  select count(*) into v_count from coaching_centres;
  return v_count;
end; $$;

create or replace function public.admin_list_centre_students(p_caller text, p_centre_id uuid)
returns setof coaching_students
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from coaching_students where centre_id = p_centre_id order by created_at desc;
end; $$;

create or replace function public.coaching_list_own_students(p_caller text)
returns setof coaching_students
language sql security definer set search_path = public as $$
  select * from coaching_students
  where centre_id = public._coaching_admin_centre(p_caller)
  order by created_at desc;
$$;

create or replace function public.admin_add_coaching_student(p_caller text, p_centre_id uuid, p_fields jsonb)
returns coaching_students
language plpgsql security definer set search_path = public as $$
declare v_role text; v_row coaching_students;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  insert into coaching_students (centre_id, firebase_uid, name, email, target_exam, student_name, student_email, batch)
  values (p_centre_id, p_fields->>'firebase_uid', p_fields->>'name', p_fields->>'email',
          p_fields->>'target_exam', p_fields->>'student_name', p_fields->>'student_email', p_fields->>'batch')
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.admin_delete_coaching_student(p_caller text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  delete from coaching_students where id = p_id;
end; $$;

create or replace function public.student_get_own_centre(p_uid text)
returns table(centre_id uuid, batch text, centre_name text, brand_color text)
language sql security definer set search_path = public as $$
  select cs.centre_id, cs.batch, cc.name, cc.brand_color
  from coaching_students cs
  join coaching_centres cc on cc.id = cs.centre_id
  where cs.firebase_uid = p_uid
  limit 1;
$$;

create or replace function public.coaching_list_own_assignments(p_caller text)
returns setof coaching_assignments
language sql security definer set search_path = public as $$
  select * from coaching_assignments
  where centre_id = public._coaching_admin_centre(p_caller)
  order by created_at desc;
$$;

create or replace function public.coaching_upsert_assignment(p_caller text, p_id uuid default null, p_fields jsonb default '{}'::jsonb)
returns coaching_assignments
language plpgsql security definer set search_path = public as $$
declare v_centre uuid; v_row coaching_assignments;
begin
  v_centre := public._coaching_admin_centre(p_caller);
  if v_centre is null then raise exception 'Access denied'; end if;

  if p_id is null then
    insert into coaching_assignments (centre_id, title, exam_type, subject, due_date, questions, description)
    values (v_centre, p_fields->>'title', p_fields->>'exam_type', p_fields->>'subject',
            (p_fields->>'due_date')::date, p_fields->'questions', p_fields->>'description')
    returning * into v_row;
  else
    update coaching_assignments set
      title = coalesce(p_fields->>'title', title),
      exam_type = coalesce(p_fields->>'exam_type', exam_type),
      subject = coalesce(p_fields->>'subject', subject),
      due_date = coalesce((p_fields->>'due_date')::date, due_date),
      questions = coalesce(p_fields->'questions', questions),
      description = coalesce(p_fields->>'description', description),
      updated_at = now()
    where id = p_id and centre_id = v_centre
    returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.coaching_delete_assignment(p_caller text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_centre uuid;
begin
  v_centre := public._coaching_admin_centre(p_caller);
  if v_centre is null then raise exception 'Access denied'; end if;
  delete from coaching_assignments where id = p_id and centre_id = v_centre;
end; $$;

create or replace function public.student_list_centre_assignments(p_uid text)
returns setof coaching_assignments
language sql security definer set search_path = public as $$
  select ca.* from coaching_assignments ca
  join coaching_students cs on cs.centre_id = ca.centre_id
  where cs.firebase_uid = p_uid
  order by ca.due_date asc nulls last;
$$;

-- ── NEW: platform-admin variants for AdminCoaching.jsx, which manages
-- assignments for any centre it picks (not "its own" the way a
-- coaching_admins row would imply) ─────────────────────────────────
create or replace function public.admin_list_centre_assignments(p_caller text, p_centre_id uuid)
returns setof coaching_assignments
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from coaching_assignments where centre_id = p_centre_id order by created_at desc;
end; $$;

create or replace function public.admin_upsert_coaching_assignment(p_caller text, p_centre_id uuid, p_id uuid default null, p_fields jsonb default '{}'::jsonb)
returns coaching_assignments
language plpgsql security definer set search_path = public as $$
declare v_role text; v_row coaching_assignments;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;

  if p_id is null then
    insert into coaching_assignments (centre_id, title, exam_type, subject, due_date, questions, description)
    values (p_centre_id, p_fields->>'title', p_fields->>'exam_type', p_fields->>'subject',
            (p_fields->>'due_date')::date, coalesce(p_fields->'questions', '[]'::jsonb), p_fields->>'description')
    returning * into v_row;
  else
    update coaching_assignments set
      title = coalesce(p_fields->>'title', title),
      exam_type = coalesce(p_fields->>'exam_type', exam_type),
      subject = coalesce(p_fields->>'subject', subject),
      due_date = coalesce((p_fields->>'due_date')::date, due_date),
      questions = coalesce(p_fields->'questions', questions),
      description = coalesce(p_fields->>'description', description),
      updated_at = now()
    where id = p_id and centre_id = p_centre_id
    returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.admin_delete_coaching_assignment(p_caller text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  delete from coaching_assignments where id = p_id;
end; $$;

create or replace function public.coaching_list_own_tests(p_caller text)
returns setof centre_published_tests
language sql security definer set search_path = public as $$
  select * from centre_published_tests
  where centre_id = public._coaching_admin_centre(p_caller)
  order by created_at desc;
$$;

create or replace function public.coaching_upsert_test(p_caller text, p_id uuid default null, p_fields jsonb default '{}'::jsonb)
returns centre_published_tests
language plpgsql security definer set search_path = public as $$
declare v_centre uuid; v_row centre_published_tests;
begin
  v_centre := public._coaching_admin_centre(p_caller);
  if v_centre is null then raise exception 'Access denied'; end if;

  if p_id is null then
    insert into centre_published_tests
      (centre_id, title, subject, exam_type, difficulty, duration_minutes, total_marks, questions, created_by, is_active)
    values (v_centre, p_fields->>'title', p_fields->>'subject', p_fields->>'exam_type',
            p_fields->>'difficulty', (p_fields->>'duration_minutes')::int, (p_fields->>'total_marks')::int,
            p_fields->'questions', p_caller, true)
    returning * into v_row;
  else
    update centre_published_tests set
      title = coalesce(p_fields->>'title', title),
      subject = coalesce(p_fields->>'subject', subject),
      exam_type = coalesce(p_fields->>'exam_type', exam_type),
      difficulty = coalesce(p_fields->>'difficulty', difficulty),
      duration_minutes = coalesce((p_fields->>'duration_minutes')::int, duration_minutes),
      total_marks = coalesce((p_fields->>'total_marks')::int, total_marks),
      questions = coalesce(p_fields->'questions', questions),
      is_active = coalesce((p_fields->>'is_active')::boolean, is_active),
      updated_at = now()
    where id = p_id and centre_id = v_centre
    returning * into v_row;
  end if;
  return v_row;
end; $$;

create or replace function public.coaching_delete_test(p_caller text, p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_centre uuid;
begin
  v_centre := public._coaching_admin_centre(p_caller);
  if v_centre is null then raise exception 'Access denied'; end if;
  delete from centre_published_tests where id = p_id and centre_id = v_centre;
end; $$;

create or replace function public.student_list_centre_tests(p_uid text)
returns setof centre_published_tests
language sql security definer set search_path = public as $$
  select cpt.* from centre_published_tests cpt
  join coaching_students cs on cs.centre_id = cpt.centre_id
  where cs.firebase_uid = p_uid and cpt.is_active = true
  order by cpt.created_at desc
  limit 20;
$$;

create or replace function public.student_submit_centre_result(p_uid text, p_test_id uuid, p_centre_id uuid, p_score int, p_max_score int, p_time_taken_secs int, p_answers jsonb)
returns centre_student_results
language plpgsql security definer set search_path = public as $$
declare v_row centre_student_results;
begin
  if not exists (select 1 from coaching_students where firebase_uid = p_uid and centre_id = p_centre_id) then
    raise exception 'Access denied';
  end if;
  insert into centre_student_results (test_id, centre_id, student_uid, score, max_score, time_taken_secs, answers)
  values (p_test_id, p_centre_id, p_uid, p_score, p_max_score, p_time_taken_secs, p_answers)
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.student_list_own_results(p_uid text)
returns setof centre_student_results
language sql security definer set search_path = public as $$
  select * from centre_student_results where student_uid = p_uid order by submitted_at desc;
$$;

create or replace function public.coaching_list_centre_results(p_caller text)
returns setof centre_student_results
language sql security definer set search_path = public as $$
  select * from centre_student_results
  where centre_id = public._coaching_admin_centre(p_caller)
  order by submitted_at desc;
$$;

grant execute on function public._coaching_admin_centre(text) to anon;
grant execute on function public.admin_list_coaching_centres(text) to anon;
grant execute on function public.admin_upsert_coaching_centre(text, uuid, jsonb) to anon;
grant execute on function public.coaching_get_own_centre(text) to anon;
grant execute on function public.admin_list_active_centres_lite(text) to anon;
grant execute on function public.admin_get_coaching_centre_count(text) to anon;
grant execute on function public.admin_list_centre_students(text, uuid) to anon;
grant execute on function public.coaching_list_own_students(text) to anon;
grant execute on function public.admin_add_coaching_student(text, uuid, jsonb) to anon;
grant execute on function public.admin_delete_coaching_student(text, uuid) to anon;
grant execute on function public.student_get_own_centre(text) to anon;
grant execute on function public.coaching_list_own_assignments(text) to anon;
grant execute on function public.coaching_upsert_assignment(text, uuid, jsonb) to anon;
grant execute on function public.coaching_delete_assignment(text, uuid) to anon;
grant execute on function public.student_list_centre_assignments(text) to anon;
grant execute on function public.admin_list_centre_assignments(text, uuid) to anon;
grant execute on function public.admin_upsert_coaching_assignment(text, uuid, uuid, jsonb) to anon;
grant execute on function public.admin_delete_coaching_assignment(text, uuid) to anon;
grant execute on function public.coaching_list_own_tests(text) to anon;
grant execute on function public.coaching_upsert_test(text, uuid, jsonb) to anon;
grant execute on function public.coaching_delete_test(text, uuid) to anon;
grant execute on function public.student_list_centre_tests(text) to anon;
grant execute on function public.student_submit_centre_result(text, uuid, uuid, int, int, int, jsonb) to anon;
grant execute on function public.student_list_own_results(text) to anon;
grant execute on function public.coaching_list_centre_results(text) to anon;
