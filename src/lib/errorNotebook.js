/**
 * Error Notebook — stores wrong answers and drives spaced repetition.
 *
 * SM-2 algorithm (simplified):
 *   - If grade >= 3 (remembered): interval *= ease_factor, ease_factor += 0.1
 *   - If grade < 3  (forgot):     interval = 1, ease_factor -= 0.2 (min 1.3)
 *   - due_date = today + interval_days
 *
 * All reads/writes go through SECURITY DEFINER RPCs, scoped to the caller's
 * own firebase_uid server-side — question_history/user_weak_topics have no
 * direct-table policies for anon (PART A2 lockdown).
 */

import { supabase } from './supabase';
import { createNotification } from './notifications';

/* ── Save wrong answers from a test / practice ─────────────── */
export async function saveWrongAnswers(firebaseUid, questions, answers, source = 'practice', sourceName = '') {
  if (!firebaseUid || !questions?.length) return;

  const wrongRows = questions
    .filter((q) => {
      const sel = answers[q.id];
      if (sel === undefined || sel === null || sel === '') return false;
      if (q.type === 'Numerical') {
        const u = parseFloat(String(sel).trim());
        const c = parseFloat(String(q.correctAnswer ?? '').trim());
        return isNaN(u) || isNaN(c) || Math.abs(u - c) >= 0.01;
      }
      return sel !== q.correctOption;
    })
    .map((q) => ({
      question_id:   q.id,
      question_text: q.question,
      subject:       q.subject || 'General',
      topic:         q.topic   || 'General',
      question_type: q.type    || 'MCQ',
      options:       q.options ?? null,
      correct_option:q.correctOption ?? null,
      correct_answer:q.correctAnswer ?? null,
      explanation:   q.explanation   ?? null,
      user_answer:   String(answers[q.id]),
      source,
      source_name:   sourceName,
    }));

  if (!wrongRows.length) return;

  // Notify once per session when errors are logged (only for test/mock, not already seen)
  if (source === 'mock_test' && wrongRows.length > 0) {
    createNotification(
      firebaseUid,
      'errors_logged',
      `${wrongRows.length} question${wrongRows.length > 1 ? 's' : ''} added to Error Notebook`,
      `From "${sourceName}" — review them with spaced repetition to master weak areas.`,
      '/notebook',
    ).catch(() => {});
  }

  const { error } = await supabase.rpc('save_wrong_answers', { p_uid: firebaseUid, p_rows: wrongRows });
  if (error) throw error;

  // Also update weak topics
  await updateWeakTopics(firebaseUid, questions, answers);
}

/* ── Save correct answers (for history, not SRS) ───────────── */
export async function saveCorrectAnswers(firebaseUid, questions, answers, source = 'practice', sourceName = '') {
  if (!firebaseUid) return;
  // Update any existing wrong record for these questions to mark them seen correctly
  const correctIds = questions
    .filter((q) => {
      const sel = answers[q.id];
      if (!sel && sel !== 0) return false;
      if (q.type === 'Numerical') {
        const u = parseFloat(String(sel).trim());
        const c = parseFloat(String(q.correctAnswer ?? '').trim());
        return !isNaN(u) && !isNaN(c) && Math.abs(u - c) < 0.01;
      }
      return sel === q.correctOption;
    })
    .map((q) => q.id);

  if (!correctIds.length) return;
  // Update weak topics for correct answers too
  await updateWeakTopics(firebaseUid, questions, answers);
}

/* ── Fetch questions due for review (SRS queue) ─────────────── */
export async function getDueQuestions(firebaseUid, limit = 20) {
  const { data, error } = await supabase.rpc('get_due_questions', { p_uid: firebaseUid, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

/* ── Fetch all wrong questions (paginated) ──────────────────── */
export async function getErrorNotebook(firebaseUid, filters = {}) {
  const { data, error } = await supabase.rpc('get_error_notebook', {
    p_uid:      firebaseUid,
    p_subject:  filters.subject ?? null,
    p_mastered: filters.mastered ?? null,
    p_limit:    filters.limit ?? null,
  });
  if (error) throw error;
  return data ?? [];
}

/* ── SM-2: Record review result ─────────────────────────────── */
// grade: 0=blackout, 1=wrong, 2=wrong-hint, 3=hard, 4=good, 5=easy
export async function recordReview(firebaseUid, historyId, grade) {
  const { data, error } = await supabase.rpc('record_review', {
    p_uid: firebaseUid, p_history_id: historyId, p_grade: grade,
  });
  if (error) throw error;
  return data;
}

/* ── Update weak topics table ────────────────────────────────── */
async function updateWeakTopics(firebaseUid, questions, answers) {
  const grouped = {};

  questions.forEach((q) => {
    const sel = answers[q.id];
    const key = `${q.subject}|||${q.topic || 'General'}`;
    if (!grouped[key]) grouped[key] = { subject: q.subject || 'General', topic: q.topic || 'General', wrong: 0, total: 0 };
    grouped[key].total++;
    const isWrong = (() => {
      if (!sel && sel !== 0) return false;
      if (q.type === 'Numerical') {
        const u = parseFloat(String(sel).trim());
        const c = parseFloat(String(q.correctAnswer ?? '').trim());
        return isNaN(u) || isNaN(c) || Math.abs(u - c) >= 0.01;
      }
      return sel !== q.correctOption;
    })();
    if (isWrong) grouped[key].wrong++;
  });

  const rows = Object.values(grouped);
  if (!rows.length) return;
  await supabase.rpc('update_weak_topics', { p_uid: firebaseUid, p_rows: rows }).catch(() => {});
}

/* ── Fetch weak topics ──────────────────────────────────────── */
export async function getWeakTopics(firebaseUid, limit = 10) {
  const { data, error } = await supabase.rpc('get_weak_topics', { p_uid: firebaseUid, p_limit: limit });
  if (error) throw error;
  return data ?? [];
}

/* ── Error notebook stats ────────────────────────────────────── */
export async function getNotebookStats(firebaseUid) {
  const { data, error } = await supabase.rpc('get_notebook_stats', { p_uid: firebaseUid });
  if (error) throw error;
  return data ?? { total: 0, due: 0, mastered: 0 };
}
