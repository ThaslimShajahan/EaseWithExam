import { useEffect, useState } from 'react';
import { getLiveSubjects } from '../lib/syllabus';
import { getSubjectsForExam as getSubjectsStatic } from '../lib/categories';

/**
 * Live subject list for an exam type — reads DISTINCT subject from syllabus_nodes
 * (Admin > Syllabus), so admin-added subjects show up immediately. Falls back to
 * the hardcoded categories.js list while loading, or if the DB has no rows yet
 * for that exam type (e.g. exam types AdminSyllabus doesn't manage, like UPSC).
 */
export function useSyllabusSubjects(examType, classLevel = null) {
  const [subjects, setSubjects] = useState(() => getSubjectsStatic(examType));

  useEffect(() => {
    let cancelled = false;
    setSubjects(getSubjectsStatic(examType));
    if (!examType) return undefined;

    getLiveSubjects(examType, classLevel).then((live) => {
      if (!cancelled && live.length) setSubjects(live);
    });

    return () => { cancelled = true; };
  }, [examType, classLevel]);

  return subjects;
}
