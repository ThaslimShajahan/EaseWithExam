/**
 * Board / class / subject / competitive-exam catalog — admin-editable via
 * Admin > Platform > Categories, backed by the `exam_categories` table
 * (migration sql/0026_exam_categories.sql).
 *
 * The exported bindings below (CATEGORIES, BOARDS, CLASS_LEVELS,
 * EXAM_TYPE_GROUPS) start out holding the same hardcoded values this file
 * used to have as a fallback, then get REPLACED in place by loadCategories()
 * once the DB fetch resolves. ES module imports are live bindings, so every
 * file that does `import { BOARDS } from './categories'` automatically sees
 * the updated array on its next read — no consumer file needs to change.
 * loadCategories() is awaited once at app boot (see main.jsx/App.jsx) so by
 * the time any route renders, the live values are already in place.
 *
 * Caveat: a page already open in another tab when an admin edits categories
 * won't pick up the change until it's reloaded — this isn't a real-time
 * subscription, just a load-once-at-boot cache.
 */

import { supabase } from './supabase';

const SCHOOL_SUBJECTS_8_10  = ['Mathematics', 'Science', 'Social Studies', 'English', 'Hindi'];
const SCHOOL_SUBJECTS_11_12 = ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'English', 'Economics', 'Accountancy', 'Business Studies', 'Computer Science'];

const FALLBACK_CATEGORIES = {
  'NEET':         { label: 'NEET UG',     type: 'competitive', group: 'Medical',      subjects: ['Physics', 'Chemistry', 'Biology'] },
  'JEE Main':     { label: 'JEE',         type: 'competitive', group: 'Engineering',  subjects: ['Physics', 'Chemistry', 'Mathematics'] },
  'JEE Advanced': { label: 'JEE Adv.',    type: 'competitive', group: 'Engineering',  subjects: ['Physics', 'Chemistry', 'Mathematics'] },
  'CUET':         { label: 'CUET',        type: 'competitive', group: 'University',   subjects: ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'English', 'Economics', 'History', 'Political Science'] },
  'UPSC':         { label: 'UPSC CSE',    type: 'competitive', group: 'Government',   subjects: ['History', 'Geography', 'Polity', 'Economics', 'Science & Technology', 'Environment', 'Current Affairs'] },
  'SSC CGL':      { label: 'SSC CGL',     type: 'competitive', group: 'Government',   subjects: ['Quantitative Aptitude', 'English', 'General Awareness', 'Reasoning'] },
  'Olympiad':     { label: 'Olympiad',    type: 'competitive', group: 'Academic',     subjects: ['Physics', 'Chemistry', 'Biology', 'Mathematics', 'Astronomy'] },

  'Class 6':  { label: 'Class 6',  type: 'school', group: 'Middle School',  subjects: SCHOOL_SUBJECTS_8_10 },
  'Class 7':  { label: 'Class 7',  type: 'school', group: 'Middle School',  subjects: SCHOOL_SUBJECTS_8_10 },
  'Class 8':  { label: 'Class 8',  type: 'school', group: 'Middle School',  subjects: SCHOOL_SUBJECTS_8_10 },
  'Class 9':  { label: 'Class 9',  type: 'school', group: 'Middle School',  subjects: SCHOOL_SUBJECTS_8_10 },
  'Class 10': { label: 'Class 10', type: 'school', group: 'High School',    subjects: [...SCHOOL_SUBJECTS_8_10, 'Sanskrit'] },
  'Class 11': { label: 'Class 11', type: 'school', group: 'Senior School',  subjects: SCHOOL_SUBJECTS_11_12 },
  'Class 12': { label: 'Class 12', type: 'school', group: 'Senior School',  subjects: SCHOOL_SUBJECTS_11_12 },

  'CBSE':        { label: 'CBSE Board',  type: 'board', group: 'National Board', subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Physics', 'Chemistry', 'Biology', 'Computer Science'] },
  'ICSE':        { label: 'ICSE',        type: 'board', group: 'National Board', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics', 'Geography', 'Computer Applications'] },
  'State Board': { label: 'State Board', type: 'board', group: 'State Board',    subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Physics', 'Chemistry', 'Biology'] },
  'Kerala State': { label: 'Kerala State', type: 'board', group: 'Kerala State', subjects: ['Mathematics', 'Science', 'English', 'Hindi', 'Social Studies', 'Physics', 'Chemistry', 'Biology'] },

  'CBSE Class 6':  { label: 'CBSE Class 6',  type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_8_10 },
  'CBSE Class 7':  { label: 'CBSE Class 7',  type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_8_10 },
  'CBSE Class 8':  { label: 'CBSE Class 8',  type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_8_10 },
  'CBSE Class 9':  { label: 'CBSE Class 9',  type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_8_10 },
  'CBSE Class 10': { label: 'CBSE Class 10', type: 'school', group: 'CBSE', subjects: [...SCHOOL_SUBJECTS_8_10, 'Sanskrit'] },
  'CBSE Class 11': { label: 'CBSE Class 11', type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_11_12 },
  'CBSE Class 12': { label: 'CBSE Class 12', type: 'school', group: 'CBSE', subjects: SCHOOL_SUBJECTS_11_12 },

  'ICSE Class 6':  { label: 'ICSE Class 6',  type: 'school', group: 'ICSE', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics'] },
  'ICSE Class 7':  { label: 'ICSE Class 7',  type: 'school', group: 'ICSE', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics'] },
  'ICSE Class 8':  { label: 'ICSE Class 8',  type: 'school', group: 'ICSE', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics'] },
  'ICSE Class 9':  { label: 'ICSE Class 9',  type: 'school', group: 'ICSE', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics'] },
  'ICSE Class 10': { label: 'ICSE Class 10', type: 'school', group: 'ICSE', subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History & Civics', 'Geography', 'Computer Applications'] },
  'ICSE Class 11': { label: 'ICSE Class 11', type: 'school', group: 'ICSE', subjects: SCHOOL_SUBJECTS_11_12 },
  'ICSE Class 12': { label: 'ICSE Class 12', type: 'school', group: 'ICSE', subjects: SCHOOL_SUBJECTS_11_12 },

  'State Board Class 6':  { label: 'State Board Class 6',  type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_8_10 },
  'State Board Class 7':  { label: 'State Board Class 7',  type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_8_10 },
  'State Board Class 8':  { label: 'State Board Class 8',  type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_8_10 },
  'State Board Class 9':  { label: 'State Board Class 9',  type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_8_10 },
  'State Board Class 10': { label: 'State Board Class 10', type: 'school', group: 'State Board', subjects: [...SCHOOL_SUBJECTS_8_10, 'Sanskrit'] },
  'State Board Class 11': { label: 'State Board Class 11', type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_11_12 },
  'State Board Class 12': { label: 'State Board Class 12', type: 'school', group: 'State Board', subjects: SCHOOL_SUBJECTS_11_12 },

  'Kerala State Class 6':  { label: 'Kerala State Class 6',  type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_8_10 },
  'Kerala State Class 7':  { label: 'Kerala State Class 7',  type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_8_10 },
  'Kerala State Class 8':  { label: 'Kerala State Class 8',  type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_8_10 },
  'Kerala State Class 9':  { label: 'Kerala State Class 9',  type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_8_10 },
  'Kerala State Class 10': { label: 'Kerala State Class 10', type: 'school', group: 'Kerala State', subjects: [...SCHOOL_SUBJECTS_8_10, 'Sanskrit'] },
  'Kerala State Class 11': { label: 'Kerala State Class 11', type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_11_12 },
  'Kerala State Class 12': { label: 'Kerala State Class 12', type: 'school', group: 'Kerala State', subjects: SCHOOL_SUBJECTS_11_12 },
};

const FALLBACK_EXAM_TYPE_GROUPS = [
  { label: 'Competitive', icon: '🏆', items: ['NEET', 'JEE Main', 'JEE Advanced', 'CUET', 'UPSC', 'SSC CGL', 'Olympiad'] },
  { label: 'Classes',     icon: '📚', items: ['Class 6', 'Class 7', 'Class 8', 'Class 9', 'Class 10', 'Class 11', 'Class 12'] },
  { label: 'Boards',      icon: '🎓', items: ['CBSE', 'ICSE', 'State Board', 'Kerala State'] },
];

const FALLBACK_BOARDS       = ['CBSE', 'ICSE', 'State Board', 'Kerala State'];
const FALLBACK_CLASS_LEVELS = ['6', '7', '8', '9', '10', '11', '12'];

// Live, mutable bindings — reassigned in place by loadCategories() once the
// DB fetch resolves. Every importer sees the update automatically.
export let CATEGORIES       = FALLBACK_CATEGORIES;
export let EXAM_TYPE_GROUPS = FALLBACK_EXAM_TYPE_GROUPS;
export let BOARDS           = FALLBACK_BOARDS;
export let CLASS_LEVELS     = FALLBACK_CLASS_LEVELS;

let _loaded = false;

/** Fetch exam_categories from the DB and replace the live bindings above. Call once at app boot. */
export async function loadCategories() {
  if (_loaded) return;
  return _fetchAndApply();
}

/** Re-fetch and re-apply regardless of prior load state — call after an admin edit so the current tab reflects it immediately. */
export async function refreshCategories() {
  return _fetchAndApply();
}

async function _fetchAndApply() {
  try {
    const { data, error } = await supabase
      .from('exam_categories')
      .select('exam_key, label, category_kind, board_key, class_key, group_label, subjects, sort_order')
      .eq('is_active', true)
      .order('sort_order');
    if (error || !data?.length) return; // keep hardcoded fallback

    const categories = {};
    for (const row of data) {
      categories[row.exam_key] = {
        label:    row.label,
        type:     row.category_kind === 'competitive' ? 'competitive' : (row.category_kind === 'board' ? 'board' : 'school'),
        group:    row.group_label,
        subjects: row.subjects ?? [],
      };
    }

    const boards = data.filter((r) => r.category_kind === 'board').map((r) => r.board_key ?? r.exam_key);
    const classLevels = [...new Set(data.filter((r) => r.category_kind === 'class').map((r) => r.class_key).filter(Boolean))]
      .sort((a, b) => Number(a) - Number(b));

    const groups = [
      { label: 'Competitive', icon: '🏆', items: data.filter((r) => r.category_kind === 'competitive').map((r) => r.exam_key) },
      { label: 'Classes',     icon: '📚', items: data.filter((r) => r.category_kind === 'class').map((r) => r.exam_key) },
      { label: 'Boards',      icon: '🎓', items: data.filter((r) => r.category_kind === 'board').map((r) => r.exam_key) },
    ].filter((g) => g.items.length);

    CATEGORIES = categories;
    BOARDS = boards.length ? boards : FALLBACK_BOARDS;
    CLASS_LEVELS = classLevels.length ? classLevels : FALLBACK_CLASS_LEVELS;
    EXAM_TYPE_GROUPS = groups.length ? groups : FALLBACK_EXAM_TYPE_GROUPS;
    _loaded = true;
  } catch {
    // Network/DB error — keep hardcoded fallback, don't block app boot on it.
  }
}

export function getSubjectsForExam(examType) {
  return CATEGORIES[examType]?.subjects ?? ['Mathematics', 'Science', 'English'];
}

export function getAllExamTypes() {
  return Object.keys(CATEGORIES);
}

export function getExamLabel(examType) {
  return CATEGORIES[examType]?.label ?? examType;
}

export function getExamType(examType) {
  return CATEGORIES[examType]?.type ?? 'competitive';
}

// Onboarding saves underscore IDs (CLASS_10, JEE_MAIN…). Normalize to category keys.
// The CLASS_* entries are LEGACY — onboarding no longer offers them (class is
// its own step now) — but old profile rows still carry them, so they must keep
// resolving to a real CATEGORIES key.
const EXAM_ID_MAP = {
  CLASS_10:     'Class 10',
  CLASS_12:     'Class 12',
  CLASS_11:     'Class 11',
  CLASS_9:      'Class 9',
  // Was 'Class 8-9', which has never existed as a CATEGORIES key — it fell
  // through to the generic subject list instead of resolving to anything.
  CLASS_8_9:    'Class 9',
  CLASS_8:      'Class 8',
  JEE_MAIN:     'JEE Main',
  JEE_ADVANCED: 'JEE Advanced',
  BOTH:         'NEET',
  SSC:          'SSC CGL',
  OLYMPIAD:     'Olympiad',
};

export function normalizeExamType(raw) {
  if (!raw) return 'NEET';
  return EXAM_ID_MAP[raw] ?? raw;
}

// THE single, canonical way to turn a raw stored target_exam value
// ('CLASS_8_9', 'BOTH', 'NEET', ...) into display text. Every render site
// used to hand-roll its own `value.replace(/_/g, ' ')`, which reads fine for
// a single-word value but produces nonsense like "CLASS 8 9" for anything
// with a numeric suffix — that exact bug turned up independently in
// ProfilePage, Dashboard, the Sidebar exam badge, AdminStudents (both the
// edit-form dropdown and the list-row badge), and ParentDashboardPage before
// this was consolidated. Route every future display site through this
// function (or the <ExamLabel> component below for JSX call sites) instead
// of writing a sixth copy of the same fallback logic.
export function formatExamLabel(examValue, fallback = '—') {
  if (!examValue || examValue === 'NONE') return fallback;
  if (examValue === 'BOTH') return 'NEET + JEE';
  return getExamLabel(normalizeExamType(examValue));
}

// exam_type is often class-specific (e.g. "CBSE Class 8") — a bare board/exam
// name with no class suffix (e.g. "NEET") is competitive-exam content, not
// board content. Shared by every screen that filters admin-published content
// (papers, study notes, …) down to what a given student's profile should
// actually see, so a board student never gets shown another class's content.
export function isRelevantToStudent(examType, userProfile) {
  if (!examType) return false;
  const combo = examType.match(/^(.+?)\s+Class\s+(\d+)$/);
  if (combo) {
    const [, board, cls] = combo;
    // Compare through resolveBoard(), not against the raw `syllabus` value —
    // onboarding stores UPPER_SNAKE keys ('KERALA_STATE') while content is
    // tagged with the display name ('Kerala State'), so a direct === here
    // silently hid every state-board student's own content from them.
    return board === resolveBoard(userProfile?.syllabus) &&
           cls === String(userProfile?.class_level || '');
  }
  // No class suffix — competitive-exam content. Relevant only to a student
  // who actually has that competitive target ('NONE' matches nothing).
  const target = (userProfile?.target_exam || '').toUpperCase();
  if (!target || target === 'NONE') return false;
  const normalizedExam = examType.trim().toUpperCase().replace(/\s+/g, '_');
  if (target === 'BOTH') return normalizedExam === 'NEET' || normalizedExam.startsWith('JEE');
  return normalizedExam === target;
}

// Knowledge-base rows tag exam/class as a snake_case string in their `tags` array
// (e.g. "cbse_class_8", "jee_main") — set at upload time in AdminContentIntake.
// Shared here so every reader (admin library, student chapter browsers) agrees
// on both directions of the conversion instead of drifting apart.
// DERIVED from the live BOARDS list rather than hardcoded, because hardcoding
// is exactly how 'Kerala State' got missed: the old literal listed
// cbse_class_/icse_class_/state_board_class_ but not kerala_state_class_, so
// every Kerala State tag failed this test — it never produced a filter pill in
// AdminContentLibrary and leaked through PracticeGeneratorPage's
// "strip the exam tags to get topics" filter as if it were a chapter name.
// A getter (not a const) because BOARDS is reassigned in place by
// loadCategories() at boot; capturing the value once would freeze the fallback.
// A function, not an exported RegExp: BOARDS is reassigned in place by
// loadCategories() at boot, so a regex built at module-evaluation time would
// freeze whatever the fallback happened to contain.
export function isExamTag(tag) {
  if (!tag) return false;
  if (/^(neet|jee_)/.test(tag)) return true;
  return BOARDS.some((b) => tag.startsWith(`${examTypeToTag(b)}_class_`));
}

export function examTypeToTag(examType) {
  return examType ? examType.toLowerCase().replace(/\s+/g, '_') : null;
}

export function prettyExamTag(tag) {
  const competitive = tag
    .replace(/^neet$/, 'NEET')
    .replace(/^jee_main$/, 'JEE Main')
    .replace(/^jee_advanced$/, 'JEE Advanced');
  if (competitive !== tag) return competitive;

  // Board combos resolve off the same BOARDS list the tag was built from, so
  // any board an admin adds renders correctly without another literal here.
  for (const board of BOARDS) {
    const m = tag.match(new RegExp(`^${examTypeToTag(board)}_class_(\\d+)$`));
    if (m) return `${board} Class ${m[1]}`;
  }
  return tag.replace(/_/g, ' ');
}

/* ── Profile → exam context resolution ─────────────────────────
 * A student has TWO exam contexts at once, not one: their school context
 * (board + class, always present) and an optional competitive target. A
 * Class 12 CBSE student preparing for NEET genuinely needs both — the old
 * single-value buildExamType() forced a winner and picked the wrong one,
 * which is why students who chose NEET were being served CBSE Class N
 * content everywhere.
 */

// Onboarding stores UPPER_SNAKE board keys ('KERALA_STATE'); BOARDS holds the
// display form ('Kerala State'). The old inline
// `BOARDS.find(b => b.toUpperCase() === syllabus.toUpperCase())` compared
// 'KERALA STATE' to 'KERALA_STATE' and never matched, so state-board students
// resolved to no combo at all.
const BOARD_KEY_ALIASES = {
  KERALA_STATE: 'Kerala State',
  NA:           null,
};

export function resolveBoard(syllabus) {
  if (!syllabus) return null;
  if (syllabus in BOARD_KEY_ALIASES) {
    const alias = BOARD_KEY_ALIASES[syllabus];
    return alias && BOARDS.includes(alias) ? alias : null;
  }
  return BOARDS.find((b) => b.toUpperCase() === syllabus.toUpperCase()) ?? null;
}

// Competitive targets — everything that is NOT a board/school goal. 'NONE' is
// the explicit "board exams only" value written by onboarding.
const COMPETITIVE_TARGETS = new Set([
  'NEET', 'JEE_MAIN', 'JEE_ADVANCED', 'BOTH', 'CUET', 'UPSC', 'SSC', 'OLYMPIAD',
]);

/**
 * "CBSE Class 12" — the student's academic context.
 * Falls back to the bare "Class 12" key when the board+class combo isn't in
 * the catalog (e.g. a board that hasn't been added under Platform >
 * Categories yet), so those students still get class-appropriate content
 * instead of nothing at all. Null only when the class itself can't resolve.
 */
export function getSchoolExamType(profile) {
  const cls = profile?.class_level;
  if (!cls || !/^\d+$/.test(String(cls))) return null;   // e.g. 'REPEATER'
  const board = resolveBoard(profile?.syllabus);
  if (board && CATEGORIES[`${board} Class ${cls}`]) return `${board} Class ${cls}`;
  return CATEGORIES[`Class ${cls}`] ? `Class ${cls}` : null;
}

/** "NEET" | "JEE Main" | null — the optional competitive target. */
export function getCompetitiveExamType(profile) {
  const target = profile?.target_exam;
  if (!target || target === 'NONE') return null;
  if (!COMPETITIVE_TARGETS.has(target)) return null;   // legacy CLASS_* → school goal
  return normalizeExamType(target);
}

/**
 * Every exam key this student's content may match, competitive first.
 * Use for content FILTERS ("what may I see"); use the two helpers above
 * directly when a surface is specifically school- or competitive-only.
 */
export function getExamContexts(profile) {
  return [getCompetitiveExamType(profile), getSchoolExamType(profile)].filter(Boolean);
}

/**
 * Legacy single-value resolver, kept so existing call sites keep working.
 * Now prefers the COMPETITIVE target over the board+class combo — the
 * reverse of the old behaviour, which discarded the student's stated goal.
 * Prefer the explicit helpers above in new code.
 */
export function buildExamType(targetExam, syllabus, classLevel) {
  const profile = { target_exam: targetExam, syllabus, class_level: classLevel };
  return getCompetitiveExamType(profile)
      ?? getSchoolExamType(profile)
      ?? normalizeExamType(targetExam);
}
