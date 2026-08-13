-- Phase 2 PYQ slice (docs/REBUILD_HANDOFF.md), bug found by the real
-- acceptance test, not by inspection.
--
-- savePYQRows() (AdminContentIntake.jsx) correctly resolves chapter_key and
-- includes it in each row object sent to admin_insert_pyq_rows — but that
-- RPC's INSERT lists its target columns explicitly, predating chapter_key
-- (20260814010000), and never read it. The JS-level resolution was entirely
-- correct; the value was silently dropped one layer down, at the RPC's own
-- column list. Caught live: a real fixture upload through the actual admin
-- UI showed "1 of 1 questions saved" with the correct chapter NAME on the
-- row, but chapter_key was null in the database. `chapter` (text label)
-- going through was itself proof this wasn't a client-side bug — only the
-- new column was missing from the RPC.
--
-- Fix is additive to the RPC body only (CREATE OR REPLACE, same pattern used
-- throughout this project for RPC updates) — one more column in the INSERT
-- list and its corresponding SELECT expression. No signature change, no
-- grant change, nothing else touched.

create or replace function public.admin_insert_pyq_rows(p_caller text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
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
      exam_type, subject, chapter, chapter_key, question_text, options, correct_answer,
      explanation, year, question_type, difficulty, marks, section,
      has_diagram, source, status, image_url
    )
    select
      r->>'exam_type',
      r->>'subject',
      r->>'chapter',
      r->>'chapter_key',
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
    returning id, question_text, has_diagram, section, marks, chapter, chapter_key
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_out from ins;

  return v_out;
end;
$function$;
