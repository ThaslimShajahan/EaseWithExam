-- ═══════════════════════════════════════════════════════════════════
-- Migration 0040 — Resolve admin name/email in the Activity Log
--
-- admin_get_activity_log only returned the raw actor_uid, truncated to
-- 12 chars in the UI — no way to tell which admin actually did something.
-- Adds actor_name/actor_email via a LEFT JOIN against admins.
-- ═══════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.admin_get_activity_log(text, integer, integer);

CREATE FUNCTION public.admin_get_activity_log(p_caller text, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
RETURNS TABLE(
  id uuid, entity_type text, entity_id text, action text,
  actor_uid text, actor_role text, actor_name text, actor_email text,
  diff jsonb, note text, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  RETURN QUERY
    SELECT c.id, c.entity_type, c.entity_id, c.action,
           c.actor_uid, c.actor_role,
           a.name  AS actor_name,
           a.email AS actor_email,
           c.diff, c.note, c.created_at
      FROM changelog c
      LEFT JOIN admins a ON a.uid = c.actor_uid
     ORDER BY c.created_at DESC
     LIMIT p_limit
    OFFSET p_offset;
END;
$$;
