import { useEffect } from 'react';

/**
 * `ref` can be a single ref or an array of refs — the array form is for
 * callers with content rendered via createPortal (e.g. NotificationBell's
 * dropdown, portaled to document.body so it isn't clipped by a scrollable
 * ancestor). A portaled node is NOT a DOM descendant of the trigger it
 * logically belongs to, so `ref.current.contains(e.target)` alone always
 * misidentifies clicks inside the portaled content as "outside" — pass the
 * portal's own root ref too so it's excluded from that check as well.
 */
export function useOnClickOutside(ref, handler) {
  useEffect(() => {
    const refs = Array.isArray(ref) ? ref : [ref];
    const listener = (e) => {
      const inside = refs.some((r) => r?.current && r.current.contains(e.target));
      if (inside) return;
      handler(e);
    };
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}
