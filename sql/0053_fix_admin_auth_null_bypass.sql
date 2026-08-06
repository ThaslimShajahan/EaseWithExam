-- ═══════════════════════════════════════════════════════════════════
-- Migration 0053 — CRITICAL: fix NULL-role auth bypass on 15 admin RPCs
--
-- Every admin-only RPC in the platform used this pattern:
--   SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
--   IF v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
--
-- When p_caller does not match any row in `admins` (e.g. any random string,
-- or simply omitted/unauthenticated), v_role stays NULL. In SQL three-valued
-- logic, `NULL NOT IN (...)` evaluates to NULL, not TRUE — and `IF NULL THEN`
-- is treated as FALSE, so the RAISE EXCEPTION never fires. The check only
-- ever rejected a caller who WAS a real, named non-admin role; it silently
-- ALLOWED anyone who wasn't in `admins` at all, which is exactly the
-- anonymous/public-anon-key case.
--
-- Confirmed live and exploitable during this audit: calling
-- admin_set_quota_config via the public anon key with a fabricated p_caller
-- returned {"ok":true} and actually wrote the change — no login, no admin
-- role, nothing. The blast radius across all 15 functions includes granting
-- free premium subscriptions to any account (admin_grant_subscription),
-- sending arbitrary push notifications to any/all users
-- (admin_send_notification), deleting/publishing study notes, deleting
-- quota overrides, reading all subscriptions, and creating/deleting/
-- reactivating coaching admins.
--
-- Fix: explicit `v_role IS NULL OR` guard before the NOT IN check, on every
-- affected function. Also added the missing `AND is_active = true` caller
-- check to the 3 coaching_admin_* functions, which omitted it entirely (a
-- deactivated admin's own row would still authorize them).
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_set_quota_config(
  p_caller            text,
  p_plan_id           text,
  p_ai                integer,
  p_veda              integer,
  p_mock              integer,
  p_paper_evaluations integer DEFAULT NULL,
  p_podcasts          integer DEFAULT NULL,
  p_paper_generations integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO quota_config (plan_id, ai_questions, veda_messages, mock_tests, paper_evaluations, podcasts, paper_generations)
  VALUES (p_plan_id, p_ai, p_veda, p_mock, p_paper_evaluations, p_podcasts, p_paper_generations)
  ON CONFLICT (plan_id) DO UPDATE SET
    ai_questions      = EXCLUDED.ai_questions,
    veda_messages     = EXCLUDED.veda_messages,
    mock_tests        = EXCLUDED.mock_tests,
    paper_evaluations = EXCLUDED.paper_evaluations,
    podcasts          = EXCLUDED.podcasts,
    paper_generations = EXCLUDED.paper_generations;
  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_quota_override(
  p_caller            text,
  p_user_id           text,
  p_ai                integer DEFAULT NULL,
  p_veda              integer DEFAULT NULL,
  p_mock              integer DEFAULT NULL,
  p_reason            text    DEFAULT NULL,
  p_expires_at        text    DEFAULT NULL,
  p_paper_evaluations integer DEFAULT NULL,
  p_podcasts          integer DEFAULT NULL,
  p_paper_generations integer DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_role TEXT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_expires_at IS NOT NULL AND p_expires_at <> '' THEN
    v_expires := p_expires_at::TIMESTAMPTZ;
  END IF;
  INSERT INTO quota_overrides (user_id, ai_questions, veda_messages, mock_tests, reason, expires_at, updated_at, paper_evaluations, podcasts, paper_generations)
  VALUES (p_user_id, p_ai, p_veda, p_mock, p_reason, v_expires, NOW(), p_paper_evaluations, p_podcasts, p_paper_generations)
  ON CONFLICT (user_id) DO UPDATE SET
    ai_questions      = EXCLUDED.ai_questions,
    veda_messages     = EXCLUDED.veda_messages,
    mock_tests        = EXCLUDED.mock_tests,
    reason            = EXCLUDED.reason,
    expires_at        = EXCLUDED.expires_at,
    updated_at        = NOW(),
    paper_evaluations = EXCLUDED.paper_evaluations,
    podcasts          = EXCLUDED.podcasts,
    paper_generations = EXCLUDED.paper_generations;
  RETURN json_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_quota_override(p_caller text, p_user_id text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM quota_overrides WHERE user_id = p_user_id;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_study_note(p_caller text, p_id uuid)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  DELETE FROM study_notes WHERE id = p_id;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_get_platform_settings(p_caller text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN (SELECT json_object_agg(key, value) FROM platform_settings);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_grant_subscription(p_caller text, p_user_id text, p_plan text, p_days integer DEFAULT 30)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  INSERT INTO subscriptions (user_id, plan, status, starts_at, expires_at, updated_at)
  VALUES (p_user_id, p_plan, 'active', NOW(), NOW() + (p_days||' days')::INTERVAL, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    plan       = EXCLUDED.plan,
    status     = 'active',
    starts_at  = NOW(),
    expires_at = NOW() + (p_days||' days')::INTERVAL,
    updated_at = NOW();

  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_study_notes(p_caller text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN (SELECT json_agg(n ORDER BY n.created_at DESC) FROM study_notes n);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(p_caller text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  RETURN (SELECT json_agg(s ORDER BY s.updated_at DESC) FROM subscriptions s);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_send_notification(p_caller text, p_title text, p_body text, p_type text DEFAULT 'info'::text, p_user_id text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_expires_in_days integer DEFAULT NULL::integer)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_expires TIMESTAMPTZ;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  IF p_expires_in_days IS NOT NULL THEN
    v_expires := NOW() + (p_expires_in_days||' days')::INTERVAL;
  END IF;
  INSERT INTO in_app_notifications (user_id, title, body, type, url, expires_at)
  VALUES (p_user_id, p_title, p_body, p_type, p_url, v_expires);
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_platform_setting(p_caller text, p_key text, p_value text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  INSERT INTO platform_settings (key, value, updated_by, updated_at)
  VALUES (p_key, p_value, p_caller, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW();
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_toggle_study_note_publish(p_caller text, p_id uuid, p_published boolean)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;
  UPDATE study_notes SET is_published = p_published, updated_at = NOW() WHERE id = p_id;
  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_upsert_study_note(p_caller text, p_id uuid DEFAULT NULL::uuid, p_title text DEFAULT ''::text, p_subject text DEFAULT NULL::text, p_exam_type text DEFAULT NULL::text, p_chapter text DEFAULT NULL::text, p_content text DEFAULT NULL::text, p_pdf_url text DEFAULT NULL::text, p_centre_id uuid DEFAULT NULL::uuid, p_is_published boolean DEFAULT false, p_tags text[] DEFAULT '{}'::text[], p_unit text DEFAULT NULL::text, p_page_start integer DEFAULT NULL::integer, p_page_end integer DEFAULT NULL::integer, p_sort_order integer DEFAULT 0, p_source_text text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_role TEXT; v_id UUID; result JSON;
BEGIN
  SELECT role INTO v_role FROM admins WHERE uid = p_caller AND is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN RAISE EXCEPTION 'Access denied'; END IF;

  IF p_id IS NOT NULL THEN
    UPDATE study_notes SET
      title = p_title, subject = p_subject, exam_type = p_exam_type,
      chapter = p_chapter, content = p_content, pdf_url = p_pdf_url,
      centre_id = p_centre_id, is_published = p_is_published,
      tags = p_tags, unit = p_unit, page_start = p_page_start,
      page_end = p_page_end, sort_order = p_sort_order,
      source_text = p_source_text, updated_at = NOW()
    WHERE id = p_id RETURNING id INTO v_id;
  ELSE
    INSERT INTO study_notes
      (title, subject, exam_type, chapter, content, pdf_url, centre_id, is_published, tags, created_by, unit, page_start, page_end, sort_order, source_text)
    VALUES (p_title, p_subject, p_exam_type, p_chapter, p_content, p_pdf_url, p_centre_id, p_is_published, p_tags, p_caller, p_unit, p_page_start, p_page_end, p_sort_order, p_source_text)
    RETURNING id INTO v_id;
  END IF;

  SELECT row_to_json(n) INTO result FROM study_notes n WHERE n.id = v_id;
  RETURN result;
END;
$function$;

-- coaching_admin_* also lacked the AND is_active = true caller check entirely
-- (not just the NULL guard) — added here.

CREATE OR REPLACE FUNCTION public.coaching_admin_delete(p_caller text, p_target_uid text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  caller_role TEXT;
BEGIN
  SELECT role INTO caller_role FROM admins WHERE uid = p_caller AND is_active = true LIMIT 1;
  IF caller_role IS NULL OR caller_role NOT IN ('superadmin','admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  DELETE FROM coaching_admins WHERE uid = p_target_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.coaching_admin_toggle_active(p_caller text, p_target_uid text, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  caller_role TEXT;
BEGIN
  SELECT role INTO caller_role FROM admins WHERE uid = p_caller AND is_active = true LIMIT 1;
  IF caller_role IS NULL OR caller_role NOT IN ('superadmin','admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  UPDATE coaching_admins SET is_active = p_active WHERE uid = p_target_uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.coaching_admin_upsert(p_caller text, p_uid text, p_email text, p_name text, p_centre_id uuid, p_role text DEFAULT 'instructor'::text)
 RETURNS json
 LANGUAGE plpgsql SECURITY DEFINER
AS $function$
DECLARE
  caller_role TEXT;
  result      JSON;
BEGIN
  SELECT role INTO caller_role FROM admins WHERE uid = p_caller AND is_active = true LIMIT 1;
  IF caller_role IS NULL OR caller_role NOT IN ('superadmin','admin') THEN
    RAISE EXCEPTION 'Only platform admins can add coaching admins';
  END IF;

  INSERT INTO coaching_admins (uid, email, name, centre_id, role, added_by)
  VALUES (p_uid, p_email, p_name, p_centre_id, p_role, p_caller)
  ON CONFLICT (uid) DO UPDATE
    SET email     = EXCLUDED.email,
        name      = EXCLUDED.name,
        centre_id = EXCLUDED.centre_id,
        role      = EXCLUDED.role;

  SELECT row_to_json(r) INTO result
  FROM (SELECT * FROM coaching_admins WHERE uid = p_uid LIMIT 1) r;

  RETURN result;
END;
$function$;
