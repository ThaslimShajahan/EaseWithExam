-- ═══════════════════════════════════════════════════════════════════
-- Migration 0043 — Subscription expiry reminders + expired notice
--
-- Extends expire_subscriptions() (0042) to also notify the student:
--   1. 3 days before expiry (once per period — reminder_sent_at guards
--      against re-notifying every hour until renewal).
--   2. The moment their plan actually expires.
--
-- reminder_sent_at is reset to NULL on every renewal (adminGrantPremium
-- client-side, and activateSubscription in the razorpay-webhook edge
-- function) so the reminder re-arms for the new billing period.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.expire_subscriptions()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  r record;
BEGIN
  -- 1. Expiring-soon reminders (within 3 days, not yet reminded for this period)
  FOR r IN
    SELECT user_id, plan, expires_at FROM subscriptions
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at BETWEEN now() AND now() + interval '3 days'
       AND reminder_sent_at IS NULL
  LOOP
    INSERT INTO user_notifications (user_id, type, title, body, link, read, created_at)
    VALUES (
      r.user_id, 'subscription_active',
      'Your Premium is expiring soon',
      'Your ' || r.plan || ' plan ends on ' || to_char(r.expires_at, 'DD Mon YYYY') || '. Renew to keep unlimited access.',
      '/pricing', false, now()
    );
    UPDATE subscriptions SET reminder_sent_at = now() WHERE user_id = r.user_id;
  END LOOP;

  -- 2. Just-expired notifications (before flipping status, so we still know who to notify)
  FOR r IN
    SELECT user_id, plan FROM subscriptions
     WHERE status = 'active'
       AND expires_at IS NOT NULL
       AND expires_at < now()
  LOOP
    INSERT INTO user_notifications (user_id, type, title, body, link, read, created_at)
    VALUES (
      r.user_id, 'subscription_active',
      'Your Premium has expired',
      'Your ' || r.plan || ' plan has ended and your account is back on the Free plan. Renew anytime to restore unlimited access.',
      '/pricing', false, now()
    );
  END LOOP;

  -- 3. The actual status transition
  UPDATE subscriptions
     SET status = 'expired', updated_at = now()
   WHERE status = 'active'
     AND expires_at IS NOT NULL
     AND expires_at < now();
END;
$$;
