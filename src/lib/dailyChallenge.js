import { supabase } from './supabase';
import { chatComplete } from './aiProxy';
import { fetchSubjectContext } from './questionGen';
import { beginAiAction, endAiAction } from './aiActions';

// Owner decision 2026-09-25: ONE Daily Mini Test per student per day (free and
// premium alike), charging 1 ai_questions. The server enforces the one-per-day
// rule (pick_daily_challenge_subject / save_daily_challenge).
const DAILY_TEST_QUOTA = 1;

/*
 * Daily Mini Test — since 2026-09-25 (migration 20260925000000) the SERVER
 * decides the exam and subject and re-checks them on save:
 *
 *   pick_daily_challenge_subject  chooses an allowed (exam, subject) for this
 *                                 verified student, preferring subjects with
 *                                 loaded content
 *   save_daily_challenge          refuses any pair outside the student's
 *                                 allowed list and builds the label itself
 *
 * This file used to pick from its own hardcoded list, where 'JEE Advanced'
 * matched no branch and fell through to ['Mathematics','Science','English'] —
 * the "JEE Advanced · English" test a student posted publicly. The tables are
 * RPC-only now, so nothing here can write a subject the server hasn't allowed.
 */

/** Thrown for states the UI must render honestly, never paper over. */
export class DailyChallengeUnavailable extends Error {
  constructor(status) {
    super(status === 'setup_required' ? 'Complete your subject selection to get a daily test.'
      : status === 'done_today'       ? "You have done today's Daily Mini Test — a new one arrives tomorrow."
      : 'Daily tests for your exam are coming soon.');
    this.status = status;   // 'setup_required' | 'no_subjects' | 'done_today'
  }
}

/* ── Today's challenge for this student (or null) ─────────── */
// Server-filtered: a test whose exam+subject is no longer allowed (profile
// changed, or an admin hid the subject) is not returned, so the caller
// generates a fresh, allowed one instead.
export async function getTodayChallenge(firebaseUid) {
  const { data, error } = await supabase.rpc('get_today_daily_challenge', { p_uid: firebaseUid });
  if (error) throw new Error(error.message);
  return data?.id ? data : null;   // composite RPCs return an all-null row for "none"
}

/* ── Save the student's answers ───────────────────────────── */
// Throws on failure. The old version ignored supabase-js's returned `error`
// (it doesn't throw) inside a bare catch, so a failed save was invisible.
export async function saveChallengeAnswer(challengeId, firebaseUid, selectedOption, isCorrect) {
  const { error } = await supabase.rpc('save_daily_challenge_attempt', {
    p_uid: firebaseUid, p_challenge_id: challengeId, p_selected: selectedOption, p_is_correct: isCorrect,
  });
  if (error) throw new Error(error.message);
}

/* ── Today's attempt by this student ──────────────────────── */
export async function getTodayAttempt(challengeId, firebaseUid) {
  if (!challengeId || !firebaseUid) return null;
  const { data, error } = await supabase.rpc('get_own_daily_challenge_attempt', {
    p_uid: firebaseUid, p_challenge_id: challengeId,
  });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

/* ── Recently used topics (to avoid repeats) ──────────────── */
async function getRecentTopics(userId) {
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data } = await supabase.rpc('get_recent_challenge_topics', { p_uid: userId, p_cutoff: cutoff });
    return (data ?? []).map((r) => `${r.subject}: ${r.topic}`);
  } catch { return []; }   // a hint only — never block generation on it
}

/* ── Generate today's 5-question mini paper ───────────────── */
export async function generateDailyChallenge({ userId }) {
  if (!userId) throw new Error('Sign in to get a daily test.');

  // 1. The server picks an allowed exam + subject.
  const { data: pick, error: pickErr } = await supabase.rpc('pick_daily_challenge_subject', { p_uid: userId });
  if (pickErr) throw new Error(pickErr.message);
  if (pick?.status !== 'ok') throw new DailyChallengeUnavailable(pick?.status ?? 'no_subjects');
  const { exam_type: examType, subject, has_content: hasContent } = pick;

  // Charged server-side (begin_ai_action) before any AI call; ai-proxy only
  // serves this student while the action is open. Refunded on any failure.
  const action = await beginAiAction(userId, 'ai_questions', DAILY_TEST_QUOTA, { examType, subject });
  try {
    return await generateAndSave({ userId, examType, subject, hasContent });
  } catch (e) {
    endAiAction(userId, action, 0);
    throw e;
  }
}

/* ── The generation itself, run inside the charged action ─── */
async function generateAndSave({ userId, examType, subject, hasContent }) {
  // 2. Ground it in loaded textbook content when the server says there is some
  //    (for NEET/JEE that includes CBSE Class 11/12 NCERT — owner decision).
  const extracts = hasContent ? await fetchSubjectContext(subject, examType).catch(() => []) : [];

  const recentTopics = await getRecentTopics(userId);
  const avoidHint = recentTopics.length
    ? `\n\nAVOID repeating these recently used topics: ${recentTopics.join('; ')}. Pick a DIFFERENT chapter.`
    : '';
  const sourceBlock = extracts.length
    ? `\n\nBase EVERY question on these textbook extracts (the student's own syllabus). Do not go beyond them:\n${
        extracts.map((t, i) => `--- Extract ${i + 1} ---\n${t}`).join('\n')}`
    : `\n\nStay strictly within the ${subject} syllabus for ${examType}.`;

  const prompt = `Generate a 5-question daily mini test for ${examType} — subject: ${subject}. Every question must be a ${subject} question.${sourceBlock}${avoidHint}
Mix question types:
- Q1, Q2, Q3: MCQ (single correct, 4 options A/B/C/D)
- Q4: Assertion-Reason (options exactly: A: Both A&R true and R is correct explanation; B: Both true but R is not correct explanation; C: A is true R is false; D: A is false)
- Q5: Numerical (integer/decimal answer, opts must be []). If ${subject} has no numerical content, make Q5 a fifth MCQ instead.

All questions must be based on NCERT syllabus, realistic ${examType} difficulty. Use $...$ for LaTeX.

Return ONLY valid JSON:
{
  "chapter": "Primary chapter name",
  "questions": [
    {
      "type": "MCQ",
      "q": "Question text",
      "opts": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer": "B",
      "explanation": "Why B is correct"
    },
    {
      "type": "Assertion-Reason",
      "q": "Assertion (A): ...\\nReason (R): ...",
      "opts": ["A. Both A and R are true and R is the correct explanation of A", "B. Both A and R are true but R is not the correct explanation of A", "C. A is true but R is false", "D. A is false but R is true"],
      "answer": "A",
      "explanation": "..."
    },
    {
      "type": "Numerical",
      "q": "Question text requiring a numeric answer",
      "opts": [],
      "answer": "42",
      "explanation": "..."
    }
  ]
}`;

  const resp = await chatComplete({
    model:           'gpt-4o',
    max_tokens:      2000,
    temperature:     0.6,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are an expert exam question setter. Return only valid JSON.' },
      { role: 'user',   content: prompt },
    ],
  }, { feature: 'daily-challenge' });

  const raw = JSON.parse(resp.choices[0].message.content);

  // 3. The server re-checks the pair, validates the questions, builds the label
  //    and records history. A refusal surfaces as an error, never a silent save.
  const { data, error } = await supabase.rpc('save_daily_challenge', {
    p_uid:       userId,
    p_exam_type: examType,
    p_subject:   subject,
    p_chapter:   raw.chapter || null,
    p_questions: raw.questions || [],
  });
  if (error) throw new Error(error.message);
  return data;
}
