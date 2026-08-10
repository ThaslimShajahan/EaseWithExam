/**
 * Single source of truth for exam pattern display helpers.
 * Data lives in PAPER_PATTERNS (questionGen.js); this module derives
 * human-readable labels and per-test counts for UI consumers.
 *
 * Never defaults to NEET for unknown exam types.
 */

import { PAPER_PATTERNS } from './questionGen';
import { supabase } from './supabase';

// mirrors resolvePatternKey in questionGen (kept local — no circular dep risk)
function resolveKey(examType) {
  if (PAPER_PATTERNS?.[examType]) return examType;
  const m = examType?.match(/^(?:CBSE|ICSE|State Board) (Class \d+)$/);
  return m ? m[1] : examType;
}

// Admin-editable overrides (paper_templates table) for the CBSE-style board
// patterns — question count, duration, total marks, and section breakdown.
// NEET/JEE Main/JEE Advanced are NOT overridable here: their per-subject NTA
// structure doesn't fit this simple name/count/marks section shape, so they
// always use the hardcoded PAPER_PATTERNS values.
// Same live-binding pattern as categories.js: loaded once at boot, admin
// edits call refreshPaperTemplateOverrides() to update every importer.
let _overrides = {};
let _loaded    = false;

function toPatternShape(row, base) {
  const sections = Object.fromEntries((row.sections ?? []).map((s) => [s.name, { count: s.count, marks: s.marks }]));
  const marking  = Object.fromEntries((row.sections ?? []).map((s) => [s.name, s.marks]));
  return {
    label:        base?.label ?? row.exam_type,
    totalQ:       row.total_questions,
    duration:     row.duration_minutes,
    totalMarks:   row.total_marks,
    marking,
    sections,
    // Curated AI-prompt prose isn't admin-editable yet — keep whatever the
    // hardcoded pattern already has for this exam type.
    questionStyle: base?.questionStyle,
  };
}

async function _fetchOverrides() {
  try {
    const { data, error } = await supabase.from('paper_templates').select('*');
    if (error || !data?.length) return;
    const next = {};
    for (const row of data) next[row.exam_type] = toPatternShape(row, PAPER_PATTERNS[row.exam_type]);
    _overrides = next;
  } catch { /* keep hardcoded fallback */ }
}

/** Fetch paper_templates overrides once at app boot. */
export async function loadPaperTemplateOverrides() {
  if (_loaded) return;
  _loaded = true;
  return _fetchOverrides();
}

/** Re-fetch after an admin saves a template so every consumer sees it immediately. */
export async function refreshPaperTemplateOverrides() {
  return _fetchOverrides();
}

/**
 * Returns the pattern object for an exam type, or null if not found.
 * Never falls back to NEET/NTA — callers must handle null.
 */
export function getExamPattern(examType) {
  if (!examType) return null;
  if (_overrides[examType]) return _overrides[examType];
  const direct = PAPER_PATTERNS[examType];
  if (direct) return direct;
  const key = resolveKey(examType);
  if (_overrides[key]) return _overrides[key];
  const resolved = PAPER_PATTERNS[key];
  if (resolved) return resolved;
  // Generic fallback for board/class combos not yet in PAPER_PATTERNS
  if (/class/i.test(examType) || /cbse|icse|state board/i.test(examType)) {
    console.warn('[examPattern] No exact pattern for', examType, '— using generic board fallback');
    return {
      totalQ: 35, duration: 180, totalMarks: 80,
      marking: { 'Section A': 1, 'Section B': 2, 'Section C': 3, 'Section D': 5 },
    };
  }
  console.warn('[examPattern] No pattern found for:', examType);
  return null;
}

/**
 * Returns true if the pattern uses integer marks with no negative marking
 * (CBSE/board style). False for NTA/competitive exams.
 */
export function isCBSEStyle(pattern) {
  if (!pattern?.marking) return false;
  const m = pattern.marking;
  if (m.varies) return false;
  if (m.correct !== undefined) return false;
  // Check if first value is a plain object (JEE Main per-type) or number (CBSE section)
  const first = Object.values(m)[0];
  return typeof first === 'number';
}

/**
 * Returns a short human-readable marking scheme label.
 * Examples:
 *   NEET        → "+4 / −1"
 *   JEE Main    → "+4 / −1 (MCQ) · +4 / 0 (Numerical)"
 *   JEE Advanced→ "Variable marking"
 *   CBSE Class 8→ "1 / 2 / 3 / 5 marks · no negative"
 */
export function getMarkingLabel(pattern) {
  const m = pattern?.marking;
  if (!m) return '';

  if (m.varies) return 'Variable marking';

  // Flat NTA: { correct: 4, wrong: -1, skipped: 0 }
  if (typeof m.correct === 'number') {
    const neg = m.wrong ?? m.incorrect ?? 0;
    return neg < 0 ? `+${m.correct} / ${neg}` : `+${m.correct}`;
  }

  // Per-type NTA: { MCQ: { correct: 4, wrong: -1 }, Numerical: { correct: 4, wrong: 0 } }
  const first = Object.values(m)[0];
  if (first && typeof first === 'object' && 'correct' in first) {
    return Object.entries(m)
      .map(([type, s]) => {
        const neg = s.wrong ?? s.incorrect ?? 0;
        return `+${s.correct}${neg < 0 ? ` / ${neg}` : ''} (${type})`;
      })
      .join(' · ');
  }

  // Section-keyed CBSE: { 'Section A': 1, 'Section B': 2, ... }
  const vals = [...new Set(Object.values(m))].sort((a, b) => a - b);
  return `${vals.join(' / ')} marks · no negative`;
}

/**
 * Returns the number of questions to generate per single-subject paper call.
 * For competitive exams this is the per-subject count;
 * for board/class exams this is the full paper (one subject).
 */
export function getSubjectQuestionCount(pattern) {
  if (!pattern) return 30;
  const { sections, totalQ } = pattern;
  if (!sections) return totalQ ?? 30;

  const firstKey = Object.keys(sections)[0] ?? '';
  const firstSec = sections[firstKey];

  // CBSE/board-style: sections keyed by "Section X (…)"
  if (firstKey.startsWith('Section')) return totalQ ?? 35;

  // NTA subject-keyed — NEET style: { total: 45 }
  if (typeof firstSec?.total === 'number') return firstSec.total;

  // JEE Main style: { MCQ: 20, Numerical: 10, numericalAttempt: 5 }
  if (typeof firstSec?.MCQ === 'number') {
    return firstSec.MCQ + (firstSec.numericalAttempt ?? 0);
  }

  return totalQ ?? 30;
}

/**
 * Returns the test duration in minutes for a published per-subject mock test.
 * Competitive exams: pattern duration divided by subject count.
 * Board/class exams: full pattern duration (paper is one subject).
 */
export function getTestDurationMinutes(pattern) {
  if (!pattern) return 30;
  const { sections, duration } = pattern;
  if (!duration) return 30;
  if (!sections) return duration;

  const firstKey = Object.keys(sections)[0] ?? '';
  if (firstKey.startsWith('Section')) return duration; // CBSE full paper

  // NTA: divide by subject count
  const subjectCount = Object.keys(sections).length || 1;
  return Math.round(duration / subjectCount);
}

/**
 * Default question types for an exam, used when a caller has no explicit
 * selection of its own (Exam Center's one-tap paper generation).
 *
 * WHY THIS IS A FUNCTION AND NOT A PLAIN LOOKUP
 * The map is keyed by BOARD ('CBSE') and by CLASS ('Class 10'), but real
 * exam_type values are the combined form — 'CBSE Class 10'. A direct
 * `EXAM_QTYPES[examType]` therefore MISSES and falls through to its default.
 *
 * That was invisible while generateQuestionPaper ignored qTypes for CBSE-style
 * exams: the generator substituted all five section types regardless, so a
 * board paper came out correct despite the lookup having quietly resolved to
 * ['MCQ']. The moment the generator started honouring qTypes (so that a student
 * picking "MCQ only" actually gets MCQs), that silent miss would have collapsed
 * every Exam Center CBSE paper to MCQ-only. Resolving the combined form is what
 * makes the generator fix safe.
 *
 * Order matters: the class-specific entry wins over the board one, because
 * 'Class 8' legitimately omits Assertion-Reason while 'CBSE' includes it.
 */
export const EXAM_QTYPES = {
  'NEET':         ['MCQ', 'Assertion-Reason'],
  'JEE Main':     ['MCQ', 'Numerical'],
  'JEE Advanced': ['MCQ', 'Numerical', 'Match the Following'],
  'CBSE':         ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'ICSE':         ['MCQ', 'Short Answer', 'Long Answer'],
  'State Board':  ['MCQ', 'Short Answer', 'Long Answer'],
  'Kerala State': ['MCQ', 'Short Answer', 'Long Answer'],
  'Class 8':      ['MCQ', 'Short Answer', 'Long Answer'],
  'Class 9':      ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 10':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 11':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
  'Class 12':     ['MCQ', 'Assertion-Reason', 'Short Answer', 'Long Answer'],
};

export function defaultQTypesFor(examType) {
  if (!examType) return ['MCQ'];
  if (EXAM_QTYPES[examType]) return EXAM_QTYPES[examType];

  const cls = String(examType).match(/Class\s+(\d+)/i);
  if (cls && EXAM_QTYPES[`Class ${cls[1]}`]) return EXAM_QTYPES[`Class ${cls[1]}`];

  const board = String(examType).match(/^(CBSE|ICSE|State Board|Kerala State)\b/i);
  if (board) {
    const key = Object.keys(EXAM_QTYPES).find((k) => k.toLowerCase() === board[1].toLowerCase());
    if (key) return EXAM_QTYPES[key];
  }
  return ['MCQ'];
}
