/**
 * Students Online Now + registration feed (2026-09-25): the client-side
 * scheduling and labelling. The security half (own-row heartbeat, admin-only
 * feed) lives in the database and is verified live, not here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabase', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));

const { startHeartbeat, HEARTBEAT_INTERVAL_MS } = await import('../../hooks/useHeartbeat');
const { newlyOnboarded, registrationLabel, agoLabel } = await import('../../admin/hooks/useAdminLiveFeed');

function fakeDoc(initial = 'visible') {
  const listeners = {};
  return {
    visibilityState: initial,
    addEventListener: (t, f) => { (listeners[t] ??= new Set()).add(f); },
    removeEventListener: (t, f) => listeners[t]?.delete(f),
    fire(t) { listeners[t]?.forEach((f) => f()); },
    count: (t) => listeners[t]?.size ?? 0,
  };
}

describe('startHeartbeat', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends at once, then about every 60s while visible', () => {
    const send = vi.fn(() => Promise.resolve());
    const stop = startHeartbeat({ send, doc: fakeDoc() });
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 3);
    expect(send).toHaveBeenCalledTimes(4);
    stop();
  });

  it('pauses while hidden and reports on return (but not on a quick tab flick)', () => {
    const doc = fakeDoc();
    const send = vi.fn(() => Promise.resolve());
    startHeartbeat({ send, doc, now: () => Date.now() });
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange');
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 5);
    expect(send).toHaveBeenCalledTimes(1);                  // nothing while hidden

    doc.visibilityState = 'visible'; doc.fire('visibilitychange');
    expect(send).toHaveBeenCalledTimes(2);                  // back after 5 min → at once

    doc.visibilityState = 'hidden'; doc.fire('visibilitychange');
    vi.advanceTimersByTime(2_000);
    doc.visibilityState = 'visible'; doc.fire('visibilitychange');
    expect(send).toHaveBeenCalledTimes(2);                  // 2s flick → no extra write
  });

  it('never throws when the call fails, synchronously or not', async () => {
    const doc = fakeDoc();
    expect(() => startHeartbeat({ send: () => { throw new Error('boom'); }, doc })).not.toThrow();
    expect(() => startHeartbeat({ send: () => Promise.reject(new Error('401')), doc })).not.toThrow();
    await Promise.resolve();
  });

  it('does not send when started in a hidden tab, and stop() removes every listener', () => {
    const doc = fakeDoc('hidden');
    const send = vi.fn();
    const stop = startHeartbeat({ send, doc });
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(send).not.toHaveBeenCalled();
    stop();
    expect(doc.count('visibilitychange')).toBe(0);
    expect(doc.count('resume')).toBe(0);
  });
});

describe('registration feed helpers', () => {
  const r = (uid, status, extra = {}) => ({ uid, status, backfilled: false, name: 'Asha', class_level: '9', board: 'CBSE', ...extra });

  it('toasts nothing on the first poll (page load)', () => {
    expect(newlyOnboarded([r('a', 'onboarded')], null)).toEqual([]);
  });

  it('toasts only students who became onboarded since the last poll', () => {
    const known = new Set(['a']);
    const out = newlyOnboarded([r('a', 'onboarded'), r('b', 'onboarded'), r('c', 'onboarding_pending'), r('d', 'onboarded', { backfilled: true })], known);
    expect(out.map((x) => x.uid)).toEqual(['b']);
  });

  it('labels "New student: <name>, Class X <board>" parts', () => {
    expect(registrationLabel(r('a', 'onboarded'))).toBe('Asha, Class 9 CBSE');
    expect(registrationLabel({ name: '  ', class_level: null, board: null })).toBe('Unnamed student');
    expect(registrationLabel({ name: null, phone_number: '+919800000000', email: 'a@b.c', class_level: '8', board: 'KERALA_STATE' }))
      .toBe('+919800000000, Class 8 Kerala State');
    expect(registrationLabel({ name: '', phone_number: null, email: 'a@b.c', class_level: '10', board: 'CBSE' })).toBe('a@b.c, Class 10 CBSE');
  });

  it('agoLabel uses the server clock', () => {
    const now = Date.parse('2026-09-25T10:00:00Z');
    expect(agoLabel('2026-09-25T09:59:40Z', now)).toBe('just now');
    expect(agoLabel('2026-09-25T09:57:00Z', now)).toBe('3 min ago');
    expect(agoLabel('2026-09-25T07:00:00Z', now)).toBe('3 h ago');
  });
});
