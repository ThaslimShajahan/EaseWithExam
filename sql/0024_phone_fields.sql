-- ═══════════════════════════════════════════════════════════════════
-- Migration 0024 — Phone number fields for call + WhatsApp alerts
-- Run in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Add call number to notification_prefs (whatsapp_number already exists)
ALTER TABLE notification_prefs
  ADD COLUMN IF NOT EXISTS phone_number   TEXT,      -- preferred call number
  ADD COLUMN IF NOT EXISTS call_enabled   BOOLEAN DEFAULT false;

-- 2. Verify columns
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'notification_prefs'
  AND column_name IN ('whatsapp_number', 'whatsapp_enabled', 'phone_number', 'call_enabled')
ORDER BY column_name;

-- ─────────────────────────────────────────────────────────────────────
-- SUPABASE SECRETS — set these in:
-- Dashboard → Settings → Edge Functions → Secrets → Add new secret
-- ─────────────────────────────────────────────────────────────────────
-- TWILIO_ACCOUNT_SID     (from your Twilio console)
-- TWILIO_AUTH_TOKEN      (from your Twilio console — never commit this)
-- TWILIO_WHATSAPP_FROM   = whatsapp:+14155238886
--
-- NOTE: Twilio's test credentials don't deliver real messages — they
-- validate the API call only. Swap for Live credentials to send actual
-- WhatsApp messages.
-- ─────────────────────────────────────────────────────────────────────
