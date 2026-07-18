import { useEffect, useState } from 'react';

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsMobile  = () => useMediaQuery('(max-width: 767px)');
