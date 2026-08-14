import { useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useSyllabusSubjects } from './useSyllabusSubjects';
import { resolveStudentSubjects } from '../lib/studentSubjects';

/**
 * The subject list a student should see, scoped to their own selection.
 *
 * Drop-in replacement for useSyllabusSubjects() on every student-facing screen.
 * That hook answers "what does this board offer this class", which is the right
 * question for ADMIN screens and the wrong one for a student: it is why a CBSE
 * Class 12 Science student was being offered Accountancy and Psychology.
 *
 * Returns an object, not an array, because callers must handle `needsSetup` —
 * rendering `subjects` alone would show an empty picker to a student whose
 * selection is missing, which is the failure this exists to prevent. The shape
 * is deliberately awkward to ignore.
 *
 *   { subjects, isScoped, needsSetup }
 *
 * All decision logic lives in lib/studentSubjects.js so it is unit-testable
 * without React; this hook only supplies the two inputs.
 */
export function useStudentSubjects(examType, classLevel = null) {
  const { userProfile } = useAuth();

  // Callers usually already derive a class level for their exam type; fall back
  // to the profile's own so a screen cannot accidentally scope against nothing.
  const cls = classLevel ?? userProfile?.class_level ?? null;

  const boardSubjects = useSyllabusSubjects(examType, cls);
  const profileSubjects = userProfile?.subjects;

  return useMemo(
    () => resolveStudentSubjects({ profileSubjects, boardSubjects, classLevel: cls }),
    [profileSubjects, boardSubjects, cls],
  );
}
