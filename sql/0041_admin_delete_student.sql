-- ═══════════════════════════════════════════════════════════════════
-- Migration 0041 — Admin student account deletion (was entirely missing)
--
-- Cascades a real delete across every table keyed by firebase_uid/user_id/
-- student_uid for this student, then removes the users row itself.
-- Irreversible — gated behind a strong confirm in the admin UI.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_delete_student(p_caller text, p_firebase_uid text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE firebase_uid = p_firebase_uid) THEN
    RAISE EXCEPTION 'Student not found';
  END IF;

  DELETE FROM doubt_messages WHERE chat_id IN (SELECT id FROM doubt_chats WHERE firebase_uid = p_firebase_uid);
  DELETE FROM doubt_chats WHERE firebase_uid = p_firebase_uid;

  DELETE FROM centre_student_results WHERE student_uid = p_firebase_uid;
  DELETE FROM coaching_students WHERE firebase_uid = p_firebase_uid;
  DELETE FROM concept_misconceptions WHERE user_id = p_firebase_uid;
  DELETE FROM daily_challenge_attempts WHERE user_id = p_firebase_uid;
  DELETE FROM daily_challenge_history WHERE user_id = p_firebase_uid;
  DELETE FROM daily_challenges WHERE user_id = p_firebase_uid;
  DELETE FROM daily_usage_quota WHERE user_id = p_firebase_uid;
  DELETE FROM flashcard_progress WHERE firebase_uid = p_firebase_uid;
  DELETE FROM flashcards WHERE firebase_uid = p_firebase_uid;
  DELETE FROM in_app_notifications WHERE user_id = p_firebase_uid;
  DELETE FROM leaderboard_alltime WHERE user_id = p_firebase_uid;
  DELETE FROM leaderboard_weekly WHERE user_id = p_firebase_uid;
  DELETE FROM notification_prefs WHERE user_id = p_firebase_uid;
  DELETE FROM parent_student_links WHERE student_uid = p_firebase_uid;
  DELETE FROM question_history WHERE user_id = p_firebase_uid;
  DELETE FROM quota_overrides WHERE user_id = p_firebase_uid;
  DELETE FROM referral_codes WHERE user_id = p_firebase_uid;
  DELETE FROM study_goals WHERE firebase_uid = p_firebase_uid;
  DELETE FROM subscriptions WHERE user_id = p_firebase_uid;
  DELETE FROM test_sessions WHERE firebase_uid = p_firebase_uid;
  DELETE FROM user_chapter_progress WHERE user_id = p_firebase_uid;
  DELETE FROM user_daily_tasks WHERE user_id = p_firebase_uid;
  DELETE FROM user_gamification WHERE user_id = p_firebase_uid;
  DELETE FROM user_notifications WHERE user_id = p_firebase_uid;
  DELETE FROM user_weak_topics WHERE user_id = p_firebase_uid;
  DELETE FROM users WHERE firebase_uid = p_firebase_uid;
END;
$$;
