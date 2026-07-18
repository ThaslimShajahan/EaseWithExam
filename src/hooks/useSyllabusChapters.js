import { useEffect, useState } from 'react';
import { getChapters } from '../lib/syllabus';

/** Live chapter list for an exam+subject, from Admin > Syllabus (syllabus_nodes). */
export function useSyllabusChapters(examType, subject, classLevel = null) {
  const [chapters, setChapters] = useState([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!examType || !subject) { setChapters([]); setLoading(false); return undefined; }
    setLoading(true);
    getChapters(examType, subject, classLevel).then((data) => {
      if (!cancelled) { setChapters(data); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [examType, subject, classLevel]);

  return { chapters, loading };
}
