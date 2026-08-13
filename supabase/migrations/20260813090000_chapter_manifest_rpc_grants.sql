-- Same bug as 20260813080000, same fix, other project thread.
--
-- admin_upsert_chapter_manifest and admin_approve_chapter_manifest were
-- created (20260813010000, content-engine rebuild Phase 1) with EXECUTE
-- granted to `authenticated` only. As established in 20260813080000, that
-- means unreachable, not "tighter":
--
--   Auth here is Firebase, not Supabase Auth. A Firebase ID token carries no
--   `role` claim, so PostgREST never switches the request role — every request
--   runs as `anon`, signed in or not. A grant to `authenticated` alone can
--   never be exercised by the real app.
--
-- Proved with a genuine Firebase ID token minted for a real superadmin, sent
-- to RPCs differing only in their grant, same instant:
--
--   admin_list_onboarding_options (anon,authenticated) -> HTTP 200, real data
--   admin_upsert_chapter_manifest (authenticated)      -> HTTP 401, 42501
--                                    "permission denied for function"
--
-- Nothing in the app calls these yet — the content-engine rebuild's Phase 2
-- (Study Notes write path) hasn't been built (docs/REBUILD_HANDOFF.md §5), so
-- this has never produced a user-visible failure. It would have, on the first
-- save of that phase. Fixed now, on owner instruction, rather than left as a
-- landmine for whoever picks that thread up.
--
-- This does NOT loosen security. The real gate is the assert_verified_admin
-- call inside each body, which both already have and which this migration
-- does not touch. The grant decides who may attempt the call; the body decides
-- who may complete it.
--
-- General rule for this codebase, now stated in three places (this file,
-- 20260813080000, docs/STREAM_SELECTION_HANDOFF.md §11): never grant an RPC to
-- `authenticated` alone. Grant to `anon, authenticated` and gate in the body.

grant execute on function public.admin_upsert_chapter_manifest(
  text, uuid, text, text, text, text, text, text, jsonb, text
) to anon, authenticated;

grant execute on function public.admin_approve_chapter_manifest(text, uuid)
  to anon, authenticated;

comment on function public.admin_upsert_chapter_manifest(
  text, uuid, text, text, text, text, text, text, jsonb, text
) is
  'Admin upsert for chapter_manifests. Granted to anon by design: Firebase '
  'JWTs carry no role claim so every PostgREST request runs as anon; the real '
  'gate is assert_verified_admin(p_caller) in the body. See 20260813090000.';

comment on function public.admin_approve_chapter_manifest(text, uuid) is
  'Admin approval for chapter_manifests. Granted to anon by design — same '
  'reasoning as admin_upsert_chapter_manifest, see 20260813090000.';
