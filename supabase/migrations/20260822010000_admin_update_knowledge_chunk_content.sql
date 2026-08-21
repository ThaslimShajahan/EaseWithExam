-- Adds the one RPC missing for a safe in-place content rewrite of
-- knowledge_base rows: until now this table only had insert
-- (admin_insert_knowledge_chunks), delete-by-ids (admin_delete_knowledge_chunks),
-- and clear-everything (admin_clear_knowledge_base) — no way to update a row's
-- content without changing its id.
--
-- Needed for the 2026-08-22 LaTeX backfill: study_notes already has a real
-- update-by-id path (admin_upsert_study_note with p_id set), but doing the same
-- for knowledge_base required either (a) this RPC, or (b) insert-new +
-- delete-old, which loses "same row id" and needed re-pointing
-- content_figures.source_id (a soft reference, no formal FK) at every new id.
-- (a) is the smaller, safer change — one column, one row, same pattern as
-- every other admin_* RPC in this file's neighborhood.
--
-- Deliberately narrow: updates ONLY the content column. Does not touch
-- chapter/chapter_key/subject/exam_type/embedding/content_type/latex/
-- has_equations or anything else — a content-formatting rewrite has no
-- business touching identity or classification columns, and narrowing the
-- RPC's own reach is cheaper insurance than trusting a caller to pass the
-- right values for every other column.
create or replace function public.admin_update_knowledge_chunk_content(p_caller text, p_id uuid, p_content text)
returns public.knowledge_base
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.knowledge_base;
begin
  perform assert_verified_admin(p_caller);

  update public.knowledge_base
  set content = p_content
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.admin_update_knowledge_chunk_content(text, uuid, text) is
  'Admin-only. Updates ONLY knowledge_base.content for one row by id -- added for the LaTeX-formatting backfill so existing chunks can be corrected in place without a new row id. Not a general-purpose chunk editor.';

-- Matches the existing grant shape of its siblings (admin_insert_knowledge_chunks,
-- admin_delete_knowledge_chunks, admin_upsert_study_note) -- all three are
-- anon + authenticated today, not authenticated-only. Confirmed live via
-- has_function_privilege before writing this, not assumed from the 2026-08-09
-- role-gate migration's intent, which only touched functions that existed at
-- the time it ran.
grant execute on function public.admin_update_knowledge_chunk_content(text, uuid, text) to anon, authenticated;
