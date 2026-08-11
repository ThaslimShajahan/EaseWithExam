-- Close the admin RPC bypass that 20260809030000_verified_identity.sql intended
-- to close but did not.
--
-- THE BUG
--   That migration's "Layer 1" role gate loops over every admin_*/
--   coaching_admin_* function and runs:
--
--       revoke execute on function <sig> from anon;
--       grant  execute on function <sig> to authenticated;
--
--   Postgres grants EXECUTE on every new function to PUBLIC by default, and
--   `anon` inherits PUBLIC. Revoking from `anon` alone therefore changes
--   nothing: the PUBLIC grant survives and still confers EXECUTE.
--
--   Confirmed against production on 2026-08-11. Every one of the 82
--   admin_*/coaching_admin_* functions carried an ACL of the form:
--
--       =X/postgres | postgres=X/postgres | authenticated=X/postgres | ...
--        ^^^^^^^^^^ empty grantee == PUBLIC still holds EXECUTE
--
--   And empirically, with nothing but the public anon key:
--
--       admin_search_users(<known admin uid>, 'a', 50)  -> 200, all users
--       admin_get_user(<known admin uid>, <uid>)        -> 200, full PII row
--       admin_list_coaching_centres(<known admin uid>)  -> 200, data
--       admin_list_users(<known admin uid>)             -> 401  (Layer 2 held)
--
--   Only the two Layer-2 functions resisted, because assert_verified_admin()
--   checks the JWT rather than relying on the grant.
--
-- WHY REVOKING FROM PUBLIC IS SAFE FOR THE ADMIN PANEL
--   src/lib/supabase.js:39 attaches the Firebase ID token to every Supabase
--   request, so a signed-in admin is `authenticated`, not `anon`. The panel
--   already calls admin_list_users — which is Layer-2 bound and so already
--   requires a verified token — from src/lib/supabase.js:295. That call
--   working in production is the proof that this migration cannot lock admins
--   out: it demands strictly less than a call the panel already makes.
--
-- WHAT THIS DOES NOT FIX
--   78 of the 82 functions still authorise from a caller-supplied `p_caller`
--   string checked against the admins table (via is_active_admin). After this
--   migration an anon-key caller is blocked, but any *signed-in* user could
--   still pass a known admin UID. Closing that means adding
--   assert_verified_admin() to each function body — tracked separately, and
--   the reason this file is a role gate rather than the whole answer.

begin;

/* ── 1. Revoke the PUBLIC grant across the admin RPC surface ──────────── */

do $$
declare
  r record;
  n_revoked int := 0;
  -- admin_verify_passcode is the authentication step itself: AdminGuard calls
  -- it before any admin identity exists, so it must remain reachable without
  -- one. It is rate limited and returns no data. (get_admin_record is likewise
  -- anon-callable but does not match the name patterns below, so it is
  -- untouched here.)
  keep_anon text[] := array['admin_verify_passcode'];
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname like 'coaching\_admin\_%')
  loop
    if r.proname = any(keep_anon) then
      continue;
    end if;

    -- PUBLIC is the one that actually mattered. anon is revoked too so the
    -- ACL reads unambiguously rather than relying on inheritance.
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon',   r.sig);
    execute format('grant  execute on function %s to authenticated', r.sig);
    execute format('grant  execute on function %s to service_role', r.sig);
    n_revoked := n_revoked + 1;
  end loop;

  raise notice 'admin RPC PUBLIC grant revoked on % function(s)', n_revoked;
end $$;

/* ── 2. coaching_admin_set_passcode — account takeover, no auth at all ── */

-- Previously: SECURITY DEFINER, zero authorisation, and it sets the passcode
-- hash for ANY active coaching admin by uid. Anyone able to call it could set
-- a known passcode on someone else's account and then sign in as them. The
-- role gate above stops anon callers, but a signed-in student could still do
-- it, so the function needs its own check regardless.
--
-- The client only ever calls this with the signed-in user's own uid
-- (CoachingPortalGuard.jsx:218 passes currentUser.uid), so binding p_uid to
-- the verified JWT subject closes the hole without changing the signature or
-- the call site.
create or replace function public.coaching_admin_set_passcode(p_uid text, p_passcode text)
returns json
language plpgsql
security definer
set search_path = public
as $function$
declare v_sub text;
begin
  v_sub := public.verified_uid();

  if v_sub is null then
    raise exception 'Access denied: unverified caller' using errcode = '42501';
  end if;

  if p_uid is null or p_uid <> v_sub then
    -- Setting someone else's passcode is the takeover this closes.
    raise exception 'Access denied: caller mismatch' using errcode = '42501';
  end if;

  -- Client sends a pre-hashed hex string (SHA-256 in the browser via Web
  -- Crypto) and it is stored as given — unchanged from the original.
  update coaching_admins
     set passcode_hash = p_passcode
   where uid = p_uid and is_active = true;

  if not found then
    raise exception 'Access denied: not an active coaching admin' using errcode = '42501';
  end if;

  return json_build_object('ok', true);
end;
$function$;

/* ── 3. admin_get_centre_invites — unauthenticated invite-code disclosure ─ */

-- Also had no check of any kind: any caller holding a centre uuid could list
-- that centre's invite codes, including inactive and unexpired ones. Its only
-- call site is AdminCoaching.jsx:365, so requiring a verified active admin
-- matches actual usage and needs no signature or client change.
create or replace function public.admin_get_centre_invites(p_centre_id uuid)
returns table (
  id uuid, invite_code text, batch text, max_uses integer,
  used_count integer, expires_at timestamptz, is_active boolean, created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $function$
begin
  if not public.is_active_admin(public.verified_uid()) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  return query
    select ci.id, ci.invite_code, ci.batch, ci.max_uses, ci.used_count,
           ci.expires_at, ci.is_active, ci.created_at
      from centre_invites ci
     where ci.centre_id = p_centre_id
     order by ci.created_at desc;
end;
$function$;

/* ── 4. Keep the two rewritten functions inside the role gate ─────────── */

-- CREATE OR REPLACE on an existing function preserves its ACL, but these are
-- re-declared above and a fresh declaration would otherwise pick up the
-- default PUBLIC grant again. Restated explicitly so the outcome does not
-- depend on which of those two behaviours applies.
revoke execute on function public.coaching_admin_set_passcode(text, text) from public, anon;
grant  execute on function public.coaching_admin_set_passcode(text, text) to authenticated, service_role;

revoke execute on function public.admin_get_centre_invites(uuid) from public, anon;
grant  execute on function public.admin_get_centre_invites(uuid) to authenticated, service_role;

commit;

-- NOTE FOR FUTURE MIGRATIONS
--   A newly created function is granted EXECUTE to PUBLIC automatically. Any
--   migration adding an admin_*/coaching_admin_* function must revoke it, or
--   this hole silently reopens for that function. scripts/audit-admin-rpc-grants.mjs
--   detects that and should be run after any migration that adds one.
