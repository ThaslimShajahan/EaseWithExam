-- Drop the 2026-08-04/05 backup tables and the leftover debug introspection RPCs.
--
-- WHY: every one of these backup tables had RLS DISABLED while still being
-- exposed through PostgREST, so anyone holding the public anon key (which ships
-- in the client bundle by design) could read them directly by name. That fully
-- defeated the A1/A2/A3 RLS lockdown: `users` correctly returned 0 rows to anon
-- while `users_backup_20260804` returned all 17, and `admins_backup_20260804`
-- exposed `passcode_hash` — a 6-digit SHA-256 that brute-forces instantly,
-- which combined with AdminGuard's client-side passcode comparison made the
-- admin second factor worthless.
--
-- The content in these snapshots (knowledge_base 20,890 rows, pyq_questions
-- 2,934) is being deliberately discarded — it will be re-ingested from the
-- source PDFs rather than restored.
--
-- The _debug_get_* helpers are leftovers from the 2026-08-06 debugging batch
-- whose matching `drop_debug_helpers` migrations missed them. They were
-- anon-callable and returned full column/constraint/RLS-policy metadata for
-- any table, which is what made enumerating the above trivial.

begin;

drop table if exists public.admins_backup_20260804                    cascade;
drop table if exists public.centre_student_results_backup_20260804    cascade;
drop table if exists public.coaching_students_backup_20260804         cascade;
drop table if exists public.concept_misconceptions_backup_20260804    cascade;
drop table if exists public.daily_challenge_attempts_backup_20260804  cascade;
drop table if exists public.daily_challenge_history_backup_20260804   cascade;
drop table if exists public.daily_challenges_backup_20260804          cascade;
drop table if exists public.daily_usage_quota_backup_20260804         cascade;
drop table if exists public.doubt_chats_backup_20260804               cascade;
drop table if exists public.flashcard_progress_backup_20260804        cascade;
drop table if exists public.flashcards_backup_20260804                cascade;
drop table if exists public.in_app_notifications_backup_20260804      cascade;
drop table if exists public.knowledge_base_backup_20260804            cascade;
drop table if exists public.notification_prefs_backup_20260804        cascade;
drop table if exists public.paper_templates_backup_20260805           cascade;
drop table if exists public.parent_student_links_backup_20260804      cascade;
drop table if exists public.pyq_questions_backup_20260804             cascade;
drop table if exists public.question_history_backup_20260804          cascade;
drop table if exists public.quota_overrides_backup_20260804           cascade;
drop table if exists public.referral_codes_backup_20260804            cascade;
drop table if exists public.study_goals_backup_20260804               cascade;
drop table if exists public.study_notes_backup_20260804               cascade;
drop table if exists public.subscriptions_backup_20260804             cascade;
drop table if exists public.test_sessions_backup_20260804             cascade;
drop table if exists public.user_chapter_progress_backup_20260804     cascade;
drop table if exists public.user_daily_tasks_backup_20260804          cascade;
drop table if exists public.user_gamification_backup_20260804         cascade;
drop table if exists public.user_notifications_backup_20260804        cascade;
drop table if exists public.user_weak_topics_backup_20260804          cascade;
drop table if exists public.users_backup_20260804                     cascade;

drop function if exists public._debug_get_columns4(text[])     cascade;
drop function if exists public._debug_get_constraints3(text[]) cascade;
drop function if exists public._debug_get_policies4(text[])    cascade;

commit;
