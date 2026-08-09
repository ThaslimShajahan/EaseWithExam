import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: { rpc: vi.fn() },
}));

import { supabase } from '../supabase';
import {
  getOrCreateReferral,
  redeemReferral,
  referralShareUrl,
  referralShareText,
  captureReferralFromUrl,
  getPendingReferral,
  clearPendingReferral,
  applyPendingReferral,
  REFERRAL_BONUS_DAYS,
} from '../referral';

beforeEach(() => {
  supabase.rpc.mockReset();
  localStorage.clear();
});

describe('getOrCreateReferral', () => {
  it('unwraps the single row the RPC returns', async () => {
    supabase.rpc.mockResolvedValue({
      data: [{ code: 'EWEAB23CD', uses: 2, credits_earned: 14, pending: 1 }], error: null,
    });
    await expect(getOrCreateReferral('uid-1')).resolves.toEqual({
      code: 'EWEAB23CD', uses: 2, credits_earned: 14, pending: 1,
    });
    expect(supabase.rpc).toHaveBeenCalledWith('get_or_create_referral_code', { p_uid: 'uid-1' });
  });

  it('returns null without calling the RPC when there is no uid', async () => {
    await expect(getOrCreateReferral(null)).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('propagates transport errors — a missing code is not something to swallow', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('boom') });
    await expect(getOrCreateReferral('uid-1')).rejects.toThrow('boom');
  });
});

describe('redeemReferral', () => {
  it('reports a pending claim, not a grant', async () => {
    supabase.rpc.mockResolvedValue({
      data: { ok: true, status: 'pending', days_on_conversion: 7 },
      error: null,
    });
    const res = await redeemReferral('uid-b', 'EWEAB23CD');
    expect(res.ok).toBe(true);
    expect(res.status).toBe('pending');
    expect(res.days).toBe(7);
  });

  // Rewards only land once the referred student pays. Telling them premium is
  // already active would be a straight-up false claim.
  it('never says premium has been added', async () => {
    supabase.rpc.mockResolvedValue({
      data: { ok: true, status: 'pending', days_on_conversion: 7 }, error: null,
    });
    const { message } = await redeemReferral('uid-b', 'EWEAB23CD');
    expect(message).toMatch(/when you subscribe/i);
    expect(message).not.toMatch(/added to your account/i);
  });

  it('trims whitespace before sending — codes get pasted with padding', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: true, days_on_conversion: 7 }, error: null });
    await redeemReferral('uid-b', '  EWEAB23CD \n');
    expect(supabase.rpc).toHaveBeenCalledWith('redeem_referral_code', {
      p_uid: 'uid-b', p_code: 'EWEAB23CD',
    });
  });

  it('short-circuits an empty code without a round trip', async () => {
    const res = await redeemReferral('uid-b', '   ');
    expect(res.ok).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_code',     /couldn't find that code/i],
    ['self_referral',    /your own code/i],
    ['already_redeemed', /already used a referral code/i],
    ['account_too_old',  /within 30 days/i],
  ])('maps the %s rejection to a readable message', async (error, pattern) => {
    supabase.rpc.mockResolvedValue({ data: { ok: false, error }, error: null });
    const res = await redeemReferral('uid-b', 'EWEAB23CD');
    expect(res.ok).toBe(false);
    expect(res.error).toBe(error);
    expect(res.message).toMatch(pattern);
  });

  it('falls back to a generic message for an unrecognised code', async () => {
    supabase.rpc.mockResolvedValue({ data: { ok: false, error: 'something_new' }, error: null });
    const res = await redeemReferral('uid-b', 'EWEAB23CD');
    expect(res.ok).toBe(false);
    expect(res.message).toBe('That code could not be applied.');
  });
});

describe('share helpers', () => {
  it('builds a link that captureReferralFromUrl can read back', () => {
    expect(referralShareUrl('EWEAB23CD')).toBe('https://easewithexam.com/?ref=EWEAB23CD');
  });

  it('puts both the code and the link in the share text', () => {
    const text = referralShareText('EWEAB23CD');
    expect(text).toContain('EWEAB23CD');
    expect(text).toContain(referralShareUrl('EWEAB23CD'));
    expect(text).toContain(String(REFERRAL_BONUS_DAYS));
  });

  // The share message is the promise the product has to keep, so it has to
  // carry the same condition the database enforces.
  it('states the reward is conditional on going premium', () => {
    expect(referralShareText('EWEAB23CD')).toMatch(/once you go premium/i);
  });
});

describe('captureReferralFromUrl', () => {
  const setUrl = (url) => window.history.replaceState({}, '', url);

  afterEach(() => setUrl('/'));

  it('parks the code and strips the param so a refresh does not re-arm it', () => {
    setUrl('/?ref=eweab23cd');
    captureReferralFromUrl();
    expect(getPendingReferral()).toBe('EWEAB23CD');
    expect(window.location.search).toBe('');
  });

  it('keeps other query params and the hash intact', () => {
    setUrl('/?utm_source=wa&ref=EWEAB23CD#pricing');
    captureReferralFromUrl();
    expect(getPendingReferral()).toBe('EWEAB23CD');
    expect(window.location.search).toBe('?utm_source=wa');
    expect(window.location.hash).toBe('#pricing');
  });

  it('does nothing when there is no ref param', () => {
    setUrl('/?utm_source=wa');
    captureReferralFromUrl();
    expect(getPendingReferral()).toBeNull();
    expect(window.location.search).toBe('?utm_source=wa');
  });
});

describe('applyPendingReferral', () => {
  it('redeems a parked code and clears it', async () => {
    localStorage.setItem('ewe:pending-referral', 'EWEAB23CD');
    supabase.rpc.mockResolvedValue({ data: { ok: true, status: 'pending', days_on_conversion: 7 }, error: null });

    const res = await applyPendingReferral('uid-b');
    expect(res.ok).toBe(true);
    expect(getPendingReferral()).toBeNull();
  });

  // Onboarding fires this without awaiting; a throw here would surface as an
  // unhandled rejection on the student's very first screen.
  it('resolves and clears even when the RPC blows up', async () => {
    localStorage.setItem('ewe:pending-referral', 'EWEAB23CD');
    supabase.rpc.mockResolvedValue({ data: null, error: new Error('network') });

    await expect(applyPendingReferral('uid-b')).resolves.toBeNull();
    expect(getPendingReferral()).toBeNull();
  });

  it('clears a code that the server rejects, so it is not retried forever', async () => {
    localStorage.setItem('ewe:pending-referral', 'EWEAB23CD');
    supabase.rpc.mockResolvedValue({ data: { ok: false, error: 'invalid_code' }, error: null });

    const res = await applyPendingReferral('uid-b');
    expect(res.ok).toBe(false);
    expect(getPendingReferral()).toBeNull();
  });

  it('no-ops when nothing is parked', async () => {
    clearPendingReferral();
    await expect(applyPendingReferral('uid-b')).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
