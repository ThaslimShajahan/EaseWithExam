/**
 * Cookie consent — the one gate for GA4 and the Meta Pixel (owner decision
 * 2026-09-25: no tracking before consent, proper Accept and Decline).
 *
 * Nothing that tracks is loaded until the visitor presses Accept:
 *   - gtag.js is NOT in index.html any more — only the dataLayer stub with
 *     every consent type defaulted to denied. The loader is injected here.
 *   - the Meta Pixel base code (metaPixel.js) is only installed here.
 * Decline stores the choice and loads nothing. No choice = nothing loads.
 *
 * Never loads under automation (navigator.webdriver): the build's prerender
 * step runs the app in headless Chromium and saves the DOM — a Pixel injected
 * there was baked into the shipped HTML and broke fbq for every visitor.
 */
import { Capacitor } from '@capacitor/core';
import { initMetaPixel } from './metaPixel';

export const CONSENT_KEY = 'ewe_cookie_consent_v2';
const LEGACY_KEY = 'ewe_cookie_consent_v1';   // old banner: "1" = pressed Accept
export const GA_ID = 'G-HJND4GQL5D';
export const CONSENT_EVENT = 'ewe:consent-changed';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

/** 'granted' | 'denied' | null (not asked yet). */
export function getConsent() {
  const v = read(CONSENT_KEY);
  if (v === 'granted' || v === 'denied') return v;
  return read(LEGACY_KEY) === '1' ? 'granted' : null;   // an explicit Accept on the old banner
}

export const hasTrackingConsent = () => getConsent() === 'granted';

/** Browsers only, real visitors only, production only. */
export function trackingAllowedHere() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  if (navigator.webdriver) return false;              // prerender, headless tests, most bots
  if (Capacitor.isNativePlatform()) return false;     // the app has no consent banner
  return !!import.meta.env.PROD;
}

let loaded = false;
/** Loads GA + Pixel once, if (and only if) consent is granted. Safe to call repeatedly. */
export function loadTrackersIfConsented() {
  if (loaded || !hasTrackingConsent() || !trackingAllowedHere()) return false;
  loaded = true;
  if (typeof window.gtag === 'function') {
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  }
  initMetaPixel();
  return true;
}

/** Called by the banner. Stores the choice; Accept loads the trackers now. */
export function setConsent(value) {
  if (value !== 'granted' && value !== 'denied') return;
  try { localStorage.setItem(CONSENT_KEY, value); localStorage.removeItem(LEGACY_KEY); } catch { /* private mode */ }
  if (value === 'granted') loadTrackersIfConsented();
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: value }));
}

/** Test hook only. */
export function _resetForTests() { loaded = false; }
