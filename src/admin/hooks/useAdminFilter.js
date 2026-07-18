import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Syncs a single filter key with a URL search param.
 * Defaults to `defaultValue` when the param is absent.
 *
 * Usage:
 *   const [exam, setExam] = useAdminFilter('exam', 'All');
 */
export function useAdminFilter(key, defaultValue = '') {
  const [searchParams, setSearchParams] = useSearchParams();

  const value = searchParams.get(key) ?? defaultValue;

  const setValue = useCallback((newVal) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (newVal === defaultValue || newVal === '' || newVal === null) {
        next.delete(key);
      } else {
        next.set(key, newVal);
      }
      return next;
    }, { replace: true });
  }, [key, defaultValue, setSearchParams]);

  return [value, setValue];
}
