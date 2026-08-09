-- Admin-published tests were invisible to every student.
--
-- `can_student_view_test` requires an active `test_assignments` row targeting
-- the student before an admin-created test is visible. The assignment table
-- has 0 rows, and no frontend code calls `admin_upsert_test_assignment` — the
-- RPC surface was built (20260807000000) but the UI never was. Net effect:
-- every admin-published test, including every paper generated in Admin >
-- Publish > Paper Gen, was hidden from all students with no way to reveal it.
-- Confirmed live: get_published_tests_for_student() returned 0 rows while
-- admin_list_published_tests() returned 5 for the same table.
--
-- Fix: treat assignment as an OPTIONAL NARROWING rather than a precondition.
-- A test with no active assignments is visible to everyone (the behaviour the
-- Exam Center has always assumed); once an admin adds one or more assignments
-- to a test, only the targeted students see it. That keeps the targeting
-- feature intact for when its UI is built, without leaving the default state
-- broken.

create or replace function public.can_student_view_test(p_test_id uuid, p_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.published_tests pt
    where pt.id = p_test_id
      and pt.is_published = true
      and (
        -- A student's own generated paper is always theirs to see.
        (pt.created_by = 'student' and pt.user_id = p_uid)
        or (
          pt.created_by <> 'student'
          and (
            -- No active assignment on this test -> open to everyone.
            not exists (
              select 1 from public.test_assignments ta
              where ta.test_id = pt.id
                and ta.is_active
                and (ta.expires_at is null or ta.expires_at > now())
            )
            -- Otherwise the student must match one of them.
            or exists (
              select 1
              from public.test_assignments ta
              join public.users u on u.firebase_uid = p_uid
              where ta.test_id = pt.id
                and ta.is_active
                and (ta.expires_at is null or ta.expires_at > now())
                and (
                  ta.assigned_to_user_uid = p_uid
                  or (ta.target_exam        is not null and ta.target_exam        = u.target_exam)
                  or (ta.target_syllabus    is not null and ta.target_syllabus    = u.syllabus)
                  or (ta.target_class_level is not null and ta.target_class_level = u.class_level)
                )
            )
          )
        )
      )
  );
$$;

grant execute on function public.can_student_view_test(uuid, text) to anon, authenticated;
