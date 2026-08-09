-- Admin visibility for the referral programme.
--
-- Referrals were previously only observable per-student on their own Profile
-- card, so there was no way for an admin to see who is referring, what is
-- pending, or what the programme has cost in comped premium days.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_list_referrals(p_caller text)
RETURNS TABLE(
  referrer_uid    text,
  referrer_name   text,
  referrer_email  text,
  code            text,
  conversions     integer,
  credits_earned  integer,
  pending         integer,
  referred_uid    text,
  referred_name   text,
  referred_email  text,
  converted       boolean,
  days_granted    integer,
  redeemed_at     timestamptz,
  converted_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT a.role INTO v_role FROM admins a WHERE a.uid = p_caller AND a.is_active = true;
  IF v_role IS NULL OR v_role NOT IN ('superadmin','admin') THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- LEFT JOIN from referral_codes, so a student who has generated a code but
  -- never had it used still appears (with a null referred_uid). Without that
  -- the screen silently hides everyone who has shared but not yet landed
  -- anyone — which early on is most of them.
  RETURN QUERY
  SELECT
    rc.user_id,
    ru_referrer.display_name,
    ru_referrer.email,
    rc.code,
    rc.uses,
    rc.credits_earned,
    (SELECT count(*)::int FROM referral_uses x
      WHERE x.referrer_uid = rc.user_id AND NOT x.converted),
    u.referred_uid,
    ru_referred.display_name,
    ru_referred.email,
    u.converted,
    u.days_granted,
    u.created_at,
    u.converted_at
  FROM referral_codes rc
  LEFT JOIN referral_uses u        ON u.referrer_uid = rc.user_id
  LEFT JOIN users ru_referrer      ON ru_referrer.firebase_uid = rc.user_id
  LEFT JOIN users ru_referred      ON ru_referred.firebase_uid = u.referred_uid
  ORDER BY u.created_at DESC NULLS LAST, rc.created_at DESC;
END;
$$;

COMMIT;
