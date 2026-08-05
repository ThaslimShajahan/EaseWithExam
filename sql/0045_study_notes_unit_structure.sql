-- ═══════════════════════════════════════════════════════════════════
-- Migration 0045 — Unit/chapter structure for study notes
--
-- A single PDF upload (e.g. "CBSE Class 8 English Unit 1") can contain
-- multiple lessons/chapters with their own page ranges. study_notes
-- previously had no way to record that structure or the order lessons
-- appear in the source book, so a Table-of-Contents view (grouping
-- notes by unit, ordered by page) wasn't possible.
--
-- NOTE: this migration documents schema + RPC changes that were
-- already applied live via ad-hoc `supabase db query` calls earlier
-- in this session — this file makes them reproducible/reviewable.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE study_notes
  ADD COLUMN IF NOT EXISTS unit        text,
  ADD COLUMN IF NOT EXISTS page_start  int,
  ADD COLUMN IF NOT EXISTS page_end    int,
  ADD COLUMN IF NOT EXISTS sort_order  int DEFAULT 0;

DROP FUNCTION IF EXISTS public.admin_upsert_study_note(
  text, uuid, text, text, text, text, text, text, uuid, boolean, text[]
);

CREATE OR REPLACE FUNCTION public.admin_upsert_study_note(
  p_caller       text,
  p_id           uuid    DEFAULT NULL,
  p_title        text    DEFAULT '',
  p_subject      text    DEFAULT NULL,
  p_exam_type    text    DEFAULT NULL,
  p_chapter      text    DEFAULT NULL,
  p_content      text    DEFAULT NULL,
  p_pdf_url      text    DEFAULT NULL,
  p_centre_id    uuid    DEFAULT NULL,
  p_is_published boolean DEFAULT false,
  p_tags         text[]  DEFAULT '{}',
  p_unit         text    DEFAULT NULL,
  p_page_start   integer DEFAULT NULL,
  p_page_end     integer DEFAULT NULL,
  p_sort_order   integer DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT; v_id UUID; result JSON;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE study_notes SET
      title = p_title, subject = p_subject, exam_type = p_exam_type,
      chapter = p_chapter, content = p_content, pdf_url = p_pdf_url,
      centre_id = p_centre_id, is_published = p_is_published,
      tags = p_tags, unit = p_unit, page_start = p_page_start,
      page_end = p_page_end, sort_order = p_sort_order, updated_at = NOW()
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO study_notes
      (title, subject, exam_type, chapter, content, pdf_url, centre_id, is_published, tags, created_by, unit, page_start, page_end, sort_order)
    VALUES (p_title, p_subject, p_exam_type, p_chapter, p_content, p_pdf_url, p_centre_id, p_is_published, p_tags, p_caller, p_unit, p_page_start, p_page_end, p_sort_order)
    RETURNING id INTO v_id;
  END IF;

  SELECT row_to_json(n) INTO result FROM study_notes n WHERE n.id = v_id;
  RETURN result;
END;
$$;
