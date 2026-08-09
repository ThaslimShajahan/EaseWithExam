-- Part B (Batch 9): lets phone-signup students (no email on file) add one for
-- notification delivery only — a stored field + verification code, not a
-- second real Firebase auth method (this account never needs to log in with
-- the email, just receive mail at it).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS pending_email             text,
  ADD COLUMN IF NOT EXISTS pending_email_code_hash   text,
  ADD COLUMN IF NOT EXISTS pending_email_requested_at timestamptz;

-- Prevents two accounts from ever both claiming the same verified email —
-- the actual account-integrity backstop for the "someone tries to connect
-- an email already used by a different account" edge case. A partial index
-- (not a plain UNIQUE) because most rows have email = null and null never
-- collides with null in a unique index anyway, but being explicit here.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
  ON users (lower(email)) WHERE email IS NOT NULL;

-- Confirms a pending email with its 6-digit code, promoting it to the real
-- `email` column. The code itself is generated + hashed + emailed entirely
-- server-side (connect-email edge function) — this RPC never sees or
-- generates the plaintext code, only compares hashes, so there's no path
-- where the client could self-verify without actually receiving the email.
CREATE OR REPLACE FUNCTION confirm_email_connect(p_uid text, p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row record;
  v_code_hash text;
BEGIN
  SELECT pending_email, pending_email_code_hash, pending_email_requested_at
    INTO v_row
    FROM users WHERE firebase_uid = p_uid;

  IF v_row.pending_email IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_pending_email');
  END IF;

  IF v_row.pending_email_requested_at < now() - interval '30 minutes' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'code_expired');
  END IF;

  v_code_hash := encode(digest(p_code, 'sha256'), 'hex');
  IF v_code_hash IS DISTINCT FROM v_row.pending_email_code_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_code');
  END IF;

  -- Re-check for a race: someone else could have claimed this exact email
  -- between the original request and this confirm. The unique index below
  -- is the real backstop (this UPDATE would fail on it), but checking first
  -- gives a clean, specific error message instead of a raw constraint error.
  IF EXISTS (
    SELECT 1 FROM users
    WHERE lower(email) = lower(v_row.pending_email) AND firebase_uid <> p_uid
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'email_taken');
  END IF;

  UPDATE users
    SET email = v_row.pending_email,
        pending_email = NULL,
        pending_email_code_hash = NULL,
        pending_email_requested_at = NULL
    WHERE firebase_uid = p_uid;

  RETURN jsonb_build_object('ok', true);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'email_taken');
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_email_connect(text, text) TO anon, authenticated;
