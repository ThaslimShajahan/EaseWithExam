-- ═══════════════════════════════════════════════════════════════════
-- Migration 0044 — Delete capability for paper templates
--
-- There was no way to remove a paper_templates row from the admin UI —
-- only create/edit. Added a real delete RPC + wired a delete button
-- (with inline confirm) into AdminPaperTemplates.jsx.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_delete_paper_template(p_caller text, p_exam_type text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM paper_templates WHERE exam_type = p_exam_type;
END;
$$;
