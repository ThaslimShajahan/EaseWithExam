-- Rollback for 20260926020000_lock_remaining_tables.sql.
--
-- ORDER: restore the previous web bundle FIRST (the new one calls
-- save_important_qa / save_topic_frequency / log_change), then run this.
-- It deliberately REOPENS every hole that migration closed (open caches,
-- open admin tables, forgeable changelog, public admin uids, anon-readable
-- knowledge_base) and returns XP/test-result writes to their never-working
-- `TO authenticated` state. Use only to recover from an outage.
-- The new RPCs are left in place (unused by the old bundle).
-- Generated from the live database 2026-09-25.

-- 1. Drop the policies the migration created
drop policy if exists gamification_read_own_or_admin on public.user_gamification;
drop policy if exists gamification_admin_write on public.user_gamification;
drop policy if exists test_sessions_read_own_or_admin on public.test_sessions;
drop policy if exists test_sessions_insert_own on public.test_sessions;
drop policy if exists test_sessions_update_own on public.test_sessions;
drop policy if exists test_sessions_admin_write on public.test_sessions;
drop policy if exists quota_read_own_or_admin on public.daily_usage_quota;
drop policy if exists quota_admin_write on public.daily_usage_quota;
drop policy if exists chapter_progress_own on public.user_chapter_progress;
drop policy if exists chapter_progress_admin_read on public.user_chapter_progress;
drop policy if exists daily_tasks_own on public.user_daily_tasks;
drop policy if exists daily_tasks_admin_read on public.user_daily_tasks;
drop policy if exists study_goals_own on public.study_goals;
drop policy if exists study_goals_admin_read on public.study_goals;
drop policy if exists important_qa_read_signed_in on public.important_qa;
drop policy if exists important_qa_admin_write on public.important_qa;
drop policy if exists topic_frequency_read_signed_in on public.topic_frequency;
drop policy if exists topic_frequency_admin_write on public.topic_frequency;
drop policy if exists question_cache_admin_only on public.question_cache;
drop policy if exists monitored_sources_admin_only on public.monitored_sources;
drop policy if exists question_papers_admin_only on public.question_papers;
drop policy if exists crawl_jobs_admin_only on public.crawl_jobs;
drop policy if exists crawl_pdfs_admin_only on public.crawl_pdfs;
drop policy if exists misconceptions_read_own_or_admin on public.concept_misconceptions;
drop policy if exists content_versions_admin_only on public.content_versions;
drop policy if exists knowledge_base_read_signed_in on public.knowledge_base;

-- 2. Recreate the original policies exactly as they were
create policy changelog_insert_authenticated on public.changelog as PERMISSIVE for INSERT to authenticated with check (true);
create policy cl_insert on public.changelog as PERMISSIVE for INSERT to anon, authenticated with check (true);
create policy cm_insert on public.concept_misconceptions as PERMISSIVE for INSERT to anon, authenticated with check (true);
create policy cm_select on public.concept_misconceptions as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy cm_update on public.concept_misconceptions as PERMISSIVE for UPDATE to anon, authenticated using (true);
create policy misconceptions_insert_self on public.concept_misconceptions as PERMISSIVE for INSERT to authenticated with check ((user_id = (auth.uid())::text));
create policy misconceptions_select_self on public.concept_misconceptions as PERMISSIVE for SELECT to authenticated using ((user_id = (auth.uid())::text));
create policy misconceptions_update_self on public.concept_misconceptions as PERMISSIVE for UPDATE to authenticated using ((user_id = (auth.uid())::text)) with check ((user_id = (auth.uid())::text));
create policy content_versions_insert_authenticated on public.content_versions as PERMISSIVE for INSERT to authenticated with check (true);
create policy content_versions_read_authenticated on public.content_versions as PERMISSIVE for SELECT to authenticated using (true);
create policy cv_insert on public.content_versions as PERMISSIVE for INSERT to anon, authenticated with check (true);
create policy cv_select on public.content_versions as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy crawl_jobs_anon_all on public.crawl_jobs as PERMISSIVE for ALL to anon using (true) with check (true);
create policy crawl_jobs_open on public.crawl_jobs as PERMISSIVE for ALL to public using (true) with check (true);
create policy crawl_pdfs_anon_all on public.crawl_pdfs as PERMISSIVE for ALL to anon using (true) with check (true);
create policy crawl_pdfs_open on public.crawl_pdfs as PERMISSIVE for ALL to public using (true) with check (true);
create policy quota_read_temporary_open on public.daily_usage_quota as PERMISSIVE for SELECT to public using (true);
create policy quota_self_insert on public.daily_usage_quota as PERMISSIVE for INSERT to authenticated with check ((user_id = verified_uid()));
create policy quota_self_update on public.daily_usage_quota as PERMISSIVE for UPDATE to authenticated using ((user_id = verified_uid())) with check ((user_id = verified_uid()));
create policy important_qa_open on public.important_qa as PERMISSIVE for ALL to public using (true) with check (true);
create policy knowledge_base_select on public.knowledge_base as PERMISSIVE for SELECT to public using (true);
create policy monitored_sources_open on public.monitored_sources as PERMISSIVE for ALL to public using (true) with check (true);
create policy question_cache_open on public.question_cache as PERMISSIVE for ALL to public using (true) with check (true);
create policy question_papers_open on public.question_papers as PERMISSIVE for ALL to public using (true) with check (true);
create policy study_goals_open on public.study_goals as PERMISSIVE for ALL to public using (true) with check (true);
create policy test_sessions_read_temporary_open on public.test_sessions as PERMISSIVE for SELECT to public using (true);
create policy test_sessions_self_insert on public.test_sessions as PERMISSIVE for INSERT to authenticated with check ((firebase_uid = verified_uid()));
create policy test_sessions_self_update on public.test_sessions as PERMISSIVE for UPDATE to authenticated using ((firebase_uid = verified_uid())) with check ((firebase_uid = verified_uid()));
create policy topic_frequency_open on public.topic_frequency as PERMISSIVE for ALL to public using (true) with check (true);
create policy chapter_progress_open on public.user_chapter_progress as PERMISSIVE for ALL to public using (true) with check (true);
create policy daily_tasks_open on public.user_daily_tasks as PERMISSIVE for ALL to public using (true) with check (true);
create policy gamification_read_temporary_open on public.user_gamification as PERMISSIVE for SELECT to public using (true);
create policy gamification_self_insert on public.user_gamification as PERMISSIVE for INSERT to authenticated with check ((user_id = verified_uid()));
create policy gamification_self_update on public.user_gamification as PERMISSIVE for UPDATE to authenticated using ((user_id = verified_uid())) with check ((user_id = verified_uid()));

-- 3. Original function definitions
CREATE OR REPLACE FUNCTION public.award_xp_atomic(p_user_id text, p_amount integer, p_today date DEFAULT CURRENT_DATE)
 RETURNS json
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_yesterday date := p_today - interval '1 day';
  v_new       user_gamification%ROWTYPE;
BEGIN
  INSERT INTO user_gamification (
    user_id, xp, level, streak_days, longest_streak, last_activity_date, updated_at
  )
  VALUES (p_user_id, p_amount, 1, 1, 1, p_today, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    xp = user_gamification.xp + p_amount,

    streak_days = CASE
      WHEN user_gamification.last_activity_date = v_yesterday
        THEN user_gamification.streak_days + 1
      WHEN user_gamification.last_activity_date = p_today
        THEN user_gamification.streak_days          -- same day, no change
      ELSE 1                                         -- gap → reset
    END,

    longest_streak = GREATEST(
      user_gamification.longest_streak,
      CASE
        WHEN user_gamification.last_activity_date = v_yesterday
          THEN user_gamification.streak_days + 1
        WHEN user_gamification.last_activity_date = p_today
          THEN user_gamification.streak_days
        ELSE 1
      END
    ),

    last_activity_date = p_today,
    updated_at         = now()

  RETURNING * INTO v_new;

  RETURN row_to_json(v_new);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_field(p_user_id text, p_field text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  EXECUTE format(
    'UPDATE user_gamification SET %I = COALESCE(%I, 0) + 1 WHERE user_id = $1',
    p_field, p_field
  ) USING p_user_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_misconception(p_user_id text, p_exam_type text, p_subject text, p_chapter text, p_question_id text, p_wrong_answer text, p_correct_answer text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO concept_misconceptions
    (user_id, exam_type, subject, chapter, question_id, wrong_answer, correct_answer, attempt_count, last_wrong_at)
  VALUES
    (p_user_id, p_exam_type, p_subject, p_chapter, p_question_id, p_wrong_answer, p_correct_answer, 1, now())
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET attempt_count = concept_misconceptions.attempt_count + 1,
        last_wrong_at = now(),
        wrong_answer  = EXCLUDED.wrong_answer;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_misconception(p_user_id text, p_exam_type text, p_subject text, p_chapter text, p_question_id text, p_distractor text, p_correct text, p_question_text text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into concept_misconceptions
    (user_id, exam_type, subject, chapter, question_id, distractor, correct_answer, question_text, count, last_seen_at)
  values
    (p_user_id, p_exam_type, p_subject, p_chapter, p_question_id, p_distractor, p_correct, p_question_text, 1, now())
  on conflict (user_id, question_id, distractor)
  do update set
    count        = concept_misconceptions.count + 1,
    last_seen_at = now();
end;
$function$
;

-- 4. Table-level SELECT back (re-exposes approved_by / updated_by)
grant select on public.chapter_manifests to anon, authenticated;
grant select on public.platform_settings to anon, authenticated;
