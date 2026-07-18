-- ═══════════════════════════════════════════════════════════════════
-- Migration 0025 — Coaching staff email invites
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Lets a coaching centre_admin (or platform admin) invite staff by EMAIL
-- instead of requiring a manually-looked-up Firebase UID. The invited person
-- gets a shareable link; when they sign in with Google, their email is
-- checked against the invite (this IS the access-control boundary — same
-- "only these emails are allowed" policy as today, just automated).
--
-- Assumes coaching_admins.uid is unique (coaching_admin_upsert already
-- upserts on it) — if that's not the case, adjust the ON CONFLICT clause
-- in redeem_coaching_admin_invite below before running.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS coaching_admin_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id     uuid NOT NULL REFERENCES coaching_centres(id) ON DELETE CASCADE,
  email         text NOT NULL,
  name          text,
  role          text NOT NULL DEFAULT 'instructor' CHECK (role IN ('instructor', 'centre_admin')),
  invite_code   text NOT NULL UNIQUE,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  redeemed_at   timestamptz,
  redeemed_uid  text
);

ALTER TABLE coaching_admin_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON coaching_admin_invites FROM anon, authenticated;
-- No direct table grants — every access goes through the SECURITY DEFINER
-- RPCs below, each of which does its own caller-authorization check
-- (this is the exact pattern several existing RPCs were found to be
-- missing — don't drop the checks below when adapting this).

-- ── 1. Create an invite ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_coaching_admin_invite(
  p_caller text, p_centre_id uuid, p_email text, p_name text, p_role text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_code text;
  v_authorized boolean := false;
BEGIN
  SELECT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) INTO v_authorized;
  IF NOT v_authorized THEN
    SELECT EXISTS(
      SELECT 1 FROM coaching_admins
      WHERE uid = p_caller AND centre_id = p_centre_id AND role = 'centre_admin' AND is_active = true
    ) INTO v_authorized;
  END IF;
  IF NOT v_authorized THEN RAISE EXCEPTION 'unauthorized'; END IF;

  IF p_role NOT IN ('instructor', 'centre_admin') THEN
    RAISE EXCEPTION 'invalid role';
  END IF;

  v_code := encode(gen_random_bytes(6), 'hex');

  INSERT INTO coaching_admin_invites (centre_id, email, name, role, invite_code, created_by)
  VALUES (p_centre_id, lower(trim(p_email)), NULLIF(trim(p_name), ''), p_role, v_code, p_caller);

  RETURN jsonb_build_object('invite_code', v_code);
END;
$$;
GRANT EXECUTE ON FUNCTION create_coaching_admin_invite(text, uuid, text, text, text) TO anon, authenticated;

-- ── 2. Public preview (no auth — shown before sign-in) ──────────────
CREATE OR REPLACE FUNCTION get_coaching_admin_invite_preview(p_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row record;
BEGIN
  SELECT i.email, i.name, i.role, i.expires_at, i.redeemed_at,
         c.name AS centre_name, c.logo_url AS centre_logo_url, c.brand_color AS centre_brand_color
  INTO v_row
  FROM coaching_admin_invites i
  JOIN coaching_centres c ON c.id = i.centre_id
  WHERE i.invite_code = p_code;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invite_not_found'); END IF;
  IF v_row.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_redeemed'); END IF;
  IF v_row.expires_at < now() THEN RETURN jsonb_build_object('error', 'expired'); END IF;

  RETURN to_jsonb(v_row);
END;
$$;
GRANT EXECUTE ON FUNCTION get_coaching_admin_invite_preview(text) TO anon, authenticated;

-- ── 3. Redeem — the actual access-control boundary is the email check ──
CREATE OR REPLACE FUNCTION redeem_coaching_admin_invite(p_code text, p_uid text, p_email text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_inv record;
BEGIN
  SELECT * INTO v_inv FROM coaching_admin_invites WHERE invite_code = p_code FOR UPDATE;

  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'invite_not_found'); END IF;
  IF v_inv.redeemed_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'already_redeemed'); END IF;
  IF v_inv.expires_at < now() THEN RETURN jsonb_build_object('error', 'expired'); END IF;
  IF lower(trim(p_email)) <> v_inv.email THEN
    RETURN jsonb_build_object('error', 'email_mismatch');
  END IF;

  INSERT INTO coaching_admins (uid, email, name, centre_id, role, is_active, created_at)
  VALUES (p_uid, v_inv.email, COALESCE(v_inv.name, split_part(v_inv.email, '@', 1)), v_inv.centre_id, v_inv.role, true, now())
  ON CONFLICT (uid) DO UPDATE SET
    centre_id = EXCLUDED.centre_id, role = EXCLUDED.role, is_active = true;

  UPDATE coaching_admin_invites SET redeemed_at = now(), redeemed_uid = p_uid WHERE id = v_inv.id;

  RETURN jsonb_build_object('success', true, 'centre_id', v_inv.centre_id, 'role', v_inv.role);
END;
$$;
GRANT EXECUTE ON FUNCTION redeem_coaching_admin_invite(text, text, text) TO anon, authenticated;

-- ── 4. List invites for a centre (admin UI) ─────────────────────────
CREATE OR REPLACE FUNCTION list_coaching_admin_invites(p_caller text, p_centre_id uuid) RETURNS SETOF coaching_admin_invites
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true)
     AND NOT EXISTS(SELECT 1 FROM coaching_admins WHERE uid = p_caller AND centre_id = p_centre_id AND is_active = true) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY SELECT * FROM coaching_admin_invites WHERE centre_id = p_centre_id ORDER BY created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION list_coaching_admin_invites(text, uuid) TO anon, authenticated;

-- ── 5. Revoke an unredeemed invite ──────────────────────────────────
CREATE OR REPLACE FUNCTION revoke_coaching_admin_invite(p_caller text, p_invite_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    IF NOT EXISTS(
      SELECT 1 FROM coaching_admin_invites i
      JOIN coaching_admins ca ON ca.centre_id = i.centre_id
      WHERE i.id = p_invite_id AND ca.uid = p_caller AND ca.role = 'centre_admin' AND ca.is_active = true
    ) THEN
      RAISE EXCEPTION 'unauthorized';
    END IF;
  END IF;
  DELETE FROM coaching_admin_invites WHERE id = p_invite_id AND redeemed_at IS NULL;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION revoke_coaching_admin_invite(text, uuid) TO anon, authenticated;
