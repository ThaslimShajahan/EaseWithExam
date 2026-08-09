-- Admin authorization hardening.
--
-- VERIFIED LIVE EXPLOIT this closes: every admin_* RPC takes the caller's
-- Firebase UID as a plain `p_caller text` parameter and trusts it, because
-- Firebase Auth isn't integrated with Postgres so auth.uid() is NULL. The one
-- thing standing between an attacker and full admin was that UID being secret
-- — and `changelog` was anon-readable with 1,041 rows carrying
-- actor_uid + actor_role='superadmin'. Two requests with the PUBLIC anon key
-- (which ships in the JS bundle) were enough:
--
--   GET  /rest/v1/changelog?actor_uid=not.is.null      -> superadmin UID
--   POST /rest/v1/rpc/admin_list_users {p_caller:UID}  -> every user's PII
--
-- Separately, `get_admin_record` returned `passcode_hash` to any anon caller,
-- and AdminGuard compared the passcode in the BROWSER — so the second factor
-- was both leakable and bypassable (sessionStorage.edu_admin_v1 = '1').
--
-- This migration closes both. It does NOT fix the underlying model — p_caller
-- is still an unverified parameter. That requires verifying Firebase ID tokens
-- server-side (Supabase third-party auth), which is a coordinated
-- frontend + database change and is tracked separately.

begin;

/* ── 1. Stop leaking admin UIDs through the audit log ─────────────────── */

-- Admin reads already go through admin_get_activity_log() (an admins-checked
-- SECURITY DEFINER RPC used by AdminActivityLog.jsx). The only direct client
-- read was changelog.js's getEntityHistory(), which has zero call sites.
-- INSERT stays open: writes are already forgeable because the actor is
-- resolved from sessionStorage client-side, so gating them here would add
-- ceremony without integrity. Real fix is token verification (see header).
drop policy if exists changelog_read_authenticated on public.changelog;
drop policy if exists cl_select                    on public.changelog;

/* ── 2. Move passcode verification server-side ────────────────────────── */

alter table public.admins
  add column if not exists passcode_attempts     integer     not null default 0,
  add column if not exists passcode_locked_until timestamptz;

-- get_admin_record must stop handing out the hash. Returns has_passcode so
-- AdminGuard can still tell "first-time setup" from "verify" without ever
-- seeing the secret.
drop function if exists public.get_admin_record(text);

create or replace function public.get_admin_record(p_uid text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'uid',           uid,
    'email',         email,
    'name',          name,
    'role',          role,
    'has_passcode',  passcode_hash is not null
  )
  from admins
  where uid = p_uid and is_active = true;
$$;

grant execute on function public.get_admin_record(text) to anon, authenticated;

-- Verifies a passcode hash server-side with attempt limiting. The client
-- sends SHA-256(passcode) and only ever learns pass/fail — it never receives
-- the stored hash, so a 6-digit space can no longer be brute-forced offline.
create or replace function public.admin_verify_passcode(p_uid text, p_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rec         admins%rowtype;
  v_max_tries   constant integer  := 5;
  v_lockout     constant interval := interval '15 minutes';
begin
  select * into v_rec from admins where uid = p_uid and is_active = true;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_admin');
  end if;

  if v_rec.passcode_locked_until is not null and v_rec.passcode_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_rec.passcode_locked_until);
  end if;

  if v_rec.passcode_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'no_passcode_set');
  end if;

  if v_rec.passcode_hash = p_hash then
    update admins set passcode_attempts = 0, passcode_locked_until = null, updated_at = now()
    where uid = p_uid;
    return jsonb_build_object('ok', true);
  end if;

  update admins
     set passcode_attempts     = coalesce(passcode_attempts, 0) + 1,
         passcode_locked_until = case
           when coalesce(passcode_attempts, 0) + 1 >= v_max_tries then now() + v_lockout
           else passcode_locked_until end,
         updated_at = now()
   where uid = p_uid
   returning * into v_rec;

  if v_rec.passcode_locked_until is not null and v_rec.passcode_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', v_rec.passcode_locked_until);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'wrong',
                            'attempts_left', greatest(v_max_tries - v_rec.passcode_attempts, 0));
end;
$$;

grant execute on function public.admin_verify_passcode(text, text) to anon, authenticated;

commit;
