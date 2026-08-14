import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { getSubjectsForExam, getExamType } from '../lib/categories';
import { resolveStudentSubjectsForExam } from '../lib/studentSubjects';

/**
 * The subject list a student should see, scoped to their own selection.
 *
 * Two independent bugs fixed here on 2026-08-14, chasing a report of
 * "I picked my subjects at onboarding, Exam Center / Practice Generator /
 * other tools still say I need to set them up, and Profile has no subject
 * editor to fix it from" (true — Profile's subject/board fields are
 * read-only; there is currently no self-service path once this fires).
 *
 * BUG 1 — competitive exam types (NEET, JEE Main, ...) were run through the
 * same board/school reconciliation, which always finds the student's extra
 * school-only subjects (English, Mathematics, ...) "missing" from the
 * competitive exam's fixed catalog and always blocks. See
 * resolveStudentSubjectsForExam's own doc comment in lib/studentSubjects.js
 * for the full reasoning and the real profile this was confirmed against.
 *
 * BUG 2 — the board catalog to reconcile against defaulted to content-
 * bearing subjects only (excludes Malayalam, Arabic, Urdu, Syriac, Physical
 * Education, Fine Arts, Home Science — real onboarding choices the platform
 * doesn't have content for yet). Fixed via getSubjectsForExam(examType,
 * { includeNonContent: true }) — the full catalog onboarding itself offers,
 * which is exactly what this comparison should use (see that function's own
 * doc comment).
 *
 * getSubjectsForExam/getExamType are live module bindings populated once at
 * app boot (see lib/categories.js) — no separate loading state needed here.
 *
 * Returns an object, not an array, because callers must handle `needsSetup` —
 * rendering `subjects` alone would show an empty picker to a student whose
 * selection is missing, which is the failure this exists to prevent. The shape
 * is deliberately awkward to ignore.
 *
 *   { subjects, isScoped, needsSetup }
 *
 * Decision logic lives in lib/studentSubjects.js so it stays unit-testable
 * without React; this hook only supplies its inputs.
 */
export function useStudentSubjects(examType, classLevel = null) {
  const { userProfile } = useAuth();

  // Callers usually already derive a class level for their exam type; fall back
  // to the profile's own so a screen cannot accidentally scope against nothing.
  const cls = classLevel ?? userProfile?.class_level ?? null;

  const boardSubjects = useMemo(
    () => getSubjectsForExam(examType, { includeNonContent: true }),
    [examType],
  );
  const isCompetitive = useMemo(() => getExamType(examType) === 'competitive', [examType]);
  const profileSubjects = userProfile?.subjects;

  return useMemo(
    () => resolveStudentSubjectsForExam({ profileSubjects, boardSubjects, classLevel: cls, isCompetitive }),
    [profileSubjects, boardSubjects, cls, isCompetitive],
  );
}
