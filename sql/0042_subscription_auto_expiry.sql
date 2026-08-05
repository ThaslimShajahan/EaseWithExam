-- ═══════════════════════════════════════════════════════════════════
-- Migration 0042 — Automatic subscription expiry
--
-- Previously, "isActive" for a subscription was only ever computed at
-- READ time (status === 'active' AND expires_at > now()) — the actual
-- `status` column never transitioned to 'expired' on its own, so it sat
-- at 'active' forever once expires_at passed. Admin's own Subscriptions
-- table showed a green "active" badge even for subscriptions years past
-- their expiry date (only the date text itself turned red).
--
-- This adds a real server-side transition via pg_cron, running hourly.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE subscriptions
     SET status = 'expired', updated_at = now()
   WHERE status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at < now();
END;
$$;

SELECT cron.schedule(
  'expire-subscriptions-hourly',
  '0 * * * *',
  $$SELECT public.expire_subscriptions();$$
);
