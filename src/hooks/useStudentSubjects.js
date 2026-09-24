import { useAllowedSubjects, contextFor } from '../lib/allowedSubjects';

/**
 * The subject list a student should see for one exam.
 *
 * Since 2026-09-25 this is the SERVER's answer (allowed_subjects_for_caller),
 * not a client-side computation. The rules it applies are the same ones that
 * used to live here and in lib/studentSubjects.js — competitive exams use
 * their fixed list; school classes reconcile strictly against the stored
 * selection; Class 11–12 with no selection needs setup (see the 2026-08-14
 * history in lib/studentSubjects.js for why each rule exists) — plus two the
 * client never had: subjects an admin hid for this exam, and subjects with no
 * content, are removed. Doing it on the server means the Daily Mini Test's
 * save RPC enforces exactly the list every picker shows.
 *
 * Returns { subjects, isScoped, needsSetup, loading, notAllowed }:
 *   loading     — first answer not in yet; don't render "no subjects"
 *   needsSetup  — show the subject-setup prompt, never a guessed list
 *   notAllowed  — this exam isn't one of the student's own (e.g. a stale or
 *                 unresolved exam); show "coming soon"/setup, not a picker
 *
 * `classLevel` is accepted for call-site compatibility; the server derives
 * the class from the student's own profile.
 */
// eslint-disable-next-line no-unused-vars
export function useStudentSubjects(examType, classLevel = null) {
  const { contexts, loading } = useAllowedSubjects();
  const ctx = contextFor(contexts, examType);

  if (loading) return { subjects: [], isScoped: true, needsSetup: false, loading: true, notAllowed: false };
  if (!ctx)    return { subjects: [], isScoped: true, needsSetup: false, loading: false, notAllowed: true };
  return {
    subjects:   ctx.needs_setup ? [] : ctx.subjects,
    isScoped:   true,
    needsSetup: !!ctx.needs_setup,
    loading:    false,
    notAllowed: false,
  };
}
