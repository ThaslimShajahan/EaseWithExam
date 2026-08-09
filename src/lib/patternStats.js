/**
 * Reads chapter_pattern_stats — what real past-year papers actually ask — and
 * scores a generated paper against it.
 *
 * SCOPE, deliberately narrow. The view aggregates chapter × question_type ×
 * marks × section, with difficulty DERIVED FROM MARKS. It has no year axis
 * (every loaded paper is 2025) and does not use pyq_questions.difficulty (which
 * savePYQRows hardcodes to 'Medium'). Aggregating a constant would produce
 * something that looks like data and is not.
 *
 * NO DATA IS NOT ZERO. Only 2 of 11 exam+subject combinations have any PYQs.
 * Every function here returns an explicit `hasData: false` with a reason rather
 * than an empty array, because an empty chart and a chapter that genuinely
 * appears zero times are completely different claims.
 */
import { supabase } from './supabase';

/** Marks → difficulty, matching the CASE in the chapter_pattern_stats view. */
export function difficultyFromMarks(marks) {
  // Guard null explicitly: Number(null) is 0, which would silently label a
  // question with no marks as the easiest possible rather than unknown.
  if (marks == null) return 'unknown';
  const raw = typeof marks === 'number' ? marks : (marks.correct ?? marks);
  if (raw == null) return 'unknown';
  const m = Number(raw);
  if (!Number.isFinite(m)) return 'unknown';
  if (m >= 5) return 'hard';
  if (m >= 3) return 'medium';
  return 'easy';
}

/** Sums the per-chapter jsonb breakdowns into one distribution for the subject. */
function rollUp(rows, key) {
  const out = {};
  for (const r of rows) {
    for (const [k, n] of Object.entries(r[key] ?? {})) out[k] = (out[k] ?? 0) + Number(n || 0);
  }
  return out;
}

/**
 * Pattern stats for one exam+subject.
 *
 * Always returns the same shape. Callers must branch on `hasData` — never on
 * `chapters.length`, which is 0 both when there is no data and when a query
 * fails.
 */
export async function getChapterPatternStats(examType, subject) {
  const empty = (reason) => ({
    hasData: false, reason, examType, subject,
    questionCount: 0, chapterCount: 0, chapters: [],
    byQuestionType: {}, byMarks: {}, bySection: {}, byDifficulty: {},
  });

  if (!examType || !subject || subject === 'Mixed') {
    return empty('Pattern stats need a specific exam and subject.');
  }

  const { data, error } = await supabase
    .from('chapter_pattern_stats')
    .select('*')
    .eq('exam_type', examType)
    .eq('subject', subject)
    .order('question_count', { ascending: false });

  if (error)      return empty(`Could not load pattern stats: ${error.message}`);
  if (!data?.length) {
    return empty(`No past-year questions have been uploaded for ${examType} ${subject} yet, so there is no measured pattern to compare against.`);
  }

  const chapters = data.map((r) => ({
    chapter:        r.chapter,
    questionCount:  r.question_count,
    totalMarks:     r.total_marks,
    avgMarks:       Number(r.avg_marks),
    pctOfQuestions: Number(r.pct_of_questions),
    pctOfMarks:     r.pct_of_marks == null ? null : Number(r.pct_of_marks),
    byQuestionType: r.by_question_type ?? {},
    byMarks:        r.by_marks ?? {},
    bySection:      r.by_section ?? {},
    byDifficulty:   r.by_difficulty ?? {},
  }));

  return {
    hasData: true, reason: null, examType, subject,
    questionCount:  chapters.reduce((n, c) => n + c.questionCount, 0),
    chapterCount:   chapters.length,
    chapters,
    byQuestionType: rollUp(data, 'by_question_type'),
    byMarks:        rollUp(data, 'by_marks'),
    bySection:      rollUp(data, 'by_section'),
    byDifficulty:   rollUp(data, 'by_difficulty'),
  };
}

/* ── Scoring a generated paper against the measured pattern (§4b) ─────── */

const toPct = (counts) => {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (!total) return {};
  return Object.fromEntries(Object.entries(counts).map(([k, n]) => [k, (n / total) * 100]));
};

/**
 * Total-variation similarity between two distributions, as 0-100.
 *
 * Same formula the existing chapter-level blueprint_match_pct uses
 * (100 - half the summed absolute percentage difference), so the new
 * per-dimension scores are directly comparable to the number already shown.
 * Identical distributions score 100; disjoint ones score 0.
 */
export function distributionMatch(actualCounts, targetCounts) {
  const a = toPct(actualCounts), t = toPct(targetCounts);
  const keys = new Set([...Object.keys(a), ...Object.keys(t)]);
  if (!keys.size) return null;
  let diff = 0;
  for (const k of keys) diff += Math.abs((a[k] ?? 0) - (t[k] ?? 0));
  return Math.round(Math.max(0, 100 - diff / 2));
}

const tally = (items, pick) => {
  const out = {};
  for (const it of items) {
    const k = pick(it);
    if (k == null || k === '') continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
};

/**
 * Scores a generated paper on chapter, question type and marks against real
 * past-year data.
 *
 * Returns `{ hasData: false }` when the subject has no PYQs — a paper cannot be
 * "0% matching" a pattern that does not exist, and reporting it that way would
 * be a lie a UI would happily render as a red bar.
 *
 * `questions` are engine-format rows (type, marks, chapter).
 */
export function scorePaperAgainstPattern(questions, stats) {
  if (!stats?.hasData) {
    return { hasData: false, reason: stats?.reason ?? 'No pattern data.', overall: null };
  }
  const qs = (questions ?? []).filter(Boolean);
  if (!qs.length) return { hasData: false, reason: 'No questions to score.', overall: null };

  const marksOf = (q) => (typeof q.marks === 'number' ? q.marks : q.marks?.correct);

  const chapterScore = distributionMatch(
    tally(qs, (q) => q.chapter),
    Object.fromEntries(stats.chapters.map((c) => [c.chapter, c.questionCount])),
  );
  const typeScore = distributionMatch(tally(qs, (q) => q.type), stats.byQuestionType);
  const marksScore = distributionMatch(
    tally(qs, (q) => { const m = marksOf(q); return m == null ? null : String(m); }),
    stats.byMarks,
  );
  const difficultyScore = distributionMatch(
    tally(qs, (q) => difficultyFromMarks(marksOf(q))),
    stats.byDifficulty,
  );

  const parts = [chapterScore, typeScore, marksScore].filter((n) => n != null);
  return {
    hasData: true,
    reason: null,
    basedOn: { questions: stats.questionCount, chapters: stats.chapterCount },
    chapter:    chapterScore,
    type:       typeScore,
    marks:      marksScore,
    difficulty: difficultyScore,
    // Chapter, type and marks weigh equally. Difficulty is reported but left
    // out of the headline: it is derived from marks, so folding it in would
    // count the same signal twice.
    overall: parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null,
  };
}
