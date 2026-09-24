-- Security pass 2, Part C: the remaining open tables, and the self-write
-- policies that never worked.
--
-- FOUND 2026-09-25:
--  * XP, streaks, activity counters and mock-test results have never been
--    saved. Their self-write policies (user_gamification, test_sessions,
--    daily_usage_quota, concept_misconceptions) exist and key on
--    verified_uid() correctly — but are all `TO authenticated`, and every
--    request in this project runs as `anon` (Firebase tokens carry no role
--    claim; see project memory / 20260811180000). So they apply to nobody.
--    Proven with a real signed-in throwaway student: award_xp_atomic and a
--    test_sessions insert both → 42501. increment_field "succeeded" by
--    updating zero rows. (Anon probes alone could not have shown this.)
--  * Wide-open (USING true / WITH CHECK true) policies on shared caches other
--    students are served from (important_qa, topic_frequency, question_cache),
--    on personal tables (user_chapter_progress, user_daily_tasks, study_goals),
--    on admin tables (monitored_sources, question_papers, crawl_*,
--    concept_misconceptions, content_versions) and INSERT on changelog — so
--    audit entries, including their actor, could be forged by anyone.
--  * increment_field ran as the caller but could target ANY column (xp too)
--    of ANY user's row; upsert_misconception ran SECURITY DEFINER with no
--    caller check at all.
--  * Admin uids readable by anyone: chapter_manifests.approved_by,
--    platform_settings.updated_by.
--
-- Every policy below is written WITHOUT a role clause (applies to the anon
-- role every request uses) and keys on verified_uid() / is_verified_admin(),
-- which read Supabase's own verification of the request's Firebase token.
--
-- Rollback: supabase/rollback/20260926020000_rollback.sql (restore the
-- previous bundle first).

-- ═════════════════════════════════════════════════════════════════════════
-- 1. Personal tables — own rows (verified), admins read everything
-- ═════════════════════════════════════════════════════════════════════════
-- user_gamification: read own / admin; written ONLY by the RPCs in §4
drop policy if exists gamification_read_temporary_open on public.user_gamification;
drop policy if exists gamification_self_insert          on public.user_gamification;
drop policy if exists gamification_self_update          on public.user_gamification;
create policy gamification_read_own_or_admin on public.user_gamification
  for select using (user_id = public.verified_uid() or public.is_verified_admin());
create policy gamification_admin_write on public.user_gamification
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- test_sessions: a student saves and reads their own results
drop policy if exists test_sessions_read_temporary_open on public.test_sessions;
drop policy if exists test_sessions_self_insert          on public.test_sessions;
drop policy if exists test_sessions_self_update          on public.test_sessions;
create policy test_sessions_read_own_or_admin on public.test_sessions
  for select using (firebase_uid = public.verified_uid() or public.is_verified_admin());
create policy test_sessions_insert_own on public.test_sessions
  for insert with check (firebase_uid = public.verified_uid());
create policy test_sessions_update_own on public.test_sessions
  for update using (firebase_uid = public.verified_uid()) with check (firebase_uid = public.verified_uid());
create policy test_sessions_admin_write on public.test_sessions
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- daily_usage_quota: read own / admin. Students NEVER write it directly any
-- more — usage only moves through begin_ai_action / end_ai_action /
-- check_and_increment_quota / upsert_usage_quota (SECURITY DEFINER, self-only).
-- (The dead incrementUsage() client path would otherwise let a student reset
-- their own counts.)
drop policy if exists quota_read_temporary_open on public.daily_usage_quota;
drop policy if exists quota_self_insert          on public.daily_usage_quota;
drop policy if exists quota_self_update          on public.daily_usage_quota;
create policy quota_read_own_or_admin on public.daily_usage_quota
  for select using (user_id = public.verified_uid() or public.is_verified_admin());
create policy quota_admin_write on public.daily_usage_quota
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- Syllabus tracker, daily tasks, study goals: the student's own rows only
drop policy if exists chapter_progress_open on public.user_chapter_progress;
create policy chapter_progress_own on public.user_chapter_progress
  for all using (user_id = public.verified_uid()) with check (user_id = public.verified_uid());
create policy chapter_progress_admin_read on public.user_chapter_progress
  for select using (public.is_verified_admin());

drop policy if exists daily_tasks_open on public.user_daily_tasks;
create policy daily_tasks_own on public.user_daily_tasks
  for all using (user_id = public.verified_uid()) with check (user_id = public.verified_uid());
create policy daily_tasks_admin_read on public.user_daily_tasks
  for select using (public.is_verified_admin());

drop policy if exists study_goals_open on public.study_goals;
create policy study_goals_own on public.study_goals
  for all using (firebase_uid = public.verified_uid()) with check (firebase_uid = public.verified_uid());
create policy study_goals_admin_read on public.study_goals
  for select using (public.is_verified_admin());

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Shared caches — readable by signed-in users, written only through checks
-- ═════════════════════════════════════════════════════════════════════════
-- A student may add to a cache other students are served from only for an
-- exam+subject they are allowed, and only while holding a recently charged AI
-- action for it (begin_ai_action, last 30 min) — i.e. only content they just
-- generated through the proxy. Admins are exempt.
create or replace function public._has_recent_ai_action(p_uid text, p_buckets text[], p_exam_type text, p_subject text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ai_actions a
     where a.user_id = p_uid and a.bucket = any (p_buckets)
       and a.created_at > now() - interval '30 minutes'
       and a.exam_type = p_exam_type
       and (a.subject = p_subject or a.subject = 'Mixed')
  );
$$;

drop policy if exists important_qa_open on public.important_qa;
create policy important_qa_read_signed_in on public.important_qa
  for select using (public.verified_uid() is not null);
create policy important_qa_admin_write on public.important_qa
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- Identity comes only from the verified token (no uid parameter to mismatch).
create or replace function public.save_important_qa(
  p_exam_type text, p_subject text, p_chapter text, p_questions jsonb
) returns void
language plpgsql volatile security definer
set search_path = public
as $$
declare p_uid text := public.verified_uid();
begin
  if p_uid is null then raise exception 'Access denied: unverified caller' using errcode = '42501'; end if;
  if not public.is_verified_admin() then
    perform public.assert_exam_subject_allowed(p_uid, p_exam_type, p_subject);
    if not public._has_recent_ai_action(p_uid, array['ai_questions'], p_exam_type, p_subject) then
      raise exception 'No recent generation to cache' using errcode = '42501';
    end if;
  end if;
  if p_questions is null or jsonb_typeof(p_questions) <> 'array'
     or jsonb_array_length(p_questions) not between 1 and 20 then
    raise exception 'p_questions must be an array of 1-20 items' using errcode = '22023';
  end if;
  if coalesce(btrim(p_chapter), '') = '' or length(p_chapter) > 300 then
    raise exception 'Invalid chapter' using errcode = '22023';
  end if;
  insert into public.important_qa (exam_type, subject, chapter, questions, generated_at)
  values (p_exam_type, p_subject, p_chapter, p_questions, now())
  on conflict (exam_type, subject, chapter)
  do update set questions = excluded.questions, generated_at = excluded.generated_at;
end;
$$;

drop policy if exists topic_frequency_open on public.topic_frequency;
create policy topic_frequency_read_signed_in on public.topic_frequency
  for select using (public.verified_uid() is not null);
create policy topic_frequency_admin_write on public.topic_frequency
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- Student path: analyzeTopicDistribution's 'estimated' rows only. Admin PYQ
-- analysis keeps writing directly (topic_frequency_admin_write).
create or replace function public.save_topic_frequency(p_rows jsonb)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare r jsonb; n integer := 0; v_admin boolean := public.is_verified_admin(); p_uid text := public.verified_uid();
begin
  if p_uid is null then raise exception 'Access denied: unverified caller' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 30 then
    raise exception 'p_rows must be an array of at most 30 rows' using errcode = '22023';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if not v_admin then
      perform public._assert_action_scope(p_uid, r->>'exam_type', r->>'subject');
      if not public._has_recent_ai_action(p_uid, array['ai_questions','paper_generations'], r->>'exam_type', r->>'subject') then
        raise exception 'No recent generation for %/%', r->>'exam_type', r->>'subject' using errcode = '42501';
      end if;
    end if;
    if coalesce(btrim(r->>'topic'), '') = '' or length(r->>'topic') > 300 then continue; end if;
    insert into public.topic_frequency (exam_type, subject, topic, frequency, source)
    values (r->>'exam_type', r->>'subject', r->>'topic',
            round(least(greatest(coalesce((r->>'frequency')::numeric, 0), 0), 100))::int,
            case when v_admin then coalesce(r->>'source', 'estimated') else 'estimated' end)
    on conflict (exam_type, subject, topic)
    do update set frequency = excluded.frequency, source = excluded.source;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- question_cache: its client helpers (cacheGet/cacheSet) are never called —
-- 0 rows. Admin-only until something actually uses it.
drop policy if exists question_cache_open on public.question_cache;
create policy question_cache_admin_only on public.question_cache
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Admin-only tables
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists monitored_sources_open on public.monitored_sources;
create policy monitored_sources_admin_only on public.monitored_sources
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

drop policy if exists question_papers_open on public.question_papers;
create policy question_papers_admin_only on public.question_papers
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

drop policy if exists crawl_jobs_open     on public.crawl_jobs;
drop policy if exists crawl_jobs_anon_all on public.crawl_jobs;
create policy crawl_jobs_admin_only on public.crawl_jobs
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

drop policy if exists crawl_pdfs_open     on public.crawl_pdfs;
drop policy if exists crawl_pdfs_anon_all on public.crawl_pdfs;
create policy crawl_pdfs_admin_only on public.crawl_pdfs
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- concept_misconceptions: students write through upsert_misconception (§4);
-- the `TO authenticated` self policies never applied.
drop policy if exists cm_select                  on public.concept_misconceptions;
drop policy if exists cm_update                  on public.concept_misconceptions;
drop policy if exists cm_insert                  on public.concept_misconceptions;
drop policy if exists misconceptions_select_self on public.concept_misconceptions;
drop policy if exists misconceptions_insert_self on public.concept_misconceptions;
drop policy if exists misconceptions_update_self on public.concept_misconceptions;
create policy misconceptions_read_own_or_admin on public.concept_misconceptions
  for select using (user_id = public.verified_uid() or public.is_verified_admin());

drop policy if exists cv_select                             on public.content_versions;
drop policy if exists cv_insert                             on public.content_versions;
drop policy if exists content_versions_insert_authenticated on public.content_versions;
drop policy if exists content_versions_read_authenticated   on public.content_versions;
create policy content_versions_admin_only on public.content_versions
  for all using (public.is_verified_admin()) with check (public.is_verified_admin());

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Functions: XP, activity counters, misconceptions (verified callers)
-- ═════════════════════════════════════════════════════════════════════════
-- award_xp_atomic: now SECURITY DEFINER + self-only + bounded amount. p_today
-- is kept for compatibility but the server's IST date is used, so a client
-- can no longer forge a streak by claiming "today".
create or replace function public.award_xp_atomic(p_user_id text, p_amount integer, p_today date default current_date)
returns json
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_today     date := (now() at time zone 'Asia/Kolkata')::date;
  v_yesterday date := v_today - 1;
  v_new       public.user_gamification%rowtype;
begin
  perform public.assert_verified_self(p_user_id);
  if p_amount is null or p_amount < 1 or p_amount > 500 then
    raise exception 'Invalid XP amount' using errcode = '22023';
  end if;

  insert into public.user_gamification (user_id, xp, level, streak_days, longest_streak, last_activity_date, updated_at)
  values (p_user_id, p_amount, 1, 1, 1, v_today, now())
  on conflict (user_id) do update set
    xp = public.user_gamification.xp + p_amount,
    streak_days = case
      when public.user_gamification.last_activity_date = v_yesterday then public.user_gamification.streak_days + 1
      when public.user_gamification.last_activity_date = v_today     then public.user_gamification.streak_days
      else 1 end,
    longest_streak = greatest(public.user_gamification.longest_streak, case
      when public.user_gamification.last_activity_date = v_yesterday then public.user_gamification.streak_days + 1
      when public.user_gamification.last_activity_date = v_today     then public.user_gamification.streak_days
      else 1 end),
    last_activity_date = v_today,
    updated_at = now()
  returning * into v_new;

  return row_to_json(v_new);   -- same shape as before (the whole row)
end;
$$;

-- increment_field: activity counters only, own row only (it could target xp —
-- or any column — of any user before).
create or replace function public.increment_field(p_user_id text, p_field text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_user_id);
  if p_field is null or p_field not in ('total_questions_answered', 'total_tests_taken', 'total_veda_sessions') then
    raise exception 'Field not allowed: %', coalesce(p_field, '(none)') using errcode = '22023';
  end if;
  insert into public.user_gamification (user_id) values (p_user_id) on conflict (user_id) do nothing;
  execute format('update public.user_gamification set %I = coalesce(%I, 0) + 1, updated_at = now() where user_id = $1', p_field, p_field)
    using p_user_id;
end;
$$;

-- upsert_misconception (both overloads): same bodies, plus the missing check.
create or replace function public.upsert_misconception(
  p_user_id text, p_exam_type text, p_subject text, p_chapter text, p_question_id text,
  p_wrong_answer text, p_correct_answer text
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_user_id);
  insert into concept_misconceptions
    (user_id, exam_type, subject, chapter, question_id, wrong_answer, correct_answer, attempt_count, last_wrong_at)
  values
    (p_user_id, p_exam_type, p_subject, p_chapter, p_question_id, p_wrong_answer, p_correct_answer, 1, now())
  on conflict (user_id, question_id) do update
    set attempt_count = concept_misconceptions.attempt_count + 1,
        last_wrong_at = now(),
        wrong_answer  = excluded.wrong_answer;
end;
$$;

create or replace function public.upsert_misconception(
  p_user_id text, p_exam_type text, p_subject text, p_chapter text, p_question_id text,
  p_distractor text, p_correct text, p_question_text text default null
) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform public.assert_verified_self(p_user_id);
  insert into concept_misconceptions
    (user_id, exam_type, subject, chapter, question_id, distractor, correct_answer, question_text, count, last_seen_at)
  values
    (p_user_id, p_exam_type, p_subject, p_chapter, p_question_id, p_distractor, p_correct, p_question_text, 1, now())
  on conflict (user_id, question_id, distractor)
  do update set count = concept_misconceptions.count + 1, last_seen_at = now();
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 5. changelog — written only through log_change, actor from the token
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists cl_insert                      on public.changelog;
drop policy if exists changelog_insert_authenticated on public.changelog;

create or replace function public.log_change(
  p_entity_type text, p_entity_id text, p_action text, p_diff jsonb default null, p_note text default null
) returns uuid
language plpgsql volatile security definer
set search_path = public
as $$
declare v_uid text := public.verified_uid(); v_role text; v_id uuid;
begin
  if v_uid is null then raise exception 'Access denied: unverified caller' using errcode = '42501'; end if;
  select role into v_role from public.admins where uid = v_uid and is_active;
  insert into public.changelog (entity_type, entity_id, action, actor_uid, actor_role, diff, note)
  values (p_entity_type, left(coalesce(p_entity_id, ''), 300), p_action, v_uid, v_role, p_diff, left(p_note, 2000))
  returning id into v_id;
  return v_id;
end;
$$;

-- For backfill scripts: same rules, many rows. Admins only.
create or replace function public.log_changes_bulk(p_entries jsonb)
returns integer
language plpgsql volatile security definer
set search_path = public
as $$
declare e jsonb; n integer := 0;
begin
  if not public.is_verified_admin() then raise exception 'Access denied' using errcode = '42501'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 1000 then
    raise exception 'p_entries must be an array of at most 1000' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    perform public.log_change(e->>'entity_type', e->>'entity_id', e->>'action', e->'diff', e->>'note');
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ═════════════════════════════════════════════════════════════════════════
-- 6. knowledge_base: signed-in users only (match_knowledge_base runs as the
--    caller, so retrieval keeps working for every signed-in student/admin)
-- ═════════════════════════════════════════════════════════════════════════
drop policy if exists knowledge_base_select on public.knowledge_base;
create policy knowledge_base_read_signed_in on public.knowledge_base
  for select using (public.verified_uid() is not null);

-- ═════════════════════════════════════════════════════════════════════════
-- 7. Hide admin uids from public reads (column-level SELECT)
-- ═════════════════════════════════════════════════════════════════════════
-- Every client/edge reader already selects explicit columns without these
-- (AdminChapterManifest's approved_by is dropped in the same deploy); admin
-- RPCs are SECURITY DEFINER and unaffected.
revoke select on public.chapter_manifests from anon, authenticated;
grant select (id, exam_type, subject, book, class_level, key_prefix, source_file, entries, status,
              approved_at, notes, created_at, updated_at, file_structure)
  on public.chapter_manifests to anon, authenticated;

revoke select on public.platform_settings from anon, authenticated;
grant select (id, key, value, value_json, updated_at) on public.platform_settings to anon, authenticated;

-- ═════════════════════════════════════════════════════════════════════════
-- Grants
-- ═════════════════════════════════════════════════════════════════════════
revoke execute on function public._has_recent_ai_action(text, text[], text, text) from public, anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_important_qa(text, text, text, jsonb)',
    'public.save_topic_frequency(jsonb)',
    'public.award_xp_atomic(text, integer, date)',
    'public.increment_field(text, text)',
    'public.upsert_misconception(text, text, text, text, text, text, text)',
    'public.upsert_misconception(text, text, text, text, text, text, text, text)',
    'public.log_change(text, text, text, jsonb, text)',
    'public.log_changes_bulk(jsonb)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated, service_role', f);
  end loop;
end $$;
