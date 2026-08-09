-- Part E: transactional email support. Reuses notification_prefs (already
-- holds push/whatsapp/call opt-in flags per user) for email opt-out instead
-- of a new table — one place to look up a user's channel preferences.
-- Absence of a row (most users, since the row is only created lazily by the
-- push-subscribe flow) means "email_enabled" defaults true at the app layer;
-- this column only needs to record an explicit opt-out.
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS email_enabled boolean NOT NULL DEFAULT true;

-- RPC used by the unsubscribe-email edge function (service-role already
-- bypasses RLS, but this keeps the write path explicit/auditable and mirrors
-- the SECURITY DEFINER pattern used everywhere else in this project).
CREATE OR REPLACE FUNCTION set_email_enabled(p_uid text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO notification_prefs (user_id, email_enabled)
  VALUES (p_uid, p_enabled)
  ON CONFLICT (user_id) DO UPDATE SET email_enabled = EXCLUDED.email_enabled, updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION set_email_enabled(text, boolean) TO service_role;
