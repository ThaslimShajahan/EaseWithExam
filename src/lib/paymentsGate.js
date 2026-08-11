/**
 * Site-wide payments kill switch.
 *
 * WHY THIS EXISTS
 *   The bank account behind Razorpay is not active yet, so no payment can
 *   actually complete. Worse, `create-razorpay-order` — the first server call
 *   in the checkout flow — is present in source but **not deployed**, so it
 *   returns HTTP 404. A student clicking a paid plan today gets
 *   "Could not start checkout. Please try again.", which reads as a transient
 *   glitch and invites them to keep trying. Campaign traffic would hit that.
 *
 *   This replaces the retry-me error with an honest "payments open on the 14th".
 *
 * POLARITY IS DELIBERATE — the flag is `payments_enabled`, not
 * `payments_disabled`.
 *   getFeatureFlag() returns `flags[key] ?? false`, so a missing row, an
 *   unreachable `feature_flags` table, or a failed fetch all read as FALSE.
 *   With this polarity every one of those failures leaves payments OFF, which
 *   is the safe direction for money. Naming it `payments_disabled` would invert
 *   that: a transient DB blip would read as "not disabled" and re-open a
 *   checkout that cannot complete.
 *
 *   This is the same reasoning as `answer_verification_off`, not a departure
 *   from it. That flag is opt-OUT because the safe default is verification ON;
 *   this one is opt-IN because the safe default is payments OFF. Both default
 *   to the safe state when the row is missing.
 *
 * TO RE-ENABLE ON 14 AUGUST
 *   Admin → Platform → Feature Flags → turn ON `payments_enabled`.
 *   No deploy, no code change. See docs/ACTION_ITEMS_FOR_YOU.md.
 */
import { getFeatureFlag, useFeatureFlag } from './featureFlags';

export const PAYMENTS_FLAG = 'payments_enabled';

/** Shown wherever a purchase CTA would otherwise be. */
export const PAYMENTS_CLOSED_TITLE = 'Payments open on 14 August';

export const PAYMENTS_CLOSED_BODY =
  'We are finishing our payment setup. Premium plans go on sale on 14 August — '
  + 'until then everything on the free plan works exactly as normal.';

/** Passed to onFailure() so the checkout path fails with a real reason. */
export const PAYMENTS_CLOSED_ERROR =
  'Payments open on 14 August. Nothing has been charged.';

/** Async check, for lib code outside React. Defaults to disabled. */
export async function arePaymentsEnabled() {
  return getFeatureFlag(PAYMENTS_FLAG);
}

/**
 * React hook.
 *
 * `loading` matters at the call sites: while flags are in flight the value is
 * false, and rendering a purchase button on the strength of that would flash a
 * CTA that is about to be withdrawn. Call sites treat loading as "not yet
 * enabled" and render the notice or a disabled control, never a live button.
 */
export function usePaymentsEnabled() {
  const { value, loading } = useFeatureFlag(PAYMENTS_FLAG);
  return { enabled: value, loading };
}
