-- Real bug, found live while testing the new merge feature: saving ANY chapter
-- manifest draft (new or edited) has been failing with "permission denied for
-- function admin_upsert_chapter_manifest" since 20260815030000 tonight.
--
-- NOT a stale PostgREST schema cache, which is what that migration's own
-- commit message guessed. Confirmed by reading the real grants directly
-- (pg_proc.proacl, bypasses PostgREST's cache entirely):
--
--   {postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- No `anon`. 20260815030000 wrote:
--   revoke all on function ... from public, anon;
--   grant execute on function ... to authenticated;
--
-- — the exact mistake 20260813080000 documented and named specifically to
-- prevent: Firebase third-party auth requests run as `anon` in PostgREST
-- (Firebase JWTs carry no Postgres `role` claim), so a grant to
-- `authenticated` alone makes the function unreachable for every real caller.
-- Every other admin_* RPC in this codebase grants `anon, authenticated`
-- together for exactly this reason; this one function was written against
-- the outdated assumption from four days earlier and never corrected.
--
-- assert_verified_admin(p_caller) in the function body is still the real
-- security boundary regardless of which Postgres role can reach it — this
-- is the same "anon can call it, the body still refuses anyone who isn't a
-- verified admin" shape as every RPC fixed earlier tonight, not a new
-- security question.

grant execute on function public.admin_upsert_chapter_manifest(
  text, uuid, text, text, text, text, text, text, jsonb, text, text
) to anon;
