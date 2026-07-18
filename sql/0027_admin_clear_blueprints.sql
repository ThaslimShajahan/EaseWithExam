-- ═══════════════════════════════════════════════════════════════════
-- Migration 0027 — Admin RPC to clear exam_blueprints
-- Run this in: Supabase Dashboard → SQL Editor
--
-- adminClearAllData() (the "Clear All Data" / Danger Zone button) deletes
-- several tables directly with the anon key, which works for most of them —
-- but exam_blueprints has RLS that silently blocks anon-key deletes (the
-- request returns 200 with 0 rows affected instead of an error, so it's easy
-- to miss). Confirmed live: 6 rows survived a full "Clear All Data" run.
--
-- Adds a proper SECURITY DEFINER RPC instead, matching the same
-- caller-authorization pattern every other admin_* RPC in this project uses.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_clear_exam_blueprints(p_caller text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  DELETE FROM exam_blueprints;
END;
$$;
