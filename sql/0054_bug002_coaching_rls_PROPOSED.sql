-- ═══════════════════════════════════════════════════════════════════
-- BUG-002 — Coaching RLS wide open. APPLIED 2026-08-06 (Part A3 of the
-- RLS-lockdown batch) — see supabase/migrations/20260806122830_a3_coaching_
-- rls_apply.sql for the migration actually run (same design as below, plus
-- 3 additional admin_* assignment RPCs for AdminCoaching.jsx). Kept here
-- for the original design rationale and the test plan at the bottom.
-- ═══════════════════════════════════════════════════════════════════
--
-- CURRENT STATE (confirmed live, 2026-08-06):
--   coaching_centres        — policy coaching_centres_open:  USING(true), WITH CHECK(true), role: PUBLIC
--   coaching_students       — policy coaching_students_open: USING(true), WITH CHECK(true), role: PUBLIC
--   coaching_assignments    — policy coaching_assignments_open: USING(true), WITH CHECK(true), role: PUBLIC
--   centre_published_tests  — policy cpt_all: USING(true), WITH CHECK(true), role: authenticated
--                              (+ cpt_select: is_published=true, anon+authenticated — also unscoped by centre)
--   centre_student_results  — policy csr_insert: WITH CHECK(true), role: anon+authenticated
--                              policy csr_select: USING(true), role: anon+authenticated
--
-- All five: any caller with the public anon key — no login, no Firebase
-- token, nothing — can read and write every coaching centre's students,
-- assignments, published tests (with answer keys), and result rows.
-- Confirmed reachable directly via REST with only the anon key, bypassing
-- every UI guard (CoachingPortalGuard, admin login) entirely.
--
-- WHY THIS CAN'T BE FIXED WITH "BETTER" auth.uid()-BASED RLS:
--   centre_student_results and centre_published_tests already carry
--   auth.uid()-scoped policies (centre_results_select_self,
--   centre_results_insert_self, centre_tests_select_student) sitting
--   ALONGSIDE the wide-open ones — and those are dead code, not a partial
--   fix. This app authenticates via Firebase, not Supabase Auth; every
--   request hits PostgREST as the bare `anon` role with an unsigned
--   session, so auth.uid() has no `sub` claim to read and is NULL on
--   every real request (confirmed live: GET /auth/v1/user with the
--   anon key returns "invalid claim: missing sub claim"). Anyone who
--   deleted just the *_open policies here and left the auth.uid() ones
--   would silently lock EVERYONE out, including legitimate users —
--   that failure mode is exactly why the open policies likely got added
--   in the first place (matches the architectural gap this app's own
--   2026-07-15 audit already flagged: "Firebase Auth and Supabase
--   aren't integrated, so every RPC hand-rolls its own authorization
--   check instead of the database enforcing it structurally").
--
-- APPROACH: same pattern already proven correct elsewhere in this repo
-- (admin_*, coaching_admin_* — sql/0053) — lock these 5 tables down to
-- deny-all for anon/authenticated, and move every read/write through a
-- SECURITY DEFINER RPC that takes an explicit p_uid/p_caller and checks
-- it against `admins` (platform admin), `coaching_admins` (centre-scoped
-- admin), or the row's own firebase_uid (student), inside the function
-- body — the check Postgres can't do for us via RLS given this app's
-- auth model, so the function has to do it instead.
--
-- CORRECT SCOPE PER TABLE:
--   coaching_centres        — platform admin: full CRUD. Coaching admin: read own centre only. Student: no direct access.
--   coaching_students       — platform admin: full CRUD. Coaching admin: CRUD own centre's students. Student: read own row only.
--   coaching_assignments    — platform admin: full CRUD. Coaching admin: CRUD own centre's assignments. Student: read own centre's rows only.
--   centre_published_tests  — platform admin: full CRUD. Coaching admin: CRUD own centre's tests. Student: read own centre's is_active rows only (NOT all published_tests platform-wide — the current cpt_select gap).
--   centre_student_results  — platform admin: full CRUD (read-only in practice). Coaching admin: read own centre's results. Student: insert/read own results only.
--
-- SEPARATE FINDING (out of scope for BUG-002, noting for the record):
-- AdminStudentLookup.jsx:36 queries `coaching_students.eq('student_uid', uid)`
-- and selects `coaching_centres(centre_name, centre_brand_color)` — neither
-- column exists on the live schema (real columns: firebase_uid, name,
-- brand_color). That query 400s and is silently swallowed, so the coaching
-- badge on that screen has likely never rendered. Same shape as other
-- wrong-field-name bugs already fixed elsewhere in this codebase
-- (CoachingTestBuilder's created_by, per docs/CHANGELOG.md 2026-07-15
-- session 3) — worth a 5-minute follow-up, unrelated to this RLS fix.

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

-- No replacement policies are added — RLS stays enabled with zero
-- permissive policies, which denies ALL direct access (including to
-- service_role-less anon/authenticated). Every legitimate path below
-- goes through a SECURITY DEFINER RPC instead.

-- ── 2. Shared helper — centre a coaching admin is authorized for ────
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

-- ── 3. coaching_centres ──────────────────────────────────────────────
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

-- Coaching admin's own centre (read-only) — replaces any client-side
-- assumption that a logged-in coaching admin can just SELECT the table.
create or replace function public.coaching_get_own_centre(p_caller text)
returns coaching_centres
language sql security definer set search_path = public as $$
  select c.* from coaching_centres c
  where c.id = public._coaching_admin_centre(p_caller);
$$;

-- Lightweight picker for AdminStudyNotes.jsx (id, name, city of active centres)
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

-- ── 4. coaching_students ─────────────────────────────────────────────
create or replace function public.admin_list_centre_students(p_caller text, p_centre_id uuid)
returns setof coaching_students
language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then raise exception 'Access denied'; end if;
  return query select * from coaching_students where centre_id = p_centre_id order by created_at desc;
end; $$;

-- Same operation, coaching-admin-scoped (own centre only, no p_centre_id
-- param needed — derived from the caller so they can't pass another
-- centre's id).
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

-- Student's own centre lookup (replaces the direct .from('coaching_students')
-- call in ExamCenterPage.jsx / CoachingPortalGuard-style screens).
create or replace function public.student_get_own_centre(p_uid text)
returns table(centre_id uuid, batch text, centre_name text, brand_color text)
language sql security definer set search_path = public as $$
  select cs.centre_id, cs.batch, cc.name, cc.brand_color
  from coaching_students cs
  join coaching_centres cc on cc.id = cs.centre_id
  where cs.firebase_uid = p_uid
  limit 1;
$$;

-- ── 5. coaching_assignments ──────────────────────────────────────────
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
    where id = p_id and centre_id = v_centre  -- can't touch another centre's row even with a guessed id
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

-- Student read of their own centre's assignments
create or replace function public.student_list_centre_assignments(p_uid text)
returns setof coaching_assignments
language sql security definer set search_path = public as $$
  select ca.* from coaching_assignments ca
  join coaching_students cs on cs.centre_id = ca.centre_id
  where cs.firebase_uid = p_uid
  order by ca.due_date asc nulls last;
$$;

-- ── 6. centre_published_tests ────────────────────────────────────────
-- Replaces CoachingTestBuilder.jsx's direct .from('centre_published_tests')
-- calls — every operation is now centre-derived from the caller, not a
-- centre_id the client sends (which was previously trusted blindly).
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

-- Student read — replaces ExamCenterPage.jsx's two-step client-side
-- lookup (coaching_students → centre_id, then centre_published_tests).
-- This is also the fix for the actual exposure: previously any anon
-- caller could read ANY centre's tests via cpt_select (is_published=true,
-- no centre_id restriction at all); now it's hard-scoped to the caller's
-- own enrolled centre.
create or replace function public.student_list_centre_tests(p_uid text)
returns setof centre_published_tests
language sql security definer set search_path = public as $$
  select cpt.* from centre_published_tests cpt
  join coaching_students cs on cs.centre_id = cpt.centre_id
  where cs.firebase_uid = p_uid and cpt.is_active = true
  order by cpt.created_at desc
  limit 20;
$$;

-- ── 7. centre_student_results ────────────────────────────────────────
-- Currently has zero live consumers in the app (grep confirms no
-- frontend file reads/writes this table) — scoped forward-looking so
-- whatever wires it up next inherits a correct default instead of the
-- current wide-open one.
create or replace function public.student_submit_centre_result(p_uid text, p_test_id uuid, p_centre_id uuid, p_score int, p_max_score int, p_time_taken_secs int, p_answers jsonb)
returns centre_student_results
language plpgsql security definer set search_path = public as $$
declare v_row centre_student_results;
begin
  -- caller must actually be enrolled in the centre they're submitting a result for
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

-- ── 8. Grant execute to anon (SECURITY DEFINER functions do their own
--      authorization inside the body — RLS on the underlying tables is
--      deliberately zero-policy/deny-all now) ────────────────────────
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
grant execute on function public.coaching_list_own_tests(text) to anon;
grant execute on function public.coaching_upsert_test(text, uuid, jsonb) to anon;
grant execute on function public.coaching_delete_test(text, uuid) to anon;
grant execute on function public.student_list_centre_tests(text) to anon;
grant execute on function public.student_submit_centre_result(text, uuid, uuid, int, int, int, jsonb) to anon;
grant execute on function public.student_list_own_results(text) to anon;
grant execute on function public.coaching_list_centre_results(text) to anon;

-- ═══════════════════════════════════════════════════════════════════
-- FRONTEND CALL-SITE CHANGES REQUIRED (this migration alone breaks all
-- 6 screens — they must switch to the RPCs above in the same deploy)
-- ═══════════════════════════════════════════════════════════════════
--
-- AdminCoaching.jsx:
--   .from('coaching_centres').insert/update(...)   → admin_upsert_coaching_centre(p_caller, p_id, p_fields)
--   .from('coaching_centres').select('*')           → admin_list_coaching_centres(p_caller)
--   .from('coaching_students').insert(...)          → admin_add_coaching_student(p_caller, centre_id, p_fields)
--   .from('coaching_students').select(...)          → admin_list_centre_students(p_caller, centre_id)
--   .from('coaching_students').delete(...)          → admin_delete_coaching_student(p_caller, id)
--   .from('coaching_assignments').insert(...)       → coaching_upsert_assignment(p_caller, null, p_fields)
--     (AdminCoaching acts on behalf of a centre it picked — either grant
--      it a platform-admin variant with an explicit p_centre_id, or have
--      it call as if it were that centre's coaching_admins row; decide
--      during implementation, not blocking for this review pass)
--   .from('coaching_assignments').select(...)       → admin equivalent of coaching_list_own_assignments (add p_centre_id variant)
--   .from('coaching_assignments').delete(...)       → admin equivalent of coaching_delete_assignment
--
-- AdminStudentLookup.jsx:
--   .from('coaching_students').select(...).eq('student_uid', uid)
--     → fix the column-name bug AND switch to student_get_own_centre(uid)
--       in the same change (both touch the same line)
--
-- AdminOverview.jsx:
--   .from('coaching_centres').select('id', {count:'exact'})  → admin_get_coaching_centre_count(p_caller)
--
-- AdminStudyNotes.jsx:
--   .from('coaching_centres').select('id,name,city').eq('status','active')  → admin_list_active_centres_lite(p_caller)
--
-- CoachingTestBuilder.jsx:
--   .from('centre_published_tests').select(...).eq('centre_id', centreId)  → coaching_list_own_tests(p_caller)
--   .from('centre_published_tests').insert(...)                            → coaching_upsert_test(p_caller, null, p_fields)
--   .from('centre_published_tests').update({is_active})                    → coaching_upsert_test(p_caller, id, {is_active})
--   .from('centre_published_tests').delete(...)                            → coaching_delete_test(p_caller, id)
--   (centreId currently comes from CoachingPortalGuard's client-side
--    state and is trusted as-is; after this change centre_id is always
--    derived server-side from p_caller via _coaching_admin_centre, so a
--    tampered/stale centreId in the client can no longer matter)
--
-- ExamCenterPage.jsx:
--   .from('coaching_students').select('centre_id')  → student_get_own_centre(uid) (if batch/centre name needed too)
--   .from('centre_published_tests').select(...)      → student_list_centre_tests(uid)  (single RPC replaces the two-step client-side chain)
--
-- ═══════════════════════════════════════════════════════════════════
-- TEST PLAN — re-verify each of the 6 consumer screens before ship
-- ═══════════════════════════════════════════════════════════════════
--
-- 0. Exposure regression test (run FIRST, proves the hole is closed):
--    curl the anon REST endpoint directly against all 5 tables
--    (GET/POST/PATCH/DELETE with only the anon key, no p_caller) and
--    confirm every one now 401/permission-denied/empty — this is
--    exactly how BUG-002 was originally confirmed live, so closing it
--    means this same probe must now fail.
--
-- 1. AdminCoaching.jsx (platform admin):
--    - Create a centre, edit it, confirm it appears/updates in the list.
--    - Add a student to a centre, delete a student — confirm centre-scoped list updates.
--    - Create/delete an assignment for a centre.
--    - Log in as a non-admin (or omit p_caller) and confirm every one of
--      the above is rejected with "Access denied", not a silent no-op.
--
-- 2. AdminStudentLookup.jsx (platform admin):
--    - Look up a student who IS enrolled in a coaching centre — confirm
--      the coaching badge now actually renders (this also verifies the
--      separate column-name bug got fixed in the same pass).
--    - Look up a student who is NOT enrolled — confirm no badge, no error.
--
-- 3. AdminOverview.jsx (platform admin):
--    - Confirm the coaching centre count stat matches admin_list_coaching_centres' row count.
--
-- 4. AdminStudyNotes.jsx (platform admin):
--    - Open the centre picker when tagging a note — confirm only
--      status='active' centres appear, id/name/city populate correctly.
--
-- 5. CoachingTestBuilder.jsx (coaching admin, logged into centre A):
--    - Create a test, publish it, toggle active/inactive, delete it —
--      confirm all operations only ever affect centre A's rows.
--    - Attempt (via direct RPC call, bypassing the UI) to update/delete a
--      test belonging to centre B using centre A's p_caller — confirm
--      the centre_id = v_centre guard blocks it (0 rows affected, not an error).
--
-- 6. ExamCenterPage.jsx (student enrolled in centre A):
--    - Confirm they see centre A's active published tests only.
--    - Create a second test under centre B directly (as platform admin)
--      and confirm the centre-A student does NOT see it.
--    - Confirm a student with no coaching enrollment sees the coaching
--      section simply absent (not an error, not every centre's tests).
-- ═══════════════════════════════════════════════════════════════════
