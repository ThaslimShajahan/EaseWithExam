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

/**
 * Returns chapters for a given exam + subject.
 * Shape: Array<{ key: string, name: string, class_level?: string }>
 *
 * Always queries syllabus_nodes first; falls back to the hardcoded JS list
 * (NEET/JEE only) if the DB has no active rows for this exam/subject yet.
 */
export async function getChapters(examType, subject, classLevel = null) {
  for (const cand of examTypeCandidates(examType, classLevel)) {
    try {
      let q = supabase
        .from('syllabus_nodes')
        .select('chapter_key, chapter_name, class_level, sort_order, subtopics')
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
        .select('subject, chapter_key, chapter_name, class_level, sort_order, subtopics')
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
  const mapped = chapters.map((c) => ({ key: c.key, name: c.name, class_level: c.class ?? null, subtopics: [] }));
  if (!classLevel) return mapped;
  return mapped.filter((c) => !c.class_level || c.class_level === String(classLevel));
}
