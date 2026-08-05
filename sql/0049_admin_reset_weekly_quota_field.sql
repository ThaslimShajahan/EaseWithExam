-- ═══════════════════════════════════════════════════════════════════
-- Migration 0049 — Proper reset for weekly quota fields
--
-- admin_reset_user_quota(p_caller, p_user_id, p_date) deletes ONE day's
-- daily_usage_quota row — correct for daily fields, but mock_tests_used is
-- now a weekly cap (see WEEKLY_FIELDS in src/lib/quota.js). If a student used
-- their one weekly mock test on Monday, an admin hitting "reset" on Wednesday
-- only clears Wednesday's (already-empty) row — Monday's usage still counts
-- toward the week, so the student stays blocked despite the "reset."
--
-- admin_reset_weekly_field zeroes ONLY the named field across a date range
-- (not the whole row, so it doesn't also wipe that day's ai_questions/
-- veda_messages/etc. usage) — whitelisted to mock_tests_used for now, the
-- only weekly field, same whitelist-guard pattern as upsert_usage_quota.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_reset_weekly_field(
  p_caller     text,
  p_user_id    text,
  p_field      text,
  p_week_start text,
  p_week_end   text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _allowed text[] := ARRAY['mock_tests_used'];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_field != ALL(_allowed) THEN
    RAISE EXCEPTION 'invalid weekly quota field: %', p_field;
  END IF;

  EXECUTE format(
    'UPDATE daily_usage_quota SET %I = 0 WHERE user_id = $1 AND usage_date BETWEEN $2::date AND $3::date',
    p_field
  ) USING p_user_id, p_week_start, p_week_end;
END;
$$;
