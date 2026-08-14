-- Closes ACTION_ITEMS_FOR_YOU.md items #25 (knowledge_base, syllabus_nodes,
-- content_figures anon-writable) — content_figures and pyq_questions were
-- found ALREADY locked down when this was picked up (verified live: RLS
-- SELECT-only + gated RPCs on both, no raw client writes remain in src/ or
-- scripts/) — this migration covers the two tables actually still open:
-- knowledge_base (`knowledge_base_open`, ALL, public, qual=true) and
-- syllabus_nodes (`sn_admin_write`, ALL, {anon,authenticated}, qual=true).
--
-- Same shape as the pyq_questions lockdown this mirrors: SECURITY DEFINER
-- RPCs behind assert_verified_admin, existing SELECT policies untouched.
-- ORDERING HAZARD, same as 20260812020000/030000: this migration ONLY adds
-- the new RPCs and (for knowledge_base) a real SELECT policy — it does NOT
-- drop the open policies. Those are dropped in a separate, later statement
-- run only after the updated client is confirmed deployed and working,
-- exactly the sequencing already learned the hard way on the pyq lockdown.
--
-- Zero data rows touched. No table's contents are read, seeded, or
-- modified by this file — policies and functions only.

/* ── knowledge_base ──────────────────────────────────────────────── */

-- knowledge_base_open is currently the ONLY policy on this table (ALL
-- commands including SELECT) — dropping it later without first adding a
-- real read policy would take down every retrieval path (semantic search,
-- Ask-EWE, question generation) along with the write hole. Added now so
-- the ordering is safe whenever the ALL policy is dropped.
create policy knowledge_base_select on public.knowledge_base
  for select using (true);

create or replace function public.admin_insert_knowledge_chunks(p_caller text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
begin
  perform assert_verified_admin(p_caller);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  with ins as (
    insert into public.knowledge_base (
      paper_id, subject, content, embedding, exam_type, chapter, class_level,
      unit, keywords, content_type, techniques, difficulty, confidence,
      page_no, figure_url, has_equations, latex, source_ref, book, chapter_key
    )
    select
      nullif(r->>'paper_id', '')::uuid,
      r->>'subject',
      r->>'content',
      -- pgvector accepts a bracketed text form identical to a JSON array's
      -- own text representation, so a straight ::text::vector cast works.
      -- Absent/non-array embedding stays NULL rather than erroring — a row
      -- with a failed embed_text() call is meant to insert anyway (see
      -- _addEmbeddings' failedCount handling), not be dropped from the batch.
      case when jsonb_typeof(r->'embedding') = 'array'
        then (r->'embedding')::text::vector else null end,
      r->>'exam_type',
      r->>'chapter',
      r->>'class_level',
      r->>'unit',
      case when jsonb_typeof(r->'keywords') = 'array'
        then (select array_agg(x) from jsonb_array_elements_text(r->'keywords') x) else null end,
      r->>'content_type',
      case when jsonb_typeof(r->'techniques') = 'array'
        then (select array_agg(x) from jsonb_array_elements_text(r->'techniques') x) else null end,
      r->>'difficulty',
      nullif(r->>'confidence', '')::real,
      nullif(r->>'page_no', '')::int,
      r->>'figure_url',
      coalesce((r->>'has_equations')::boolean, false),
      case when jsonb_typeof(r->'latex') = 'array'
        then (select array_agg(x) from jsonb_array_elements_text(r->'latex') x) else null end,
      r->'source_ref',
      r->>'book',
      r->>'chapter_key'
    from jsonb_array_elements(p_rows) r
    returning id
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_out from ins;

  return v_out;
end;
$$;

create or replace function public.admin_delete_knowledge_chunks(p_caller text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform assert_verified_admin(p_caller);
  delete from public.knowledge_base where id = any(p_ids);
end;
$$;

-- Full-table clear for adminClearAllData — a real DELETE FROM, not a
-- targeted id list, since "clear everything" is genuinely different from
-- "delete these specific rows" and callers should not need to page through
-- ids to express it.
create or replace function public.admin_clear_knowledge_base(p_caller text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  perform assert_verified_admin(p_caller);
  delete from public.knowledge_base;
end;
$$;

/* ── syllabus_nodes ──────────────────────────────────────────────── */
-- sn_select and syllabus_nodes_read_authenticated already exist and are
-- correct (SELECT, is_active = true) — untouched here, nothing to add.

create or replace function public.admin_insert_syllabus_nodes(p_caller text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_out jsonb;
begin
  perform assert_verified_admin(p_caller);

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  -- Same vocabulary guard admin_upsert_syllabus_node already applies —
  -- a bulk insert must not be a back door around it.
  perform public.assert_known_subjects(
    (select array_agg(distinct r->>'subject') from jsonb_array_elements(p_rows) r)
  );

  with ins as (
    insert into public.syllabus_nodes (
      exam_type, subject, chapter_key, chapter_name, class_level, sort_order,
      is_active, subtopics, book, unit
    )
    select
      r->>'exam_type',
      r->>'subject',
      r->>'chapter_key',
      r->>'chapter_name',
      r->>'class_level',
      nullif(r->>'sort_order', '')::int,
      coalesce((r->>'is_active')::boolean, true),
      coalesce(r->'subtopics', '[]'::jsonb),
      r->>'book',
      r->>'unit'
    from jsonb_array_elements(p_rows) r
    returning id, chapter_key, chapter_name
  )
  select coalesce(jsonb_agg(to_jsonb(ins)), '[]'::jsonb) into v_out from ins;

  return v_out;
end;
$$;

-- Narrow, filtered update — matches AdminSyllabus.jsx's migrateOldFormat()
-- exactly (the only UPDATE this table needs from the client): re-tag rows
-- from an old-format exam_type string to the new one, scoped to one class
-- level so it can't touch other exam types by accident.
create or replace function public.admin_migrate_syllabus_exam_type(
  p_caller text, p_old_exam_type text, p_new_exam_type text, p_class_level text
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  perform assert_verified_admin(p_caller);

  update public.syllabus_nodes
     set exam_type = p_new_exam_type
   where exam_type = p_old_exam_type
     and class_level = p_class_level;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
