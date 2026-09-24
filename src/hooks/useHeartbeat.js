import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../lib/supabase';

export const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * "Students Online Now" heartbeat. While the page (or the Android app) is
 * visible, tells the server "I'm here" about once a minute; stops while it is
 * hidden. The server only ever updates the caller's own row (touch_last_seen
 * takes no uid — identity is the Firebase token).
 *
 * Every failure is swallowed: presence is a nice-to-have and must never
 * surface an error or break a page.
 *
 * Pure scheduling logic, exported for tests. `send` is called with no args;
 * returns a stop() function.
 */
export function startHeartbeat({ send, doc = document, intervalMs = HEARTBEAT_INTERVAL_MS, now = () => Date.now() }) {
  let timer = null;
  let lastSent = 0;
  let stopped = false;

  const beat = () => {
    if (stopped || doc.visibilityState !== 'visible') return;
    lastSent = now();
    try { Promise.resolve(send()).catch(() => {}); } catch { /* ignore */ }
  };
  const schedule = () => {
    clearInterval(timer);
    timer = doc.visibilityState === 'visible' ? setInterval(beat, intervalMs) : null;
  };
  const onVisibility = () => {
    if (doc.visibilityState === 'visible') {
      // Coming back after a while: report at once rather than up to a minute
      // later — but not on every quick tab flick.
      if (now() - lastSent >= intervalMs / 2) beat();
    }
    schedule();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  // Capacitor fires these on the document when the Android app is backgrounded
  // or brought back; the WebView's visibilityState follows, this is a backstop.
  doc.addEventListener('resume', onVisibility);
  beat();
  schedule();

  return () => {
    stopped = true;
    clearInterval(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    doc.removeEventListener('resume', onVisibility);
  };
}

/** Runs the heartbeat for a signed-in student whose `users` row exists. */
export function useHeartbeat(uid) {
  useEffect(() => {
    if (!uid) return undefined;
    const platform = Capacitor.isNativePlatform() ? 'android' : 'web';
    return startHeartbeat({
      send: () => supabase.rpc('touch_last_seen', { p_platform: platform }),
    });
  }, [uid]);
}
