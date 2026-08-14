-- Closes the last door subject-name drift can walk back through.
--
-- 20260813110000 wired assert_known_subjects() into the two STREAM RPCs, so a
-- stream config can no longer name a subject the vocabulary doesn't have. But
-- exam_categories — the OTHER half of the same drift measured in
-- docs/STREAM_SELECTION_HANDOFF.md §12 — was left unvalidated, so the
-- Categories editor could still introduce an unknown subject name and reopen
-- the exact gap from the other direction. Verified before writing this:
--
--   admin_upsert_stream_config          VALIDATES
--   admin_upsert_board_language_config  VALIDATES
--   admin_upsert_exam_category          NO VALIDATION   <- this migration
--   admin_upsert_syllabus_node          NO VALIDATION   <- this migration
--   admin_upsert_subject                NO VALIDATION   <- correct, it DEFINES
--                                                          the vocabulary;
--                                                          validating it against
--                                                          itself is circular
--
-- Live drift at the time of writing is zero (every exam_categories subject
-- exists in `subjects`), so this is preventative, not corrective — it cannot
-- reject any row that exists today. Confirmed by query, not assumed.
--
-- Both functions keep their exact signatures, return types and grants; the only
-- change is one assert_known_subjects() call added after the existing admin
-- check, so an unknown subject fails loudly at write time instead of silently
-- becoming a name nothing downstream can resolve.

create or replace function public.admin_upsert_exam_category(
  p_caller text, p_id uuid, p_exam_key text, p_label text, p_category_kind text,
  p_board_key text, p_class_key text, p_group_label text, p_subjects text[], p_sort_order integer
) returns exam_categories
language plpgsql
security definer
as $function$
declare
  v_row exam_categories;
begin
  perform assert_verified_admin(p_caller);  -- P0.5
  if not exists(select 1 from admins where uid = p_caller and is_active = true) then
    raise exception 'Not authorized';
  end if;

  -- NEW (20260814030000): every subject named here must exist in the
  -- vocabulary. Categories is where a subject becomes offerable for a
  -- board+class, so an unknown name here propagates to every content screen
  -- that reads getSubjectsForExam().
  perform public.assert_known_subjects(coalesce(p_subjects, '{}'));

  if p_id is null then
    insert into exam_categories (exam_key, label, category_kind, board_key, class_key, group_label, subjects, sort_order)
    values (p_exam_key, p_label, p_category_kind, p_board_key, p_class_key, p_group_label, coalesce(p_subjects, '{}'), coalesce(p_sort_order, 0))
    on conflict (exam_key) do update set
      label = excluded.label, category_kind = excluded.category_kind, board_key = excluded.board_key,
      class_key = excluded.class_key, group_label = excluded.group_label, subjects = excluded.subjects,
      sort_order = excluded.sort_order, is_active = true, updated_at = now()
    returning * into v_row;
  else
    update exam_categories set
      exam_key = p_exam_key, label = p_label, category_kind = p_category_kind,
      board_key = p_board_key, class_key = p_class_key, group_label = p_group_label,
      subjects = coalesce(p_subjects, '{}'), sort_order = coalesce(p_sort_order, 0), updated_at = now()
    where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$function$;

-- syllabus_nodes carries a subject per chapter row, and PYQ chapter resolution
-- (20260814010000) snaps against exactly these rows — a node created for a
-- subject outside the vocabulary would be unreachable by anything that resolves
-- subjects through Categories.
create or replace function public.admin_upsert_syllabus_node(
  p_caller text, p_exam_type text, p_subject text, p_chapter_name text, p_chapter_key text,
  p_class_level text default null, p_sort_order integer default 1,
  p_subtopics jsonb default '[]'::jsonb, p_id uuid default null
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

  -- NEW (20260814030000): same vocabulary check, on the subject this chapter
  -- belongs to. Deliberately checks p_subject only — chapter_name is a chapter
  -- label, not a subject, and is governed by the manifest system instead.
  perform public.assert_known_subjects(array[p_subject]);

  if p_id is not null then
    update syllabus_nodes set
      chapter_name = p_chapter_name,
      sort_order   = p_sort_order,
      subtopics    = p_subtopics,
      is_active    = true
    where id = p_id
    returning * into v_row;
  else
    insert into syllabus_nodes
      (exam_type, subject, chapter_key, chapter_name, class_level, sort_order, subtopics)
    values
      (p_exam_type, p_subject, p_chapter_key, p_chapter_name, p_class_level, p_sort_order, p_subtopics)
    on conflict (exam_type, subject, chapter_key) do update set
      chapter_name = excluded.chapter_name,
      sort_order   = excluded.sort_order,
      subtopics    = excluded.subtopics
    returning * into v_row;
  end if;

  return row_to_json(v_row)::jsonb;
end;
$function$;

-- Grants re-asserted (CREATE OR REPLACE preserves them, but an earlier
-- migration in this project lost them once — cheap insurance).
-- anon is included deliberately: Firebase JWTs carry no `role` claim so every
-- PostgREST request runs as anon; the real gate is assert_verified_admin in the
-- body. See 20260813080000 for the empirical proof behind that rule.
grant execute on function public.admin_upsert_exam_category(
  text, uuid, text, text, text, text, text, text, text[], integer
) to anon, authenticated;
grant execute on function public.admin_upsert_syllabus_node(
  text, text, text, text, text, text, integer, jsonb, uuid
) to anon, authenticated;
