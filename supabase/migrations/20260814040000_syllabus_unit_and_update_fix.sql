-- Two things, both surfaced by the Class 8 English upload post-mortem.
--
-- 1. syllabus_nodes has no `unit` column, so the canonical chapter table cannot
--    express "these chapters belong to Unit 1: Wit and Wisdom". knowledge_base
--    and study_notes both already carry `unit` and both already group by it
--    (NotesBrowser.jsx UnitGroup, AdminStudyNotes' ToC view), which is why the
--    student notes browser groups correctly while Syllabus and Content Map —
--    the two surfaces that read syllabus_nodes — cannot.
--
-- 2. admin_upsert_syllabus_node's UPDATE branch sets ONLY chapter_name,
--    sort_order and subtopics. subject, exam_type, class_level and chapter_key
--    are silently ignored, so AdminSyllabus.jsx:836's handleRenameSubject —
--    which passes p_id together with a NEW p_subject — reports success, logs a
--    change, refreshes the list, and changes nothing. Editing a chapter's key
--    in the Syllabus editor is the same silent no-op.
--
-- Additive: the column is nullable with no default, so every existing row and
-- every existing caller keeps working untouched.

alter table public.syllabus_nodes add column if not exists unit text;

comment on column public.syllabus_nodes.unit is
  'The book''s own grouping heading for this chapter ("Unit 1: Wit and Wisdom"). '
  'Sourced from the approved chapter_manifests entry, not from the operator''s '
  'intake form field. NULL means the book has no units, which is common and not '
  'an error.';

-- Grouping queries filter by (exam_type, subject) and then group by unit.
create index if not exists syllabus_nodes_unit_idx
  on public.syllabus_nodes (exam_type, subject, unit)
  where unit is not null;

-- DROP then CREATE, not CREATE OR REPLACE: adding a parameter produces a new
-- OVERLOAD rather than replacing the function, and two overloads reachable by
-- the same named-argument call is exactly the ambiguity PostgREST answers with
-- 300 Multiple Choices. One signature must exist, so the old one goes first.
drop function if exists public.admin_upsert_syllabus_node(
  text, text, text, text, text, text, integer, jsonb, uuid
);

create function public.admin_upsert_syllabus_node(
  p_caller text, p_exam_type text, p_subject text, p_chapter_name text, p_chapter_key text,
  p_class_level text default null, p_sort_order integer default 1,
  p_subtopics jsonb default '[]'::jsonb, p_id uuid default null,
  p_unit text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row syllabus_nodes%ROWTYPE;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists (select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'unauthorized';
  end if;

  -- Unchanged from 20260814030000: the subject must exist in the vocabulary.
  perform public.assert_known_subjects(array[p_subject]);

  if p_id is not null then
    -- FIXED: every identifying column is now writable. Previously only
    -- chapter_name/sort_order/subtopics were, which made a subject rename a
    -- silent no-op. chapter_key is included deliberately — if the new key
    -- collides with another row the unique index raises, and a loud 409 is the
    -- correct answer to "rename this chapter onto one that already exists",
    -- where silently keeping the old key was not.
    update syllabus_nodes set
      exam_type    = coalesce(p_exam_type, exam_type),
      subject      = coalesce(p_subject, subject),
      chapter_key  = coalesce(p_chapter_key, chapter_key),
      chapter_name = p_chapter_name,
      class_level  = coalesce(p_class_level, class_level),
      sort_order   = p_sort_order,
      subtopics    = p_subtopics,
      -- p_unit is coalesced like the rest, so an older caller that does not
      -- know about the column cannot blank an existing unit by omission.
      -- Clearing a unit is therefore not expressible here; that is deliberate
      -- until an explicit "remove from unit" action exists to mean it.
      unit         = coalesce(p_unit, unit),
      is_active    = true
    where id = p_id
    returning * into v_row;
  else
    insert into syllabus_nodes
      (exam_type, subject, chapter_key, chapter_name, class_level, sort_order, subtopics, unit)
    values
      (p_exam_type, p_subject, p_chapter_key, p_chapter_name, p_class_level, p_sort_order, p_subtopics, p_unit)
    on conflict (exam_type, subject, chapter_key) do update set
      chapter_name = excluded.chapter_name,
      sort_order   = excluded.sort_order,
      subtopics    = excluded.subtopics,
      unit         = coalesce(excluded.unit, syllabus_nodes.unit)
    returning * into v_row;
  end if;

  return row_to_json(v_row)::jsonb;
end;
$function$;

-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin in the
-- body. See 20260813080000 for the empirical proof behind that rule. These
-- grants are REQUIRED here rather than merely defensive — the DROP above
-- discarded the old function's grants along with it.
grant execute on function public.admin_upsert_syllabus_node(
  text, text, text, text, text, text, integer, jsonb, uuid, text
) to anon, authenticated;
