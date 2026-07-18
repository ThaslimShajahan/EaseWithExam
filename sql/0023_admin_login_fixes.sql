-- ═══════════════════════════════════════════════════════════════════
-- Migration 0023 — Admin login separation + super admin seed
-- Run this in: Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Add admin_set_passcode RPC (first-time setup only) ────────
--    Security: only works when passcode_hash IS NULL in the DB.
--    Once set, use admin_upsert (requires another admin as caller).
CREATE OR REPLACE FUNCTION admin_set_passcode(p_uid TEXT, p_hash TEXT)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing TEXT;
BEGIN
  SELECT passcode_hash INTO v_existing
  FROM admins
  WHERE uid = p_uid AND is_active = true;

  IF NOT FOUND THEN
    RETURN false;  -- UID not in admins table
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN false;  -- Passcode already set; use admin_upsert to change it
  END IF;

  UPDATE admins SET passcode_hash = p_hash WHERE uid = p_uid;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_set_passcode(TEXT, TEXT) TO anon, authenticated;


-- ── 2. Seed super admin: thaslimshajahans@gmail.com ─────────────
--
--    STEP 1: Find the Firebase UID for this email.
--    Go to: Firebase Console → Build → Authentication → Users
--    Search for "thaslimshajahans@gmail.com" and copy the User UID.
--
--    STEP 2: Replace 'PASTE_FIREBASE_UID_HERE' below with that UID.
--    STEP 3: Run this block in Supabase SQL Editor.
--
INSERT INTO admins (uid, email, name, role, passcode_hash, is_active, created_at)
VALUES (
  'PASTE_FIREBASE_UID_HERE',   -- ← replace this
  'thaslimshajahans@gmail.com',
  'Thaslim (Super Admin)',
  'superadmin',
  NULL,                         -- Will be set on first login via the setup screen
  true,
  now()
)
ON CONFLICT (uid) DO UPDATE SET
  role      = 'superadmin',
  email     = EXCLUDED.email,
  is_active = true;


-- ── 3. Verify ───────────────────────────────────────────────────
SELECT uid, email, name, role, is_active,
       CASE WHEN passcode_hash IS NULL THEN 'not set (setup on first login)' ELSE 'set' END AS passcode_status
FROM admins
WHERE email = 'thaslimshajahans@gmail.com';
