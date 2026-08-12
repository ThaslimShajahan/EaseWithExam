/**
 * Syllabus helper — always reads live from syllabus_nodes (Admin > Syllabus).
 * Falls back to the hardcoded syllabusData.js only when the DB has no rows yet for
 * that exam type (e.g. a fresh deployment before an admin has entered NEET/JEE chapters).
 */

import { supabase } from './supabase';
import { getSyllabus as getSyllabusJS } from './syllabusData';

// Only these exam types have hardcoded chapter data in syllabusData.js.
// All other types (school boards like CBSE Class 8) must come from the DB
// — falling back to JS would show NEET chapters due to getSyllabusJS's own fallback.
const JS_KNOWN_EXAMS = new Set(['NEET', 'JEE Main', 'JEE Advanced']);

// Some older syllabus_nodes rows were saved as exam_type='CBSE' + class_level='10'
// rather than the combined key 'CBSE Class 10' the current admin UI writes. Try both
// forms so that older data isn't silently invisible to every reader.
function examTypeCandidates(examType, classLevel) {
  const candidates = [{ examType, classLevel }];
  const boardMatch = examType.match(/^(.+?)\s+Class\s+(\d+)$/);
  if (boardMatch) {
    const [, board, cls] = boardMatch;
    candidates.push({ examType: board, classLevel: cls });
  }
  return candidates;
}

/* ── `book` and deploy ordering ───────────────────────────────────────
 *
 * `book` names the textbook volume a chapter belongs to, for the subjects taught
 * from two SEPARATE books that each number chapters from 1 (English Hornbill vs
 * Woven Words, Hindi Kshitij vs Sparsh, Economics Development vs Statistics).
 * NULL means the subject has one book — every STEM row.
 *
 * SELECTING IT REQUIRES 20260812040000 TO BE APPLIED FIRST. PostgREST rejects a
 * select naming a column that does not exist, so this client against an
 * un-migrated database returns an error for every chapter read.
 *
 * Unlike 20260810070000 (the text[] signature change) this ordering constraint
 * runs ONE WAY only, and that asymmetry is the point: applying the migration
 * without deploying the client is completely safe — the old client simply does
 * not ask for the column. So apply the migration whenever, deploy the client
 * after. There is no window in which retrieval is degraded, and no need to pair
 * them in a single session.
 */

/**
 * Builds a chapter_key.
 *
 * THIS IS THE MECHANISM THAT CARRIES UNIQUENESS FOR MULTI-BOOK SUBJECTS, not the
 * `book` column. syllabus_nodes is UNIQUE on (exam_type, subject, chapter_key),
 * and `book` is deliberately not in that key — it is nullable, and Postgres
 * treats NULLs as distinct, so including it would stop the index protecting the
 * 148 single-book STEM rows against duplicates. Folding the book into the KEY
 * satisfies the existing constraint untouched. See 20260812040000.
 *
 * `book` is the SHORT volume label ('Hornbill', not 'ENGLISH HORN BILL'), and
 * the identical string goes into the syllabus_nodes.book column — one value, two
 * uses, so the key and the column can never disagree about which book a row is.
 *
 *   chapterKeyFor({ classLevel: '11', book: 'Hornbill', chapterName: 'The Portrait of a Lady' })
 *     -> 'c11_hornbill_the_portrait_of_a_lady'
 *   chapterKeyFor({ classLevel: '10', chapterName: 'Real Numbers' })
 *     -> 'c10_real_numbers'          (unchanged: single-book subjects keep today's shape)
 *
 * `prefix` exists because Kerala rows use k10_ rather than c10_ — a key that
 * reads as CBSE inside a Kerala row is a trap for whoever greps for it later.
 */
export function chapterKeyFor({ prefix = 'c', classLevel, book = null, chapterName }) {
  const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const bookSlug = book ? slug(book) : '';
  return [`${prefix}${classLevel ?? ''}`, bookSlug, slug(chapterName)].filter(Boolean).join('_');
}

/**
 * Returns chapters for a given exam + subject.
 * Shape: Array<{ key: string, name: string, book?: string|null, class_level?: string }>
 *
 * Always queries syllabus_nodes first; falls back to the hardcoded JS list
 * (NEET/JEE only) if the DB has no active rows for this exam/subject yet.
 */
export async function getChapters(examType, subject, classLevel = null) {
  for (const cand of examTypeCandidates(examType, classLevel)) {
    try {
      let q = supabase
        .from('syllabus_nodes')
        .select('chapter_key, chapter_name, book, class_level, sort_order, subtopics')
        .eq('exam_type', cand.examType)
        .eq('subject', subject)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cand.classLevel) q = q.eq('class_level', String(cand.classLevel));

      const { data, error } = await q;
      if (!error && data?.length) {
        return data.map((r) => ({
          key:         r.chapter_key,
          name:        r.chapter_name,
          book:        r.book        ?? null,
          class_level: r.class_level ?? null,
          subtopics:   r.subtopics   ?? [],
        }));
      }
    } catch { /* try next candidate */ }
  }
  return _fromJS(examType, subject, classLevel);
}

/**
 * Returns all chapters across subjects for an exam type.
 * Shape: Record<subject, Chapter[]>
 */
export async function getAllChapters(examType, classLevel = null) {
  const jsFallback = () =>
    JS_KNOWN_EXAMS.has(examType) ? (getSyllabusJS(examType) ?? {}) : {};

  for (const cand of examTypeCandidates(examType, classLevel)) {
    try {
      let q = supabase
        .from('syllabus_nodes')
        .select('subject, chapter_key, chapter_name, book, class_level, sort_order, subtopics')
        .eq('exam_type', cand.examType)
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cand.classLevel) q = q.eq('class_level', String(cand.classLevel));

      const { data, error } = await q;
      if (!error && data?.length) {
        const bySubject = {};
        data.forEach((r) => {
          if (!bySubject[r.subject]) bySubject[r.subject] = [];
          bySubject[r.subject].push({
            key:         r.chapter_key,
            name:        r.chapter_name,
            book:        r.book        ?? null,
            class_level: r.class_level ?? null,
            subtopics:   r.subtopics   ?? [],
          });
        });
        return bySubject;
      }
    } catch { /* try next candidate */ }
  }
  return jsFallback();
}

/**
 * Returns the distinct list of subjects an exam type actually has chapters for
 * (Admin > Syllabus), so subject pickers reflect what admin has entered instead
 * of a hardcoded catalogue. Returns [] if the DB has no rows for this exam type.
 */
export async function getLiveSubjects(examType, classLevel = null) {
  for (const cand of examTypeCandidates(examType, classLevel)) {
    try {
      let q = supabase
        .from('syllabus_nodes')
        .select('subject')
        .eq('exam_type', cand.examType)
        .eq('is_active', true);

      if (cand.classLevel) q = q.eq('class_level', String(cand.classLevel));

      const { data, error } = await q;
      if (!error && data?.length) {
        return [...new Set(data.map((r) => r.subject).filter(Boolean))];
      }
    } catch { /* try next candidate */ }
  }
  return [];
}

/**
 * Chapter list for content-driven features (e.g. Important Q&A) that need to
 * work even when Admin > Syllabus hasn't been populated for a board/class yet.
 * School-board content is usually uploaded to study_notes/pyq_questions well
 * before anyone fills in syllabus_nodes for that class — so this merges all
 * three sources (syllabus_nodes via getChapters(), published study_notes'
 * chapter+unit tags, and pyq_questions' chapter tags) instead of depending on
 * syllabus_nodes alone.
 *
 * Returns unit-grouped chapters: [{ unit: string|null, chapters: string[] }].
 * Chapters with no known unit (typical for NEET/JEE, which don't tag units)
 * collect under unit: null.
 */
export async function getStudyChapters(examType, subject, classLevel = null) {
  const [syllabusChapters, notesRes, pyqRes] = await Promise.all([
    getChapters(examType, subject, classLevel),
    supabase.from('study_notes')
      .select('chapter, unit, sort_order')
      .eq('exam_type', examType).eq('subject', subject)
      .eq('is_published', true).is('centre_id', null),
    supabase.from('pyq_questions')
      .select('chapter')
      .eq('exam_type', examType).eq('subject', subject)
      .neq('question_type', 'KB_NOTE'),
  ]);

  const unitOf = new Map(); // chapter name (lowercased) -> unit label
  const sortOf = new Map(); // chapter name (lowercased) -> sort_order
  const order  = [];        // first-seen chapter names, original casing
  const seen   = new Set();

  const add = (name, unit, sortOrder) => {
    if (!name?.trim()) return;
    const key = name.trim().toLowerCase();
    if (!seen.has(key)) { seen.add(key); order.push(name.trim()); }
    if (unit && !unitOf.has(key)) unitOf.set(key, unit);
    if (sortOrder != null && !sortOf.has(key)) sortOf.set(key, sortOrder);
  };

  syllabusChapters.forEach((c, i) => add(c.name, null, i));
  (notesRes.data ?? []).forEach((n) => add(n.chapter, n.unit, n.sort_order));
  (pyqRes.data ?? []).forEach((p) => add(p.chapter, null, null));

  order.sort((a, b) => {
    const sa = sortOf.get(a.toLowerCase()) ?? 999;
    const sb = sortOf.get(b.toLowerCase()) ?? 999;
    return sa - sb || a.localeCompare(b, undefined, { numeric: true });
  });

  const groups = new Map(); // unit label (or null) -> chapter names[]
  for (const name of order) {
    const unit = unitOf.get(name.toLowerCase()) ?? null;
    if (!groups.has(unit)) groups.set(unit, []);
    groups.get(unit).push(name);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([unit, chapters]) => ({ unit, chapters }));
}

function _fromJS(examType, subject, classLevel = null) {
  if (!JS_KNOWN_EXAMS.has(examType)) return [];
  const syllabus = getSyllabusJS(examType);
  const chapters = syllabus?.[subject] ?? [];
  // book: null — the JS fallback covers NEET/JEE only, which are single-book by
  // nature. Kept in the shape so callers never have to branch on the source.
  const mapped = chapters.map((c) => ({ key: c.key, name: c.name, book: null, class_level: c.class ?? null, subtopics: [] }));
  if (!classLevel) return mapped;
  return mapped.filter((c) => !c.class_level || c.class_level === String(classLevel));
}
