/**
 * Referral system client.
 *
 * Backed by two RPCs:
 *   get_or_create_referral_code(p_uid)  -> { code, uses, credits_earned, pending }
 *   redeem_referral_code(p_uid, p_code) -> { ok, error? , status?, days_on_conversion? }
 *
 * Both verify the caller against the Firebase JWT server-side, so passing a uid
 * here is a convenience, not a trust boundary — a tampered uid gets a 42501.
 *
 * Rewards are TWO-PHASE (see 20260809070000_referral_convert_on_payment.sql):
 * redeeming a code only records a pending claim. Nothing is granted until the
 * referred student actually pays for a plan, at which point the database's
 * activate_subscription() — reachable only from the razorpay-verify edge
 * function, after the HMAC signature check — calls complete_referral() and
 * grants both sides 7 premium days.
 *
 * Nothing here can trigger a payout. That is the point: rewarding signups would
 * let one person mint premium days by creating accounts and redeeming from each.
 *
 * So `uses` counts CONVERTED referrals and `pending` counts claimed-but-unpaid
 * ones. A "credit" is a premium day.
 */

import { supabase } from './supabase';

export const REFERRAL_BONUS_DAYS = 7;

// Where a shared link points. Referral links land on the marketing page with
// ?ref=CODE; captureReferralFromUrl below stashes it until the account exists.
const SHARE_ORIGIN = 'https://easewithexam.com';
const PENDING_KEY  = 'ewe:pending-referral';

/**
 * The caller's own code, created on first call. Unlike the old read-only
 * get_user_referral this never returns empty for a signed-in user, which is
 * why the Profile card can now render unconditionally.
 */
export async function getOrCreateReferral(uid) {
  if (!uid) return null;
  const { data, error } = await supabase.rpc('get_or_create_referral_code', { p_uid: uid });
  if (error) throw error;
  return data?.[0] ?? null;
}

// Server error codes -> what the student reads. Every one of these is a normal
// thing to do by accident, so none of them are phrased as failures.
const REDEEM_MESSAGES = {
  invalid_code:     "We couldn't find that code. Check the spelling and try again.",
  self_referral:    "That's your own code — share it with a friend to earn days.",
  already_redeemed: 'This account has already used a referral code.',
  account_too_old:  'Referral codes can only be applied within 30 days of signing up.',
};

/**
 * Redeem a friend's code. Resolves to { ok, message } rather than throwing for
 * the expected rejections; only transport/permission failures throw.
 */
export async function redeemReferral(uid, code) {
  const trimmed = (code || '').trim();
  if (!trimmed) return { ok: false, message: 'Enter a referral code first.' };

  const { data, error } = await supabase.rpc('redeem_referral_code', {
    p_uid: uid,
    p_code: trimmed,
  });
  if (error) throw error;

  if (data?.ok) {
    const days = data.days_on_conversion ?? REFERRAL_BONUS_DAYS;
    return {
      ok: true,
      status: data.status ?? 'pending',
      days,
      // Deliberately explicit that nothing has been granted yet — telling a
      // student their premium is active when it is not is the one thing this
      // message must never do.
      message: `Code applied. You and your friend each get ${days} days of premium when you subscribe to a paid plan.`,
    };
  }
  return {
    ok: false,
    error: data?.error ?? 'unknown',
    message: REDEEM_MESSAGES[data?.error] ?? 'That code could not be applied.',
  };
}

export function referralShareUrl(code) {
  return `${SHARE_ORIGIN}/?ref=${encodeURIComponent(code || '')}`;
}

export function referralShareText(code) {
  return (
    `I'm prepping with EaseWithExam — AI practice papers, instant doubt-solving and ` +
    `real exam patterns. Use my code ${code} when you sign up, and we each get ` +
    `${REFERRAL_BONUS_DAYS} days of premium free once you go premium.` +
    `\n\n${referralShareUrl(code)}`
  );
}

/**
 * Called once at app start. A referral link arrives before the account exists,
 * so the code is parked in localStorage and applied after onboarding instead.
 * The query param is stripped so a page refresh doesn't re-arm it.
 */
export function captureReferralFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (!ref) return;
    localStorage.setItem(PENDING_KEY, ref.trim().toUpperCase());
    params.delete('ref');
    const qs = params.toString();
    window.history.replaceState(
      {}, '',
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash,
    );
  } catch { /* private mode / storage disabled — referral links just don't stick */ }
}

export function getPendingReferral() {
  try { return localStorage.getItem(PENDING_KEY) || null; } catch { return null; }
}

export function clearPendingReferral() {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
}

/**
 * Applies a parked referral code after signup. Silent by design: a stale or
 * already-used code must never block a student from finishing onboarding, so
 * every outcome clears the pending code and resolves rather than throws.
 */
export async function applyPendingReferral(uid) {
  const code = getPendingReferral();
  if (!code || !uid) return null;
  try {
    const result = await redeemReferral(uid, code);
    clearPendingReferral();
    return result;
  } catch {
    clearPendingReferral();
    return null;
  }
}
