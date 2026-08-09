-- Referral system: make it actually work.
--
-- What existed before this migration: three overlapping tables (referral_codes,
-- referral_uses, referrals) and exactly one function, get_user_referral(), which
-- SELECTs from referral_codes. Nothing ever INSERTed into referral_codes, so
-- get_user_referral returned zero rows for every user and the "Refer & Earn"
-- card on ProfilePage never rendered. There was no way to enter a code, no
-- crediting logic, and nothing that turned a referral into a reward.
--
-- Decisions taken here:
--
--   * referral_codes + referral_uses are the owning pair. `referrals` is the
--     leftover shape from the deleted src/lib/referral.js and is dropped —
--     it is empty, nothing reads it, and leaving a third half-schema around is
--     how this got confusing in the first place.
--
--   * A "credit" is a premium day. That is not an invention: the Profile card
--     already says "earn premium days when they join" and already labels
--     credits_earned as "Days earned". This migration makes the database match
--     the promise the UI was already making.
--
--   * Both sides get REFERRAL_BONUS_DAYS (7). One-sided referrals give the new
--     user no reason to type the code in.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Retire the duplicate table
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.referrals;

-- referral_uses.referral_code should point at a real code. It is empty today,
-- so the constraint can be added without a backfill.
ALTER TABLE public.referral_uses
  DROP CONSTRAINT IF EXISTS referral_uses_referral_code_fkey;
ALTER TABLE public.referral_uses
  ADD CONSTRAINT referral_uses_referral_code_fkey
  FOREIGN KEY (referral_code) REFERENCES public.referral_codes(code) ON DELETE CASCADE;

-- Referrer lookups ("how many people used my code") hit this on every
-- Profile load once codes exist.
CREATE INDEX IF NOT EXISTS referral_uses_referrer_uid_idx
  ON public.referral_uses (referrer_uid);

-- ---------------------------------------------------------------------------
-- 1. Code generation
-- ---------------------------------------------------------------------------

-- Alphabet excludes 0/O/1/I/L — these codes get read aloud and typed from a
-- WhatsApp forward, and O-vs-0 is the classic support ticket.
CREATE OR REPLACE FUNCTION public.referral_random_code()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'EWE' || string_agg(
    substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ',
           (floor(random() * 31) + 1)::int, 1), '')
  FROM generate_series(1, 6);
$$;

-- Returns the caller's code, creating it on first call. This is what makes the
-- Profile card appear at all — the old read-only get_user_referral could never
-- produce a first row.
CREATE OR REPLACE FUNCTION public.get_or_create_referral_code(p_uid text)
RETURNS TABLE(code text, uses integer, credits_earned integer)
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
    SELECT rc.code, rc.uses, rc.credits_earned
    FROM referral_codes rc WHERE rc.user_id = p_uid;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Reward: premium days
-- ---------------------------------------------------------------------------

-- Extends an existing active subscription rather than inserting a second row,
-- because get_student_effective_plan() takes the first active row it finds —
-- two active rows would make the effective plan depend on scan order.
--
-- premium_monthly is the plan granted because it is a real plan_id in
-- quota_config (unlimited across every field). A made-up plan id like
-- 'referral_bonus' would miss quota_config entirely and silently fall back to
-- FREE_LIMITS in resolveQuota() — a "reward" that grants nothing.
CREATE OR REPLACE FUNCTION public.referral_grant_premium_days(p_uid text, p_days integer)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id      uuid;
  v_expires timestamptz;
BEGIN
  SELECT s.id, s.expires_at INTO v_id, v_expires
  FROM subscriptions s
  WHERE s.user_id = p_uid
    AND s.status = 'active'
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  ORDER BY s.expires_at DESC NULLS FIRST
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

  INSERT INTO subscriptions (user_id, plan, status, starts_at, expires_at, amount_paid)
  VALUES (p_uid, 'premium_monthly', 'active', NOW(),
          NOW() + make_interval(days => p_days), 0)
  RETURNING expires_at INTO v_expires;

  RETURN v_expires;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Redemption
-- ---------------------------------------------------------------------------

-- Returns a jsonb result rather than raising, because every failure here is a
-- normal thing a user can do (typo, own code, second attempt) and the UI wants
-- to show a specific message for each rather than a generic RPC error.
--
-- Guards, in order:
--   invalid_code     — no such code
--   self_referral    — own code
--   already_redeemed — this account already used one (also enforced by the
--                      UNIQUE on referral_uses.referred_uid, which is what
--                      actually closes the concurrent-double-submit race)
--   account_too_old  — account older than 30 days; stops an existing user base
--                      from referring each other in a circle after the fact
CREATE OR REPLACE FUNCTION public.redeem_referral_code(p_uid text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_days        constant integer := 7;
  v_code        text;
  v_referrer    text;
  v_created     timestamptz;
  v_expires     timestamptz;
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
    INSERT INTO referral_uses (referral_code, referred_uid, referrer_uid)
    VALUES (v_code, p_uid, v_referrer);
  EXCEPTION WHEN unique_violation THEN
    -- Lost the race against a concurrent submit from the same account.
    RETURN jsonb_build_object('ok', false, 'error', 'already_redeemed');
  END;

  UPDATE referral_codes
    SET uses = uses + 1,
        credits_earned = credits_earned + v_days
    WHERE code = v_code;

  PERFORM referral_grant_premium_days(v_referrer, v_days);
  v_expires := referral_grant_premium_days(p_uid, v_days);

  INSERT INTO user_notifications (user_id, type, title, body, link)
  VALUES (v_referrer, 'referral_converted',
          'Someone joined with your code',
          'You have earned ' || v_days || ' days of premium. Keep sharing!',
          '/profile');

  RETURN jsonb_build_object(
    'ok', true,
    'days_granted', v_days,
    'premium_until', v_expires
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Retire the read-only predecessor
-- ---------------------------------------------------------------------------

-- get_or_create_referral_code is a strict superset. Leaving a function around
-- that can only ever return zero rows is what made this system look finished
-- when it wasn't, so it goes rather than lingering as a second entry point.
DROP FUNCTION IF EXISTS public.get_user_referral(text);

COMMIT;
