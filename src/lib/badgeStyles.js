/**
 * Centralized badge / chip color maps.
 * Import from here; do not define local DIFF_COLORS or EXAM_COLORS in pages.
 *
 * All strings produce Tailwind classes resolvable at build time.
 * Use the `badge` base class from index.css for shape + padding:
 *   <span className={`badge ${DIFFICULTY[d]}`}>{d}</span>
 */

/** Difficulty — green / amber / red. Never use red for a student's score. */
export const DIFFICULTY = {
  Easy:   'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Medium: 'bg-amber-50   text-amber-700   border border-amber-200',
  Hard:   'bg-red-50     text-red-700     border border-red-200',
  Mixed:  'bg-slate-100  text-slate-600   border border-slate-200',
};

/** Dark-surface variant (admin portal) */
export const DIFFICULTY_DARK = {
  Easy:   'bg-emerald-900/30 text-emerald-400 border border-emerald-700/30',
  Medium: 'bg-amber-900/30   text-amber-400   border border-amber-700/30',
  Hard:   'bg-red-900/30     text-red-400     border border-red-700/30',
  Mixed:  'bg-slate-700      text-slate-400   border border-slate-600',
};

/** Subject color — each maps to a distinct hue, never primary indigo. */
export const SUBJECT = {
  Physics:     'bg-blue-50    text-blue-700    border border-blue-200',
  Chemistry:   'bg-purple-50  text-purple-700  border border-purple-200',
  Biology:     'bg-emerald-50 text-emerald-700 border border-emerald-200',
  Botany:      'bg-green-50   text-green-700   border border-green-200',
  Zoology:     'bg-teal-50    text-teal-700    border border-teal-200',
  Mathematics: 'bg-orange-50  text-orange-700  border border-orange-200',
  Mixed:       'bg-slate-100  text-slate-600   border border-slate-200',
};

/** Exam type — indigo is reserved for NEET (flagship). */
export const EXAM_TYPE = {
  'NEET':         'bg-primary-50  text-primary-700  border border-primary-200',
  'JEE Main':     'bg-violet-50   text-violet-700   border border-violet-200',
  'JEE Advanced': 'bg-purple-50   text-purple-700   border border-purple-200',
  'CBSE':         'bg-sky-50      text-sky-700      border border-sky-200',
  'ICSE':         'bg-cyan-50     text-cyan-700     border border-cyan-200',
};

/** Status — used in admin review queue and content pipeline. */
export const STATUS = {
  published:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  in_review:  'bg-amber-50   text-amber-700   border border-amber-200',
  archived:   'bg-slate-100  text-slate-500   border border-slate-200',
  active:     'bg-emerald-50 text-emerald-700 border border-emerald-200',
  inactive:   'bg-slate-100  text-slate-500   border border-slate-200',
  pending:    'bg-amber-50   text-amber-700   border border-amber-200',
};

/** Plan / subscription tier */
export const PLAN = {
  free:             'bg-slate-100  text-slate-600   border border-slate-200',
  premium_monthly:  'bg-primary-50 text-primary-700 border border-primary-200',
  premium_yearly:   'bg-violet-50  text-violet-700  border border-violet-200',
  coaching:         'bg-amber-50   text-amber-700   border border-amber-200',
};

/** Convenience helper — returns DIFFICULTY with dark-mode fallback */
export function diffBadge(difficulty, dark = false) {
  const map = dark ? DIFFICULTY_DARK : DIFFICULTY;
  return map[difficulty] ?? (dark ? DIFFICULTY_DARK.Mixed : DIFFICULTY.Mixed);
}

/** Convenience helper for subject badges */
export function subjectBadge(subject) {
  return SUBJECT[subject] ?? SUBJECT.Mixed;
}

/** Convenience helper for exam type badges */
export function examBadge(examType) {
  return EXAM_TYPE[examType] ?? 'bg-slate-100 text-slate-600 border border-slate-200';
}
