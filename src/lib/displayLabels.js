/**
 * Display labels for stored profile keys — ONE place, used by every admin
 * screen (owner request 2026-09-25: "Kerala State", never "KERALA_STATE").
 *
 * Board / exam titles come from the onboarding option catalogue
 * (lib/onboardingOptions.js — admin-editable, loaded at boot, with a built-in
 * fallback), i.e. the exact words the student picked from. An unknown key is
 * humanised ("SOME_BOARD" → "Some Board") rather than shown raw; short
 * all-caps keys without underscores (CBSE, ICSE) are acronyms and stay as-is.
 */
import { BOARD_OPTIONS, EXAM_OPTIONS } from './onboardingOptions';

function humanise(key) {
  const s = String(key).trim();
  if (!s.includes('_') && s === s.toUpperCase()) return s;   // CBSE, ICSE, NEET
  return s.split(/[_\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
}

const titleFrom = (options, key) => options.find((o) => o.key === key)?.title;

/** 'KERALA_STATE' → 'Kerala State', 'CBSE' → 'CBSE', null → ''. */
export function boardLabel(key) {
  if (!key) return '';
  return titleFrom(BOARD_OPTIONS, key) ?? humanise(key);
}

/** 'JEE_ADVANCED' → 'JEE Advanced', 'NONE' → 'Board exams only', null → ''. */
export function examLabel(key) {
  if (!key) return '';
  return titleFrom(EXAM_OPTIONS, key) ?? humanise(key);
}

/**
 * What to call a student on an ADMIN screen: their name, else their mobile
 * number (phone signups), else their email (Google signups), else
 * "Unnamed student". Phone/email are only ever present in admin RPC results.
 */
export function studentDisplayName(s) {
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return pick(s?.name) ?? pick(s?.display_name) ?? pick(s?.phone_number) ?? pick(s?.email) ?? 'Unnamed student';
}
