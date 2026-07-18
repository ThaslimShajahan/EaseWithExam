/**
 * Error Notebook — stores wrong answers and drives spaced repetition.
 *
 * SM-2 algorithm (simplified):
 *   - If grade >= 3 (remembered): interval *= ease_factor, ease_factor += 0.1
 *   - If grade < 3  (forgot):     interval = 1, ease_factor -= 0.2 (min 1.3)
 *   - due_date = today + interval_days
 */

import { supabase } from './supabase';
import { createNotification } from './notifications';

const IST_DATE = () =>
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/* ── Save wrong answers from a test / practice ─────────────── */
export async function saveWrongAnswers(firebaseUid, questions, answers, source = 'practice', sourceName = '') {
  if (!firebaseUid || !questions?.length) return;
  const today = IST_DATE();

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
      user_id:       firebaseUid,
      question_id:   q.id,
      question_text: q.question,
      subject:       q.subject || 'General',
      topic:         q.topic   || 'General',
      question_type: q.type    || 'MCQ',
      options:       q.options ? JSON.stringify(q.options) : null,
      correct_option:q.correctOption ?? null,
      correct_answer:q.correctAnswer ?? null,
      explanation:   q.explanation   ?? null,
      user_answer:   String(answers[q.id]),
      is_correct:    false,
      source,
      source_name:   sourceName,
      due_date:      today,
      ease_factor:   2.5,
      interval_days: 1,
      repetitions:   0,
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

  // Upsert — if the same question_id+user_id exists, keep the existing SRS state
  for (const row of wrongRows) {
    const { data: existing } = await supabase
      .from('question_history')
      .select('id, interval_days, ease_factor, repetitions')
      .eq('user_id', firebaseUid)
      .eq('question_id', row.question_id)
      .eq('is_mastered', false)
      .maybeSingle();

    if (existing) {
      // Already in notebook — reset SRS to due today
      await supabase
        .from('question_history')
        .update({ user_answer: row.user_answer, due_date: today, is_correct: false, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase.from('question_history').insert(row);
    }
  }

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
  const today = IST_DATE();
  const { data, error } = await supabase
    .from('question_history')
    .select('*')
    .eq('user_id', firebaseUid)
    .eq('is_mastered', false)
    .lte('due_date', today)
    .order('due_date', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/* ── Fetch all wrong questions (paginated) ──────────────────── */
export async function getErrorNotebook(firebaseUid, filters = {}) {
  let q = supabase
    .from('question_history')
    .select('*')
    .eq('user_id', firebaseUid)
    .order('updated_at', { ascending: false });

  if (filters.subject)    q = q.eq('subject', filters.subject);
  if (filters.mastered !== undefined) q = q.eq('is_mastered', filters.mastered);
  if (filters.limit)      q = q.limit(filters.limit);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/* ── SM-2: Record review result ─────────────────────────────── */
// grade: 0=blackout, 1=wrong, 2=wrong-hint, 3=hard, 4=good, 5=easy
export async function recordReview(historyId, grade) {
  const { data: row, error } = await supabase
    .from('question_history')
    .select('ease_factor, interval_days, repetitions')
    .eq('id', historyId)
    .single();
  if (error) throw error;

  let { ease_factor, interval_days, repetitions } = row;
  const today = IST_DATE();

  if (grade >= 3) {
    if (repetitions === 0)      interval_days = 1;
    else if (repetitions === 1) interval_days = 6;
    else                        interval_days = Math.round(interval_days * ease_factor);
    ease_factor   = Math.max(1.3, ease_factor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
    repetitions  += 1;
  } else {
    interval_days = 1;
    ease_factor   = Math.max(1.3, ease_factor - 0.2);
    repetitions   = 0;
  }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + interval_days);
  const dueDateStr = dueDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

  const isMastered = repetitions >= 5 && grade >= 4;

  await supabase
    .from('question_history')
    .update({
      ease_factor, interval_days, repetitions,
      due_date:   dueDateStr,
      is_mastered: isMastered,
      is_correct:  grade >= 3,
      updated_at:  new Date().toISOString(),
    })
    .eq('id', historyId);
}

/* ── Update weak topics table ────────────────────────────────── */
async function updateWeakTopics(firebaseUid, questions, answers) {
  const today = IST_DATE();
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

  for (const [, g] of Object.entries(grouped)) {
    const acc = Math.round(((g.total - g.wrong) / g.total) * 100);
    const { data: existing } = await supabase
      .from('user_weak_topics')
      .select('id, wrong_count, total_attempts')
      .eq('user_id', firebaseUid)
      .eq('subject', g.subject)
      .eq('topic', g.topic)
      .maybeSingle();

    if (existing) {
      const newWrong = existing.wrong_count + g.wrong;
      const newTotal = existing.total_attempts + g.total;
      await supabase.from('user_weak_topics').update({
        wrong_count:    newWrong,
        total_attempts: newTotal,
        accuracy_pct:   Math.round(((newTotal - newWrong) / newTotal) * 100),
        last_seen:      today,
        updated_at:     new Date().toISOString(),
      }).eq('id', existing.id);
    } else {
      await supabase.from('user_weak_topics').insert({
        user_id: firebaseUid, subject: g.subject, topic: g.topic,
        wrong_count: g.wrong, total_attempts: g.total, accuracy_pct: acc, last_seen: today,
      });
    }
  }
}

/* ── Fetch weak topics ──────────────────────────────────────── */
export async function getWeakTopics(firebaseUid, limit = 10) {
  const { data, error } = await supabase
    .from('user_weak_topics')
    .select('*')
    .eq('user_id', firebaseUid)
    .lt('accuracy_pct', 70)
    .order('accuracy_pct', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/* ── Error notebook stats ────────────────────────────────────── */
export async function getNotebookStats(firebaseUid) {
  const today = IST_DATE();
  const [{ count: total }, { count: due }, { count: mastered }] = await Promise.all([
    supabase.from('question_history').select('id', { count: 'exact', head: true }).eq('user_id', firebaseUid),
    supabase.from('question_history').select('id', { count: 'exact', head: true }).eq('user_id', firebaseUid).eq('is_mastered', false).lte('due_date', today),
    supabase.from('question_history').select('id', { count: 'exact', head: true }).eq('user_id', firebaseUid).eq('is_mastered', true),
  ]);
  return { total: total ?? 0, due: due ?? 0, mastered: mastered ?? 0 };
}
