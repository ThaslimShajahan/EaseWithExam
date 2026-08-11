import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

vi.mock('../supabase', () => ({ supabase: { from: vi.fn() } }));

describe('payments kill switch', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.restoreAllMocks(); });

  /**
   * The whole design rests on this: getFeatureFlag() resolves an absent row to
   * false, and the flag is named for the ENABLED state, so "we could not read
   * the flag" and "payments are off" are the same answer. If someone renames it
   * to payments_disabled, this is what should fail.
   */
  it('is disabled when the flag row does not exist', async () => {
    vi.doMock('../featureFlags', () => ({
      getFeatureFlag: async () => false,   // what a missing row returns
      useFeatureFlag: () => ({ value: false, loading: false }),
    }));
    const { arePaymentsEnabled } = await import('../paymentsGate');
    expect(await arePaymentsEnabled()).toBe(false);
  });

  it('is disabled when the flags table is unreachable', async () => {
    vi.doMock('../featureFlags', () => ({
      getFeatureFlag: async () => false,   // getFeatureFlag swallows errors -> false
      useFeatureFlag: () => ({ value: false, loading: false }),
    }));
    const { arePaymentsEnabled } = await import('../paymentsGate');
    expect(await arePaymentsEnabled()).toBe(false);
  });

  it('is enabled only when the flag is explicitly true', async () => {
    vi.doMock('../featureFlags', () => ({
      getFeatureFlag: async (k) => k === 'payments_enabled',
      useFeatureFlag: () => ({ value: true, loading: false }),
    }));
    const { arePaymentsEnabled, PAYMENTS_FLAG } = await import('../paymentsGate');
    expect(PAYMENTS_FLAG).toBe('payments_enabled');
    expect(await arePaymentsEnabled()).toBe(true);
  });

  it('blocks initiateRazorpayPayment before any Razorpay script loads', async () => {
    vi.doMock('../featureFlags', () => ({
      getFeatureFlag: async () => false,
      useFeatureFlag: () => ({ value: false, loading: false }),
    }));
    vi.doMock('../notifications', () => ({ createNotification: vi.fn() }));
    vi.doMock('../email', () => ({ sendTransactionalEmail: vi.fn() }));

    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    // A script tag appearing would mean checkout chrome began loading anyway.
    const appendSpy = vi.spyOn(document.head, 'appendChild');

    const { initiateRazorpayPayment } = await import('../subscription');
    const onFailure = vi.fn();
    await initiateRazorpayPayment({ planId: 'premium_monthly', firebaseUid: 'u1', onFailure });

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure.mock.calls[0][0]).toMatch(/14 August/);
    // Nothing was charged, nothing was requested, no third-party script loaded.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(appendSpy).not.toHaveBeenCalled();
  });
});

describe('payments kill switch — wiring', () => {
  it('gates both payment entry points, not just one', () => {
    // initiateRazorpayPayment is the backstop, but a user should never reach a
    // CTA that fails. Both callers must consult the gate themselves.
    for (const f of ['src/pages/PricingPage.jsx', 'src/components/ui/PaywallModal.jsx']) {
      expect(read(f), `${f} does not consult the payments gate`).toMatch(/usePaymentsEnabled/);
      expect(read(f), `${f} does not treat loading as closed`).toMatch(/paymentsClosed/);
    }
  });

  it('seeds the flag disabled', () => {
    const sql = read('supabase/migrations/20260811120000_payments_enabled_flag.sql');
    expect(sql).toMatch(/'payments_enabled',\s*\n?\s*false/);
    // Re-running the migration must never silently re-close payments after the
    // 14th, so the insert has to be a no-op when the row already exists.
    expect(sql).toMatch(/on conflict \(key\) do nothing/i);
  });

  it('documents the flag in the admin panel', () => {
    expect(read('src/admin/AdminFeatureFlags.jsx')).toMatch(/payments_enabled:/);
  });
});
