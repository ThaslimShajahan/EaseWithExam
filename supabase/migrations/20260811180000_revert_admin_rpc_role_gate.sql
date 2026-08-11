-- REVERT the role gate from 20260811140000_admin_rpc_public_grant_lockdown.sql.
--
-- It locked out every legitimate admin, in production.
--
-- WHAT I GOT WRONG
--   20260809030000_verified_identity.sql states that "a caller presenting only
--   the anon key gets the `anon` Postgres role; a caller presenting a valid
--   Firebase ID token gets `authenticated`", and I built the role gate on that
--   sentence without testing it. It is not true for this project.
--
--   PostgREST picks the Postgres role from the JWT's `role` claim. A Firebase
--   ID token has no `role` claim, so every request — signed in or not — runs as
--   `anon`. Supabase still validates the token and populates auth.jwt(), which
--   is why verified_uid() works and why the premise looked plausible.
--
--   Measured against production with a real Firebase ID token minted for the
--   superadmin (sub = 2gPm50tCEme5sZebbB5YlQW6R012):
--
--     verified_uid()           -> 200  "2gPm50tCEme5sZebbB5YlQW6R012"
--     admin_get_feature_flags  -> 401  42501 permission denied
--
--   verified_uid() is granted to anon AND authenticated; the admin RPCs were
--   granted to authenticated only. Succeeding on one and failing on the other
--   with the same token proves the request runs as anon. So
--   `grant execute ... to authenticated` granted to nobody, and revoking PUBLIC
--   removed the only grant that admins had ever used.
--
--   The damage was broad and presented in two different ways, which is why it
--   read as several unrelated bugs: components that inspect `error` showed
--   "permission denied" (Feature Flags, Publish), while components doing
--   `data ?? []` silently rendered "None yet" over populated tables
--   (Categories 46 rows, Email Templates 4 rows, Onboarding 22 rows).
--
-- WHAT THIS RESTORES
--   The grant state from before 20260811140000. That means the anon bypass is
--   open again — anyone with the public anon key plus a known admin UID can
--   call these. That is the status quo of the last several months, and it is
--   strictly better than an admin panel nobody can use. It is NOT the end
--   state.
--
-- WHAT ACTUALLY CLOSES THE BYPASS
--   Not a role gate — that mechanism cannot work while every request is `anon`.
--   The working mechanism is the function body check, because verified_uid()
--   IS reliable: assert_verified_admin(p_caller) already blocks anon callers
--   (it raises when verified_uid() is null) and it is what made admin_list_users
--   and admin_delete_student resist the bypass in the original probe. Applying
--   it to the remaining functions is P0.5, and it needs no grant changes.
--
--   The two functions 20260811140000 rewrote — coaching_admin_set_passcode and
--   admin_get_centre_invites — are deliberately NOT reverted. They had no
--   authorisation of any kind, and their new bodies check verified_uid()
--   directly, so they stay protected without depending on the role.

begin;

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select p.oid::regprocedure::text as sig, p.proname
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and (p.proname like 'admin\_%' or p.proname like 'coaching\_admin\_%')
      -- These two now enforce verified_uid() in their own bodies, so leaving
      -- them ungranted to anon would break the admin panel for no benefit,
      -- while granting them back costs nothing: the body still refuses.
  loop
    execute format('grant execute on function %s to anon', r.sig);
    execute format('grant execute on function %s to authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    n := n + 1;
  end loop;

  raise notice 'admin RPC execute restored to anon on % function(s)', n;
end $$;

commit;

-- AFTER PUSHING THIS
--   1. Admin panel must work again: Feature Flags, Publish, Categories,
--      Email Templates, Onboarding Options all populate.
--   2. scripts/audit-admin-rpc-grants.mjs will report FAIL again. That is
--      expected and correct — the bypass is genuinely open until P0.5 lands
--      assert_verified_admin() in the function bodies.
