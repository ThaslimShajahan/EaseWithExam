-- Fix admin_delete_student: it tried to DELETE FROM two VIEWS.
--
-- `leaderboard_alltime` and `leaderboard_weekly` are views (they carry a
-- LIMIT), not tables, so Postgres rejected the whole function with
--   55000: Views containing LIMIT or OFFSET are not automatically updatable
-- on EVERY call. The delete runs as one statement block, so nothing was
-- removed at all — the feature has never worked since it was added in
-- sql/0041, and Admin > Students' "delete student" silently failed every time.
--
-- The views derive from user_gamification / test_sessions, both of which this
-- function already deletes from, so removing these two lines loses nothing:
-- the leaderboard entries disappear with their source rows.

create or replace function public.admin_delete_student(
  p_caller text,
  p_firebase_uid text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role text;
begin
  select role into v_role from admins where uid = p_caller and is_active = true;
  if v_role is null or v_role not in ('superadmin','admin') then
    raise exception 'Access denied';
  end if;

  delete from doubt_messages where chat_id in (select id from doubt_chats where firebase_uid = p_firebase_uid);
  delete from doubt_chats             where firebase_uid = p_firebase_uid;
  delete from centre_student_results  where student_uid  = p_firebase_uid;
  delete from coaching_students       where firebase_uid = p_firebase_uid;
  delete from concept_misconceptions  where user_id      = p_firebase_uid;
  delete from daily_challenge_attempts where user_id     = p_firebase_uid;
  delete from daily_challenge_history where user_id      = p_firebase_uid;
  delete from daily_challenges        where user_id      = p_firebase_uid;
  delete from daily_usage_quota       where user_id      = p_firebase_uid;
  delete from flashcard_progress      where firebase_uid = p_firebase_uid;
  delete from flashcards              where firebase_uid = p_firebase_uid;
  delete from in_app_notifications    where user_id      = p_firebase_uid;
  -- leaderboard_alltime / leaderboard_weekly deliberately omitted: views.
  delete from notification_prefs      where user_id      = p_firebase_uid;
  delete from parent_student_links    where student_uid  = p_firebase_uid;
  delete from question_history        where user_id      = p_firebase_uid;
  delete from quota_overrides         where user_id      = p_firebase_uid;
  delete from referral_codes          where user_id      = p_firebase_uid;
  delete from study_goals             where firebase_uid = p_firebase_uid;
  delete from subscriptions           where user_id      = p_firebase_uid;
  delete from test_sessions           where firebase_uid = p_firebase_uid;
  delete from user_chapter_progress   where user_id      = p_firebase_uid;
  delete from user_daily_tasks        where user_id      = p_firebase_uid;
  delete from user_gamification       where user_id      = p_firebase_uid;
  delete from user_notifications      where user_id      = p_firebase_uid;
  delete from user_weak_topics        where user_id      = p_firebase_uid;
  delete from users                   where firebase_uid = p_firebase_uid;
end;
$$;

grant execute on function public.admin_delete_student(text, text) to anon, authenticated;
