-- Step 6 (Resend inbound email) — destination confirmed 2026-08-14: an admin
-- Support Inbox. A real inbound email (a reply to a receipt/notification, or
-- mail to a support@ address once DNS is pointed at Resend) lands here for an
-- admin to see and act on, instead of requiring a separate mailbox.
--
-- This table is inert on its own — nothing writes to it until:
--   1. The owner adds the MX record Resend's dashboard shows for the chosen
--      receiving domain/subdomain (owner-only DNS action, outside this repo).
--   2. The owner creates a webhook in the Resend dashboard for the
--      `email.received` event, pointed at this project's `resend-inbound`
--      edge function, and the RESEND_WEBHOOK_SECRET it generates is stored
--      via `supabase secrets set` (never committed).
-- See chat for the full walkthrough of both.
CREATE TABLE IF NOT EXISTS resend_inbound_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Resend's own id for the received email (data.email_id in the webhook,
  -- also the {id} used to fetch full content from their Retrieve Received
  -- Email API). Unique so a webhook retry can't duplicate a row.
  resend_email_id   text UNIQUE NOT NULL,
  from_address      text NOT NULL,
  to_addresses      text[] NOT NULL DEFAULT '{}',
  subject           text NOT NULL DEFAULT '',
  message_id        text,
  -- text/html are fetched in a follow-up call to Resend's Retrieve Received
  -- Email API — the webhook payload itself carries metadata only (from/to/
  -- subject/attachment stubs), not the body. Nullable: the row is still
  -- worth having (subject/from are enough to triage) if that follow-up call
  -- ever fails.
  body_text         text,
  body_html         text,
  attachments       jsonb NOT NULL DEFAULT '[]',
  status            text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'archived')),
  resend_created_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text
);

CREATE INDEX IF NOT EXISTS idx_resend_inbound_emails_status ON resend_inbound_emails (status, created_at DESC);

ALTER TABLE resend_inbound_emails ENABLE ROW LEVEL SECURITY;
-- No direct policies — service-role (the edge function's insert) and
-- SECURITY DEFINER RPCs (admin read/update) only, same lockdown as
-- email_templates / admins / in_app_notifications.

CREATE OR REPLACE FUNCTION public.admin_list_inbound_emails(p_caller text, p_status text DEFAULT NULL)
RETURNS SETOF resend_inbound_emails
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM assert_verified_admin(p_caller);  -- P0.5
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT * FROM resend_inbound_emails
    WHERE p_status IS NULL OR status = p_status
    ORDER BY created_at DESC
    LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_inbound_email_status(p_caller text, p_id uuid, p_status text)
RETURNS resend_inbound_emails
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row resend_inbound_emails;
BEGIN
  PERFORM assert_verified_admin(p_caller);  -- P0.5
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_status NOT IN ('unread', 'read', 'archived') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING errcode = '22023';
  END IF;

  UPDATE resend_inbound_emails
  SET status = p_status, updated_at = now(), updated_by = p_caller
  WHERE id = p_id
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Unknown inbound email id: %', p_id;
  END IF;

  RETURN v_row;
END;
$function$;

-- anon included deliberately: every PostgREST request runs as anon (Firebase
-- JWTs carry no `role` claim); assert_verified_admin + the admins check in
-- the body are the real gate. See 20260813080000 for the empirical proof.
GRANT EXECUTE ON FUNCTION public.admin_list_inbound_emails(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_inbound_email_status(text, uuid, text) TO anon, authenticated;
