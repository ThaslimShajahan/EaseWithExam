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
  'JEE Main':     { label: 'JEE Main',    type: 'competitive', group: 'Engineering',  subjects: ['Physics', 'Chemistry', 'Mathematics'] },
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
const EXAM_ID_MAP = {
  CLASS_10:     'Class 10',
  CLASS_12:     'Class 12',
  CLASS_11:     'Class 11',
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

// Build the best exam-type key from a student's profile fields.
// Prefers board+class combos (e.g. "CBSE Class 10") over standalone keys.
export function buildExamType(targetExam, syllabus, classLevel) {
  const base = normalizeExamType(targetExam);
  const board = BOARDS.find((b) => b.toUpperCase() === (syllabus ?? '').toUpperCase()) ?? null;
  if (board && classLevel && /^\d+$/.test(String(classLevel))) {
    const combo = `${board} Class ${classLevel}`;
    if (CATEGORIES[combo]) return combo;
  }
  return base;
}
