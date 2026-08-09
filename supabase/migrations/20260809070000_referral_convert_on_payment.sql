-- Referral rewards now pay out on a PAID subscription, not on signup.
--
-- 20260809060000 granted both sides 7 premium days the moment a code was
-- redeemed. That rewards signups, which are free and trivially farmable: one
-- person can create accounts, redeem their own code from each, and mint premium
-- days indefinitely. It also spends the reward on users who may never convert.
--
-- Redemption is now a two-phase thing:
--
--   phase 1  redeem_referral_code()  -> records a PENDING referral. No days, no
--                                       counter movement. Just a claim.
--   phase 2  complete_referral()     -> fired from activate_subscription() once
--                                       Razorpay's signature has been verified
--                                       server-side. Grants both sides their
--                                       days and moves the referrer's counters.
--
-- Phase 2 is deliberately not callable in any meaningful way from the client:
-- activate_subscription is guarded by the app.subscription_secret shared secret
-- that only the razorpay-verify edge function holds, and complete_referral
-- itself no-ops unless the caller actually holds a paid subscription row.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. referral_uses gains a lifecycle
-- ---------------------------------------------------------------------------

ALTER TABLE public.referral_uses
  ADD COLUMN IF NOT EXISTS converted     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS converted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS days_granted  integer;

-- complete_referral looks up the pending row by referred_uid on every paid
-- activation, so this wants to be cheap.
CREATE INDEX IF NOT EXISTS referral_uses_pending_idx
  ON public.referral_uses (referred_uid) WHERE NOT converted;

-- Rows written by the previous (grant-on-signup) version were already paid out.
-- Marking them converted stops complete_referral paying them a second time.
UPDATE public.referral_uses
  SET converted = true, converted_at = created_at, days_granted = 7
  WHERE NOT converted AND created_at < NOW();

-- ---------------------------------------------------------------------------
-- 2. Fix: granting days to a user with a LAPSED subscription threw
-- ---------------------------------------------------------------------------

-- subscriptions has UNIQUE (user_id). The previous version looked for an
-- *active, unexpired* row and INSERTed when it found none — so a user whose
-- subscription had lapsed hit subscriptions_user_id_key and took the whole
-- redemption transaction down with a unique_violation. Now upserts.
CREATE OR REPLACE FUNCTION public.referral_grant_premium_days(p_uid text, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_expires timestamptz;
  v_base    timestamptz;
BEGIN
  SELECT s.id, s.expires_at INTO v_id, v_expires
  FROM subscriptions s
  WHERE s.user_id = p_uid
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  LIMIT 1;

  -- Open-ended subscription: already better than anything we could grant.
  IF v_id IS NOT NULL AND v_expires IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_id IS NOT NULL THEN
    UPDATE subscriptions
      SET expires_at = v_expires + make_interval(days => p_days),
          updated_at = NOW()
      WHERE id = v_id
      RETURNING expires_at INTO v_expires;
    RETURN v_expires;
  END IF;

  -- No active subscription. A lapsed row may still exist, so extend from now
  -- rather than from a date in the past, and upsert rather than insert.
  v_base := NOW();
  INSERT INTO subscriptions (user_id, plan, status, starts_at, expires_at, amount_paid, updated_at)
  VALUES (p_uid, 'premium_monthly', 'active', v_base,
          v_base + make_interval(days => p_days), 0, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    plan       = 'premium_monthly',
    status     = 'active',
    starts_at  = v_base,
    expires_at = GREATEST(COALESCE(subscriptions.expires_at, v_base), v_base)
                 + make_interval(days => p_days),
    updated_at = NOW()
  RETURNING expires_at INTO v_expires;

  RETURN v_expires;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Redemption records a claim and nothing else
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_referral_code(p_uid text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days     constant integer := 7;
  v_code     text;
  v_referrer text;
  v_created  timestamptz;
BEGIN
  IF verified_uid() IS NULL OR verified_uid() <> p_uid THEN
    RAISE EXCEPTION 'caller mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT rc.code, rc.user_id INTO v_code, v_referrer
  FROM referral_codes rc
  WHERE upper(rc.code) = upper(btrim(COALESCE(p_code, '')));

  IF v_code IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;

  IF v_referrer = p_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_referral');
  END IF;

  IF EXISTS (SELECT 1 FROM referral_uses ru WHERE ru.referred_uid = p_uid) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END IF;

  SELECT u.created_at INTO v_created FROM users u WHERE u.firebase_uid = p_uid;
  IF v_created IS NOT NULL AND v_created < NOW() - INTERVAL '30 days' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'account_too_old');
  END IF;

  BEGIN
    INSERT INTO referral_uses (referral_code, referred_uid, referrer_uid, converted)
    VALUES (v_code, p_uid, v_referrer, false);
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race against a concurrent submit from the same account.
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END;

  -- No days and no counter movement here — that is complete_referral's job,
  -- and it only runs once this account actually pays for a plan.
  RETURN jsonb_build_object(
    'ok', true,
    'status', 'pending',
    'days_on_conversion', v_days
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Conversion
-- ---------------------------------------------------------------------------

-- Called from activate_subscription after a verified payment. Safe to call on
-- every activation: it no-ops when there is no pending referral, and the
-- `AND NOT converted` in the UPDATE ... RETURNING is what makes a repeated call
-- (a Razorpay webhook retry, a renewal) idempotent rather than a second payout.
CREATE OR REPLACE FUNCTION public.complete_referral(p_uid text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days     constant integer := 7;
  v_referrer text;
  v_code     text;
  v_id       uuid;
BEGIN
  -- Only a genuinely paid, active plan converts a referral. Guards against a
  -- free/comped row, and against this being called out of order.
  IF NOT EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = p_uid
      AND s.status = 'active'
      AND s.plan <> 'free'
      AND (s.expires_at IS NULL OR s.expires_at > NOW())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_paid_subscription');
  END IF;

  UPDATE referral_uses
    SET converted    = true,
        converted_at = NOW(),
        days_granted = v_days
    WHERE referred_uid = p_uid
      AND NOT converted
    RETURNING id, referrer_uid, referral_code INTO v_id, v_referrer, v_code;

  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'nothing_pending');
  END IF;

  UPDATE referral_codes
    SET uses           = uses + 1,
        credits_earned = credits_earned + v_days
    WHERE code = v_code;

  PERFORM referral_grant_premium_days(v_referrer, v_days);
  PERFORM referral_grant_premium_days(p_uid,      v_days);

  INSERT INTO user_notifications (user_id, type, title, body, link)
  VALUES (v_referrer, 'referral_converted',
          'Your referral just subscribed',
          'You have earned ' || v_days || ' days of premium. Keep sharing!',
          '/profile');

  RETURN jsonb_build_object('ok', true, 'days_granted', v_days, 'referrer', v_referrer);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Hook it into the payment path
-- ---------------------------------------------------------------------------

-- Unchanged except for the complete_referral call at the end. It runs after the
-- upsert so the bonus days extend the subscription the payment just set, rather
-- than being overwritten by it — and it is wrapped so a referral problem can
-- never fail a payment that has already been taken.
CREATE OR REPLACE FUNCTION public.activate_subscription(
  p_caller text, p_uid text, p_plan text, p_expires timestamptz,
  p_payment_id text, p_amount integer DEFAULT 0)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  expected TEXT := current_setting('app.subscription_secret', true);
  v_ref    jsonb := NULL;
BEGIN
  -- Shared-secret guard (set via: ALTER DATABASE ... SET app.subscription_secret = '...')
  IF expected IS NOT NULL AND expected <> '' AND p_caller <> expected THEN
    RAISE EXCEPTION 'Unauthorized caller';
  END IF;

  INSERT INTO subscriptions (
    user_id, plan, status, starts_at, expires_at,
    razorpay_payment_id, amount_paid, updated_at
  )
  VALUES (p_uid, p_plan, 'active', NOW(), p_expires, p_payment_id, p_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    plan                = EXCLUDED.plan,
    status              = 'active',
    starts_at           = NOW(),
    expires_at          = EXCLUDED.expires_at,
    razorpay_payment_id = EXCLUDED.razorpay_payment_id,
    amount_paid         = EXCLUDED.amount_paid,
    updated_at          = NOW();

  -- Only a real money payment converts a referral. An admin comp goes through
  -- admin_grant_subscription, which deliberately does not call this.
  IF p_payment_id IS NOT NULL AND p_plan <> 'free' THEN
    BEGIN
      v_ref := complete_referral(p_uid);
    EXCEPTION WHEN OTHERS THEN
      -- The student has paid. Whatever went wrong with the referral, it is not
      -- worth failing the activation over.
      v_ref := jsonb_build_object('ok', false, 'error', 'referral_failed');
    END;
  END IF;

  RETURN json_build_object('ok', true, 'expires_at', p_expires, 'referral', v_ref);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Surface the pending state to the Profile card
-- ---------------------------------------------------------------------------

-- `uses` now counts CONVERTED referrals only, so a referrer whose friend has
-- signed up but not yet paid would otherwise see a flat zero with no signal
-- that anything is in flight.
--
-- Dropped rather than replaced: adding an OUT column changes the row type, and
-- CREATE OR REPLACE cannot do that (42P13).
DROP FUNCTION IF EXISTS public.get_or_create_referral_code(text);

CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(p_uid text)
RETURNS TABLE(code text, uses integer, credits_earned integer, pending integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_code text;
  v_try  int := 0;
BEGIN
  IF verified_uid() IS NULL OR verified_uid() <> p_uid THEN
    RAISE EXCEPTION 'caller mismatch' USING ERRCODE = '42501';
  END IF;

  SELECT rc.code INTO v_code FROM referral_codes rc WHERE rc.user_id = p_uid;

  WHILE v_code IS NULL AND v_try < 8 LOOP
    v_try := v_try + 1;
    BEGIN
      INSERT INTO referral_codes (user_id, code, uses, credits_earned)
      VALUES (p_uid, referral_random_code(), 0, 0)
      RETURNING referral_codes.code INTO v_code;
    EXCEPTION WHEN unique_violation THEN
      -- Either a code collision (retry with a fresh one) or a concurrent call
      -- for the same user (re-read and keep whichever landed first).
      SELECT rc.code INTO v_code FROM referral_codes rc WHERE rc.user_id = p_uid;
    END;
  END LOOP;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'could not allocate referral code';
  END IF;

  RETURN QUERY
    SELECT rc.code, rc.uses, rc.credits_earned,
           (SELECT count(*)::int FROM referral_uses ru
             WHERE ru.referrer_uid = p_uid AND NOT ru.converted)
    FROM referral_codes rc WHERE rc.user_id = p_uid;
END;
$$;

COMMIT;
