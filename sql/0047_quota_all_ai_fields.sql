-- ═══════════════════════════════════════════════════════════════════
-- Migration 0047 — Cover all 5 AI quota fields in admin overrides
--
-- quota_config (per-plan defaults) already tracks all 5 metered AI features:
-- ai_questions, veda_messages, mock_tests, paper_evaluations, podcasts. But
-- quota_overrides (per-student overrides) only had columns for the first 3 —
-- paper_evaluations and podcasts couldn't be overridden for an individual
-- student at all. Same gap existed in admin_set_quota_config/
-- admin_set_quota_override/admin_list_quota_overrides, which only accepted/
-- returned 3 of the 5 fields even though quota_config's own columns already
-- covered all 5. This migration brings both the table and all three RPCs up
-- to the full set.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE quota_overrides
  ADD COLUMN IF NOT EXISTS paper_evaluations int,
  ADD COLUMN IF NOT EXISTS podcasts          int;

-- ── admin_set_quota_config: now accepts all 5 fields ──────────────────
DROP FUNCTION IF EXISTS public.admin_set_quota_config(text, text, integer, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_set_quota_config(
  p_caller            text,
  p_plan_id           text,
  p_ai                integer,
  p_veda              integer,
  p_mock              integer,
  p_paper_evaluations integer DEFAULT NULL,
  p_podcasts          integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO quota_config (plan_id, ai_questions, veda_messages, mock_tests, paper_evaluations, podcasts)
  VALUES (p_plan_id, p_ai, p_veda, p_mock, p_paper_evaluations, p_podcasts)
  ON CONFLICT (plan_id) DO UPDATE SET
    ai_questions      = EXCLUDED.ai_questions,
    veda_messages     = EXCLUDED.veda_messages,
    mock_tests        = EXCLUDED.mock_tests,
    paper_evaluations = EXCLUDED.paper_evaluations,
    podcasts          = EXCLUDED.podcasts;
  RETURN json_build_object('ok', true);
END;
$$;

-- ── admin_set_quota_override: now accepts all 5 fields ────────────────
DROP FUNCTION IF EXISTS public.admin_set_quota_override(text, text, integer, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.admin_set_quota_override(
  p_caller            text,
  p_user_id           text,
  p_ai                integer DEFAULT NULL,
  p_veda              integer DEFAULT NULL,
  p_mock              integer DEFAULT NULL,
  p_reason            text    DEFAULT NULL,
  p_expires_at        text    DEFAULT NULL,
  p_paper_evaluations integer DEFAULT NULL,
  p_podcasts          integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <> '' THEN
    v_expires := p_expires_at::TIMESTAMPTZ;
  END IF;
  INSERT INTO quota_overrides (user_id, ai_questions, veda_messages, mock_tests, reason, expires_at, updated_at, paper_evaluations, podcasts)
  VALUES (p_user_id, p_ai, p_veda, p_mock, p_reason, v_expires, NOW(), p_paper_evaluations, p_podcasts)
  ON CONFLICT (user_id) DO UPDATE SET
    ai_questions      = EXCLUDED.ai_questions,
    veda_messages     = EXCLUDED.veda_messages,
    mock_tests        = EXCLUDED.mock_tests,
    reason            = EXCLUDED.reason,
    expires_at        = EXCLUDED.expires_at,
    updated_at        = NOW(),
    paper_evaluations = EXCLUDED.paper_evaluations,
    podcasts          = EXCLUDED.podcasts;
  RETURN json_build_object('ok', true);
END;
$$;

-- ── admin_list_quota_overrides: now returns all 5 fields ──────────────
DROP FUNCTION IF EXISTS public.admin_list_quota_overrides(text);

CREATE OR REPLACE FUNCTION public.admin_list_quota_overrides(p_caller text)
RETURNS TABLE(
  id uuid, user_id text, ai_questions integer, veda_messages integer, mock_tests integer,
  paper_evaluations integer, podcasts integer,
  reason text, expires_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT o.id, o.user_id, o.ai_questions, o.veda_messages, o.mock_tests,
           o.paper_evaluations, o.podcasts,
           o.reason, o.expires_at, o.created_at, o.updated_at
    FROM   quota_overrides o
    ORDER  BY o.created_at DESC;
END;
$$;
