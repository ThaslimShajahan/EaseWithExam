/**
 * 2026-09-25 release: consent-gated GA/Pixel, "new version available", and
 * ai-proxy's one-time token refresh on 401 session_expired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
vi.stubEnv('VITE_USE_EDGE_FUNCTIONS', 'true');

const native = vi.hoisted(() => ({ value: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.value } }));
const pixel = vi.hoisted(() => ({ initMetaPixel: vi.fn() }));
vi.mock('../metaPixel', () => pixel);
const tokens = vi.hoisted(() => ({ calls: [] }));
vi.mock('../firebaseToken', () => ({
  edgeFunctionHeaders: vi.fn(async (_extra, { forceRefresh = false } = {}) => {
    tokens.calls.push(forceRefresh);
    return { 'x-firebase-id-token': forceRefresh ? 'fresh' : 'stale' };
  }),
}));

const consent = await import('../consent');
const vc = await import('../versionCheck');
const { proxyFetch } = await import('../aiProxy');

beforeEach(() => {
  localStorage.clear();
  consent._resetForTests();
  vc._resetForTests();
  pixel.initMetaPixel.mockClear();
  tokens.calls = [];
  native.value = false;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  window.gtag = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('consent', () => {
  it('nothing chosen → not granted; the old banner\'s explicit Accept counts as granted', () => {
    expect(consent.getConsent()).toBeNull();
    localStorage.setItem('ewe_cookie_consent_v1', '1');
    expect(consent.getConsent()).toBe('granted');
  });

  it('Decline stores the choice and loads nothing', () => {
    consent.setConsent('denied');
    expect(consent.getConsent()).toBe('denied');
    expect(consent.loadTrackersIfConsented()).toBe(false);
    expect(window.gtag).not.toHaveBeenCalled();
    expect(pixel.initMetaPixel).not.toHaveBeenCalled();
  });

  it('never loads trackers under automation (the prerender browser)', () => {
    // simulate the headless build browser (jsdom has no navigator.webdriver)
    Object.defineProperty(window.navigator, 'webdriver', { value: true, configurable: true });
    try {
      localStorage.setItem(consent.CONSENT_KEY, 'granted');
      expect(consent.trackingAllowedHere()).toBe(false);
      expect(consent.loadTrackersIfConsented()).toBe(false);
    } finally {
      delete window.navigator.webdriver;
    }
  });

  it('never loads trackers in the Android app (it has no consent banner)', () => {
    native.value = true;
    expect(consent.trackingAllowedHere()).toBe(false);
  });

  it('dispatches a change event so the current page view can be counted after Accept', () => {
    const seen = [];
    const on = (e) => seen.push(e.detail);
    window.addEventListener(consent.CONSENT_EVENT, on);
    consent.setConsent('granted');
    window.removeEventListener(consent.CONSENT_EVENT, on);
    expect(seen).toEqual(['granted']);
  });
});

describe('version check', () => {
  it('isNewerBuild: only a different, real deployed id counts', () => {
    expect(vc.isNewerBuild('b2', 'b1')).toBe(true);
    expect(vc.isNewerBuild('b1', 'b1')).toBe(false);
    expect(vc.isNewerBuild('', 'b1')).toBe(false);
    expect(vc.isNewerBuild(undefined, 'b1')).toBe(false);
    expect(vc.isNewerBuild('b2', 'dev')).toBe(false);          // tests/dev builds never nag
  });

  it('reads /version.json bypassing caches, and throttles to once a minute', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ build: 'whatever' }) }));
    let t = 1_000_000;
    await vc.checkForUpdate({ fetchImpl, now: () => t });
    await vc.checkForUpdate({ fetchImpl, now: () => t + 5_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^\/version\.json\?t=\d+$/);
    expect(fetchImpl.mock.calls[0][1]).toEqual({ cache: 'no-store' });
    t += vc.MIN_GAP_MS;
    await vc.checkForUpdate({ fetchImpl, now: () => t });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('an offline check is harmless', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(vc.checkForUpdate({ force: true, fetchImpl })).resolves.toBe(false);
  });
});

describe('proxyFetch: one token refresh on 401 session_expired', () => {
  const resp = (status, body) => ({
    status, ok: status < 300, headers: new Headers(),
    json: async () => body, clone() { return resp(status, body); },
  });

  it('retries once with a force-refreshed token, and returns the retry', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(resp(401, { error: { message: 'Your session has expired…', code: 'session_expired' } }))
      .mockResolvedValueOnce(resp(200, { choices: [] }));
    const r = await proxyFetch('https://x/ai-proxy', { method: 'POST', body: '{}' });
    expect(r.status).toBe(200);
    expect(tokens.calls).toEqual([false, true]);
    expect(f.mock.calls[1][1].headers['x-firebase-id-token']).toBe('fresh');
  });

  it('does not retry other 401s (an outdated client is not fixed by a new token)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(401, { error: { code: 'client_outdated' } }));
    const r = await proxyFetch('https://x/ai-proxy', { method: 'POST' });
    expect(r.status).toBe(401);
    expect(tokens.calls).toEqual([false]);
  });

  it('retries at most once', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(401, { error: { code: 'session_expired' } }));
    const r = await proxyFetch('https://x/ai-proxy', { method: 'POST' });
    expect(r.status).toBe(401);
    // two ai-proxy calls, plus the version check a surviving 401 triggers
    expect(f.mock.calls.filter(([u]) => String(u).includes('ai-proxy'))).toHaveLength(2);
  });

  it('leaves successful responses untouched', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(resp(200, { ok: 1 }));
    const r = await proxyFetch('https://x/ai-proxy', { method: 'POST' });
    expect(await r.json()).toEqual({ ok: 1 });
    expect(tokens.calls).toEqual([false]);
  });
});
