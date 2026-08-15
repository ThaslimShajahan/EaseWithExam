-- Close the PUBLIC-grant hole on the three functions just added in
-- 20260815040000, caught by scripts/audit-admin-rpc-grants.mjs.
--
-- Postgres grants EXECUTE to PUBLIC on every new function by default, and
-- `anon` inherits it. 20260811140000 swept every admin_* function that
-- existed at the time; anything created since has to revoke it itself, and
-- three functions from 20260815040000 didn't. Not exploitable on its own —
-- assert_verified_admin's body-level verified_uid() check still refuses an
-- unauthenticated caller regardless of who can reach the function, confirmed
-- live for these three specifically — but the role gate is real defense in
-- depth per 20260809030000's own stated intent, and there is no reason for a
-- function written tonight to reopen a hole a migration four days earlier
-- closed.
--
-- Not fixed here: 18 OTHER pre-existing admin_* functions the same audit
-- script flags, none of them touched by this session's work. Flagged to the
-- project owner as a separate, unrelated finding — not swept up into this
-- migration, which stays scoped to what 20260815040000 introduced.

revoke execute on function public.admin_enqueue_content_job(text, text, text, text, text, text, uuid) from public;
revoke execute on function public.admin_claim_next_content_job(text, text, integer) from public;
revoke execute on function public.admin_requeue_content_job(text, uuid) from public;
