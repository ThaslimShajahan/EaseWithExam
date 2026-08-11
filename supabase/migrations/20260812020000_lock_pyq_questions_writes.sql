-- Close the anon-writable question bank.
--
-- pyq_questions had RLS ENABLED with:
--
--   pyq_open           cmd=ALL  roles={public}         qual=true  with_check=true
--   pyq_insert_update  cmd=ALL  roles={authenticated}  qual=true  with_check=true
--   pyq_select         cmd=SELECT roles={anon,authenticated}
--
-- A policy of `true` for `public` is no protection at all. Anyone holding the
-- anon key -- which ships in the client bundle and is public by design -- could
-- UPDATE or DELETE the entire corpus: ~1,800 rows, six years of NEET papers,
-- the Class X maths sets, and the chapter_pattern_stats blueprint derived from
-- them. RLS being *enabled* is what made this easy to miss; any audit checking
-- only relrowsecurity would have called it protected.
--
-- Same shape as 20260811160000_lock_open_student_tables.sql, but on the shared
-- content asset rather than per-user rows.
--
-- READ ACCESS IS DELIBERATELY UNCHANGED. The question bank is meant to be
-- readable -- students browse PYQ sets, the generator reads it for blueprints,
-- Content Map counts it. `pyq_select` stays exactly as it is. Only the write
-- path closes.
--
-- WRITERS, ENUMERATED BEFORE CLOSING ANYTHING. Missing one is how the P0
-- lockdown on 2026-08-11 locked every admin out of production, so all nine call
-- sites were found first and each maps to exactly one RPC below:
--
--   INSERT   AdminContentIntake savePYQRows :112   -> admin_insert_pyq_rows
--            AdminContentIntake KB_NOTE     :159   -> admin_insert_pyq_rows
--            questionGen extractPYQFromKB   :1452  -> admin_insert_pyq_rows
--   UPDATE   AdminContentReview setStatus   :35    -> admin_update_pyq_status
--            AdminContentIntake image_url   :223   -> admin_set_pyq_image
--   DELETE   AdminContentLibrary deletePYQ  :60    -> admin_delete_pyq_rows
--            AdminContentMap bulk delete    :234   -> admin_delete_pyq_rows
--            supabase clearPYQQuestions     :736   -> admin_clear_pyq_questions
--            supabase adminClearAllData     :480   -> admin_clear_pyq_questions
--
-- Every RPC carries assert_verified_admin(p_caller), the P0.5 pattern: it
-- raises when verified_uid() is null (blocking anon) and when it does not match
-- p_caller (blocking a signed-in student who passes a known admin UID). A grant
-- cannot do this job here -- every request arrives as the `anon` Postgres role
-- because Firebase ID tokens carry no `role` claim.

------------------------------------------------------------------------------
-- INSERT
------------------------------------------------------------------------------
create or replace function public.admin_insert_pyq_rows(p_caller text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_out jsonb;
begin
  perform assert_verified_admin(p_caller);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  with ins as (
    insert into public.pyq_questions (
      exam_type, subject, chapter, question_text, options, correct_answer,
      explanation, year, question_type, difficulty, marks, section,
      has_diagram, source, status, image_url
    )
    select
      r->>'exam_type',
      r->>'subject',
      r->>'chapter',
      r->>'question_text',
      case when jsonb_typeof(r->'options') = 'array' then r->'options' else null end,
      r->>'correct_answer',
      r->>'explanation',
      nullif(r->>'year', '')::int,
      coalesce(nullif(r->>'question_type', ''), 'MCQ'),
      coalesce(nullif(r->>'difficulty', ''), 'Medium'),
      -- Stays ::int on purpose. normaliseMarks() already coerces client-side;
      -- if anything ever slips past it the insert should fail loudly here
      -- rather than silently rounding, which is what the assignment cast would
      -- do and what made the original 0.5 bug confusing to diagnose.
      nullif(r->>'marks', '')::int,
      r->>'section',
      coalesce((r->>'has_diagram')::boolean, false),
      r->>'source',
      coalesce(nullif(r->>'status', ''), 'published'),
      r->>'image_url'
    from jsonb_array_elements(p_rows) r
    returning id, question_text, has_diagram, section, marks, chapter
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_out from ins;

  return v_out;
end;
$function$;

------------------------------------------------------------------------------
-- UPDATE status (Content Review approve/reject, and the archive script)
------------------------------------------------------------------------------
create or replace function public.admin_update_pyq_status(p_caller text, p_ids uuid[], p_status text)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n int;
begin
  perform assert_verified_admin(p_caller);

  -- Mirrors pyq_questions_status_check. Checked here too so a bad value fails
  -- with a readable message instead of a raw constraint violation.
  if p_status not in ('in_review', 'published', 'archived') then
    raise exception 'invalid status %, expected in_review | published | archived', p_status
      using errcode = '22023';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  update public.pyq_questions set status = p_status where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

------------------------------------------------------------------------------
-- UPDATE image_url (diagram attached to one question)
------------------------------------------------------------------------------
create or replace function public.admin_set_pyq_image(p_caller text, p_id uuid, p_image_url text)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n int;
begin
  perform assert_verified_admin(p_caller);
  update public.pyq_questions set image_url = p_image_url where id = p_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

------------------------------------------------------------------------------
-- DELETE by id (Content Library single, Content Map bulk)
------------------------------------------------------------------------------
create or replace function public.admin_delete_pyq_rows(p_caller text, p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n int;
begin
  perform assert_verified_admin(p_caller);

  -- An empty array must delete NOTHING. `id = any('{}')` is already false, but
  -- being explicit matters on a function whose whole job is deletion.
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  delete from public.pyq_questions where id = any(p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

------------------------------------------------------------------------------
-- DELETE everything (Clear PYQ bank, and the Clear All Data admin tool)
------------------------------------------------------------------------------
create or replace function public.admin_clear_pyq_questions(p_caller text)
returns int
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_n int;
begin
  perform assert_verified_admin(p_caller);
  delete from public.pyq_questions;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

------------------------------------------------------------------------------
-- Close the table. READ STAYS OPEN.
------------------------------------------------------------------------------
-- Dropping the permissive ALL policies leaves RLS enabled with no
-- INSERT/UPDATE/DELETE policy at all, which is deny-by-default -- the same
-- enabled-with-no-write-policy shape used for `subscriptions` in
-- 20260811160000. The SECURITY DEFINER functions above bypass RLS, so every
-- legitimate writer keeps working through its RPC.
drop policy if exists pyq_open          on public.pyq_questions;
drop policy if exists pyq_insert_update on public.pyq_questions;

-- pyq_select (SELECT, {anon,authenticated}) is intentionally NOT dropped.
