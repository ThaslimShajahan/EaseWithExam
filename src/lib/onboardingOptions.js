/**
 * Onboarding board/class/exam-type option catalog — admin-editable via
 * Admin > Platform > Onboarding, backed by the `onboarding_category_display`
 * table (migration 20260806190000_onboarding_category_display.sql).
 *
 * Same live-binding pattern as lib/categories.js: the exported arrays below
 * start out holding hardcoded fallback values, then get REPLACED in place by
 * loadOnboardingOptions() once the DB fetch resolves at app boot (see
 * main.jsx) — so OnboardingPage.jsx never needs to know whether it's reading
 * the fallback or the live data.
 *
 * What's saved to a student's profile (target_exam/syllabus/class_level) is
 * always the `key` field below; the PRESENTATION (icon, title, description,
 * order) is admin-editable.
 *
 * The flow is now class -> board -> competitive exam. Class and board are
 * always asked and always first, so `target_exam` holds the OPTIONAL
 * competitive add-on ('NONE' | 'NEET' | 'JEE_MAIN' | 'JEE_ADVANCED' | 'BOTH')
 * rather than doubling as a class level. The old CLASS_* exam keys are
 * retired from the picker but still resolve downstream via
 * normalizeExamType()'s legacy map, so existing profile rows keep working.
 */

import { supabase } from './supabase';

// Step 3 — the OPTIONAL competitive add-on, asked after class and board.
// `allowed_class_levels` gates which classes are offered each option: a Class 8
// student is never shown NEET. An empty array means "offer for every class",
// which is what the board-only 'NONE' option uses.
const FALLBACK_EXAM_OPTIONS = [
  { key: 'NONE',         title: 'Board exams only', description: 'Focus on my school syllabus',    icon_name: 'BookOpen',     color: 'slate',   allowed_class_levels: [] },
  { key: 'NEET',         title: 'NEET UG',          description: 'Medical entrance — PCB',         icon_name: 'Dna',          color: 'rose',    allowed_class_levels: ['11', '12', 'REPEATER'] },
  { key: 'JEE_MAIN',     title: 'JEE',              description: 'Engineering entrance — PCM',     icon_name: 'Atom',         color: 'blue',    allowed_class_levels: ['11', '12', 'REPEATER'] },
  { key: 'JEE_ADVANCED', title: 'JEE Advanced',     description: 'IIT entrance — advanced PCM',    icon_name: 'FlaskConical', color: 'violet',  allowed_class_levels: ['11', '12', 'REPEATER'] },
  { key: 'BOTH',         title: 'NEET + JEE',       description: 'Double preparation',             icon_name: 'Rocket',       color: 'amber',   allowed_class_levels: ['11', '12', 'REPEATER'] },
];

const FALLBACK_BOARD_OPTIONS = [
  { key: 'CBSE',         title: 'CBSE',         description: 'Central Board of Secondary Education', icon_name: 'BookOpen', color: 'blue' },
  { key: 'KERALA_STATE', title: 'Kerala State', description: 'SCERT Kerala',                         icon_name: 'TreePalm', color: 'teal' },
];

const FALLBACK_CLASS_OPTIONS = [
  { key: '8',        title: 'Class 8',            description: '',                          icon_name: 'BookOpen',      color: 'sky'     },
  { key: '9',        title: 'Class 9',            description: '',                          icon_name: 'BookOpen',      color: 'sky'     },
  { key: '10',       title: 'Class 10',           description: '',                          icon_name: 'BookOpen',      color: 'blue'    },
  { key: '11',       title: 'Class 11',           description: '',                          icon_name: 'Sprout',        color: 'green'   },
  { key: '12',       title: 'Class 12',           description: '',                          icon_name: 'GraduationCap', color: 'emerald' },
  { key: 'REPEATER', title: 'Repeater / Dropper', description: 'Gap year / second attempt', icon_name: 'RotateCcw',     color: 'amber'   },
];

export let EXAM_OPTIONS  = FALLBACK_EXAM_OPTIONS;
export let BOARD_OPTIONS = FALLBACK_BOARD_OPTIONS;
export let CLASS_OPTIONS = FALLBACK_CLASS_OPTIONS;

let _loaded = false;

/** Fetch onboarding_category_display from the DB and replace the live bindings above. Call once at app boot. */
export async function loadOnboardingOptions() {
  if (_loaded) return;
  return _fetchAndApply();
}

/** Re-fetch and re-apply regardless of prior load state — call after an admin edit so the current tab reflects it immediately. */
export async function refreshOnboardingOptions() {
  return _fetchAndApply();
}

async function _fetchAndApply() {
  try {
    const { data, error } = await supabase.rpc('get_onboarding_options');
    if (error || !data?.length) return; // keep hardcoded fallback

    const byType = { exam: [], board: [], class: [] };
    for (const row of data) {
      const opt = {
        key: row.option_key,
        title: row.title,
        description: row.description || '',
        icon_name: row.icon_name,
        color: row.color,
        // Class and board are now always asked, and asked first, so
        // needs_board/needs_class/default_class_level no longer drive the
        // flow — carried through only so the admin editor keeps round-tripping
        // the stored values. allowed_class_levels is what gates step 3 now.
        needs_board: row.needs_board,
        needs_class: row.needs_class,
        default_class_level: row.default_class_level,
        allowed_class_levels: row.allowed_class_levels ?? [],
      };
      (byType[row.option_type] ??= []).push(opt);
    }

    if (byType.exam.length)  EXAM_OPTIONS  = byType.exam;
    if (byType.board.length) BOARD_OPTIONS = byType.board;
    if (byType.class.length) CLASS_OPTIONS = byType.class;
    _loaded = true;
  } catch {
    // Network/DB error — keep hardcoded fallback, don't block onboarding on it.
  }
}
