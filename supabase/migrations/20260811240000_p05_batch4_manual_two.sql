-- P0.5 batch 4 — the two functions the generator could not touch.
--
-- scripts/gen-p05-guards.mjs only injects a guard when the first argument is
-- named p_caller, because it cannot know what any other name means. These two
-- name it p_uid. Reading them shows p_uid IS the caller in both cases, so both
-- take the same guard — but that had to be established from the bodies and the
-- call sites, not assumed from the shape.
--
--   admin_update_blueprint_override(p_uid, ...)
--     Its own comment says so: "Validate caller is an active admin ...
--     WHERE uid = p_uid". Straightforwardly p_caller under another name.
--     It has no client call site in src/ at all — it is reachable only over the
--     API, which makes an unguarded SECURITY DEFINER write worth closing.
--
--   admin_set_passcode(p_uid, p_hash)
--     AdminGuard.jsx:115 calls it with the signed-in admin's own uid, inside a
--     component already gated on onAuthStateChanged(adminAuth). It is a
--     first-time-only setup: it returns false when a passcode already exists,
--     so it cannot be used to overwrite one. p_uid is the caller setting their
--     own passcode, and assert_verified_admin(p_uid) — which requires
--     p_uid = verified_uid() — is exactly that rule.
--
-- TWO BEHAVIOURAL NOTES for admin_set_passcode, both deliberate:
--
--   1. It returned false on failure; the guard RAISES instead. The client
--      distinguishes `ok === false` (not an admin / already set) from `error`
--      (migration missing), so an unauthorised caller now lands in the error
--      branch and sees a misleading "run the latest migration" message. Only
--      unauthorised callers see it; a real admin's path is unchanged.
--
--   2. assert_verified_admin additionally requires role in
--      ('superadmin','admin'), which the original did not check — it only
--      required an active row. Both admin rows today are superadmin, so
--      nothing currently in the table is newly excluded.
--
-- Bodies are otherwise re-emitted exactly as pg_get_functiondef() returned
-- them, same as the generated batches.

begin;

CREATE OR REPLACE FUNCTION public.admin_set_passcode(p_uid text, p_hash text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_existing TEXT;
BEGIN
  PERFORM assert_verified_admin(p_uid);  -- P0.5
  SELECT passcode_hash INTO v_existing FROM admins WHERE uid = p_uid AND is_active = true;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_existing IS NOT NULL THEN RETURN false; END IF;
  UPDATE admins SET passcode_hash = p_hash WHERE uid = p_uid;
  RETURN true;
END; $function$;

CREATE OR REPLACE FUNCTION public.admin_update_blueprint_override(p_uid text, p_exam_type text, p_total_questions integer, p_total_marks integer, p_duration_minutes integer, p_sections jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM assert_verified_admin(p_uid);  -- P0.5

  -- Validate caller is an active admin
  IF NOT EXISTS (
    SELECT 1 FROM admins WHERE uid = p_uid AND is_active = true
  ) THEN
    RAISE EXCEPTION 'unauthorized: caller is not an active admin';
  END IF;

  UPDATE exam_blueprints
  SET
    total_questions  = COALESCE(p_total_questions,  total_questions),
    total_marks      = COALESCE(p_total_marks,      total_marks),
    duration_minutes = COALESCE(p_duration_minutes, duration_minutes),
    sections         = COALESCE(p_sections,         sections)
  WHERE exam_type = p_exam_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'exam_blueprints row not found for exam_type: %', p_exam_type;
  END IF;
END;
$function$;

commit;

-- After this, every admin_*/coaching_admin_* function is guarded except
-- admin_verify_passcode, which is the authentication step itself and must stay
-- reachable without the identity it establishes. Expected: 79/82 carrying
-- assert_verified_admin, plus coaching_admin_set_passcode and
-- admin_get_centre_invites checking verified_uid() directly = 81 of 82.
