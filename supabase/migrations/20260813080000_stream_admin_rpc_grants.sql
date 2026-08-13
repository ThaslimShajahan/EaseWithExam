-- Phase 3 blocker: the two stream-config admin RPCs are unreachable from the app.
--
-- 20260813040000 created admin_upsert_stream_config and
-- admin_upsert_board_language_config with EXECUTE granted to `authenticated`
-- only. That looks tighter than the rest of the admin surface, but in THIS
-- project it means "nobody at all":
--
--   Auth here is Firebase, not Supabase Auth. A Firebase ID token carries no
--   `role` claim, so PostgREST never switches the request role — every request
--   runs as `anon`, signed in or not. A grant to `authenticated` alone can
--   therefore never be exercised by the real app.
--
-- Proved empirically before writing this migration, using one genuine Firebase
-- ID token minted for a real superadmin (Admin SDK custom token -> Identity
-- Toolkit exchange) against two RPCs differing only in their grant:
--
--   admin_list_onboarding_options  (anon,authenticated) -> HTTP 200, real data
--   admin_upsert_stream_config     (authenticated)      -> HTTP 401, 42501
--                                     "permission denied for function"
--   admin_upsert_chapter_manifest  (authenticated)      -> HTTP 401, 42501
--
-- Same token, same caller, same instant — so the token is fine and the grant is
-- the blocker. The admin Streams editor surfaced this as
-- "Save failed: permission denied for function admin_upsert_stream_config"
-- on a real click-through; no amount of code review would have shown it.
--
-- Fix: grant EXECUTE to anon as well, matching every other admin RPC in this
-- project (admin_upsert_onboarding_option, admin_upsert_exam_category, ...).
-- This does NOT loosen security. The real gate is the assert_verified_admin
-- call inside each function body, which both already have as their first
-- statement and which this migration does not touch: an anon caller with no
-- verified Firebase identity still fails there with 42501, and a verified
-- non-admin fails there too. The grant only decides who may attempt the call;
-- the body decides who may complete it. That is the established pattern here,
-- not a new exception.
--
-- NOT fixed here, deliberately: admin_upsert_chapter_manifest and
-- admin_approve_chapter_manifest have the exact same broken grant (verified
-- above) and belong to the content-engine rebuild
-- (docs/REBUILD_HANDOFF.md), a separately phase-gated project. They are
-- equally unreachable today and will need this same one-line fix before that
-- thread's admin surface can save anything. Flagged to the owner rather than
-- fixed silently across a project boundary.

grant execute on function public.admin_upsert_stream_config(
  text, uuid, text, text, text, text, text[], jsonb, jsonb, jsonb, integer
) to anon, authenticated;

grant execute on function public.admin_upsert_board_language_config(
  text, uuid, text, text, text[], jsonb
) to anon, authenticated;

comment on function public.admin_upsert_stream_config(
  text, uuid, text, text, text, text, text[], jsonb, jsonb, jsonb, integer
) is
  'Admin upsert for stream_configs. Granted to anon by design: Firebase JWTs '
  'carry no role claim so every PostgREST request runs as anon; the real gate '
  'is the assert_verified_admin(p_caller) call in the body. See '
  '20260813080000 for the empirical proof behind that.';

comment on function public.admin_upsert_board_language_config(
  text, uuid, text, text, text[], jsonb
) is
  'Admin upsert for board_language_config. Granted to anon by design — same '
  'reasoning as admin_upsert_stream_config, see 20260813080000.';
