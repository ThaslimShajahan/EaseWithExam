/* global __BUILD_ID__ */
/**
 * "A new version is available" — noticing that this open page is older than
 * what is deployed (2026-09-25).
 *
 * Why: a page left open in a phone browser or an installed web app is resumed
 * from memory without reloading. After a deploy it keeps running the old code
 * — which is how a student hit "AI proxy error 401" hours after security pass 2.
 *
 * How: every build bakes its id into the bundle (__BUILD_ID__) and writes the
 * same id to /version.json. The app re-reads /version.json when the tab comes
 * back into view (at most once a minute) and every 15 minutes; a different id
 * means a newer deploy is live. Not run in the Android app — its bundle ships
 * inside the APK and never matches the website's.
 */
import { Capacitor } from '@capacitor/core';

export const CURRENT_BUILD = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev';
export const CHECK_EVERY_MS = 15 * 60_000;
export const MIN_GAP_MS = 60_000;
export const UPDATE_EVENT = 'ewe:update-available';

let available = false;
let lastCheck = 0;

export const isUpdateAvailable = () => available;

/** Pure: is the deployed build different from the running one? */
export function isNewerBuild(deployed, current = CURRENT_BUILD) {
  return typeof deployed === 'string' && deployed.length > 0 && current !== 'dev' && deployed !== current;
}

/** Fetches /version.json (never from any cache). Resolves true if an update is live. */
export async function checkForUpdate({ force = false, fetchImpl = fetch, now = Date.now } = {}) {
  if (available) return true;
  if (!force && now() - lastCheck < MIN_GAP_MS) return false;
  lastCheck = now();
  try {
    const res = await fetchImpl(`/version.json?t=${now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const { build } = await res.json();
    if (isNewerBuild(build)) {
      available = true;
      window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: build }));
    }
  } catch { /* offline — try again later */ }
  return available;
}

/** Starts the background checks. Returns stop(). */
export function startVersionChecks() {
  if (Capacitor.isNativePlatform() || CURRENT_BUILD === 'dev') return () => {};
  const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(() => { if (document.visibilityState === 'visible') checkForUpdate({ force: true }); }, CHECK_EVERY_MS);
  return () => { document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
}

/**
 * Reload into the new version. If a service worker controls the page, ask it
 * to update first and wait (briefly) for the new one to take over — otherwise
 * the reload could be answered from the old worker's cache.
 */
export async function reloadToLatest() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    if (reg) {
      await reg.update();
      if (reg.installing || reg.waiting) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
          setTimeout(resolve, 6000);
        });
      }
    }
  } catch { /* reload regardless */ }
  window.location.reload();
}

/** Test hook only. */
export function _resetForTests() { available = false; lastCheck = 0; }
