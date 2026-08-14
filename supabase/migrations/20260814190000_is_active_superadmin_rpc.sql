-- Superadmin-only ₹1 live-mode verification plan (2026-08-14) needs a way
-- for the STUDENT-facing session (Firebase-authenticated, useAuth()) to
-- check "is this logged-in uid also a superadmin" — distinct from the
-- separate admin-panel passcode session (sessionStorage edu_admin_rec_*),
-- which a student-facing page has no access to and shouldn't need.
-- admins.uid === users.firebase_uid for both current superadmins (verified
-- before building this), so a plain read against `admins` with the
-- student's own Firebase uid is the correct, minimal check.
--
-- Read-only, safe to expose broadly: the caller learns only true/false for
-- a uid they already control (their own currentUser.uid) — no other data
-- is returned. Same anon-inclusion reasoning as every other RPC tonight:
-- every PostgREST request runs as anon regardless of caller, so the grant
-- itself gates nothing; the query logic is the only real gate, and here
-- that logic returns false for anyone who isn't actually in `admins`.
CREATE OR REPLACE FUNCTION public.is_active_superadmin(p_uid text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM admins WHERE uid = p_uid AND role = 'superadmin' AND is_active = true
  );
$function$;

GRANT EXECUTE ON FUNCTION public.is_active_superadmin(text) TO anon, authenticated;
