/**
 * Translates Firebase Auth error codes into friendly, actionable copy.
 * Single source of truth — every place a Firebase Auth call is caught
 * (login/signup, OTP verify, Sign-in Methods linking) should route the
 * error through here instead of showing `err.message` raw, which is the
 * literal SDK string ("Firebase: Error (auth/account-exists-with-different-
 * credential).") with no explanation of what happened or what to do.
 *
 * A `null` entry means "not a real error from the user's perspective" —
 * callers should treat null as "clear/skip the error banner", not display
 * a generic fallback. auth/popup-closed-by-user is the main case: the user
 * just changed their mind, that's not a failure worth alarming them over.
 */
const FIREBASE_AUTH_ERRORS = {
  'auth/account-exists-with-different-credential':
    "This email is already linked to a different sign-in method on your account. Try signing in with your other method first, then link accounts from Sign-in Methods.",
  'auth/credential-already-in-use':
    'This account is already linked to a different EaseWithExam account.',
  'auth/email-already-in-use':
    'This email is already associated with a different account.',
  'auth/popup-closed-by-user':      null,
  'auth/cancelled-popup-request':   null,
  'auth/user-cancelled':            null,
  'auth/too-many-requests':
    'Too many attempts — please wait a few minutes and try again.',
  'auth/invalid-verification-code':
    "That code doesn't match. Check and try again.",
  'auth/code-expired':
    'That code has expired — request a new one.',
  'auth/network-request-failed':
    'Connection issue — check your internet and try again.',
  'auth/invalid-phone-number':
    'Enter a valid phone number.',
  'auth/missing-phone-number':
    'Enter a phone number first.',
  'auth/popup-blocked':
    'Your browser blocked the sign-in popup — please allow popups for this site and try again.',
  'auth/user-disabled':
    'This account has been disabled. Contact support if this seems wrong.',
  'auth/invalid-credential':
    "That code doesn't match. Check and try again.",
  'auth/quota-exceeded':
    "We've hit a temporary limit on verification codes — please try again in a few minutes.",
};

const GENERIC_FALLBACK = 'Something went wrong. Please try again.';

// A raw, untranslated Firebase SDK string looks like "Firebase: Error
// (auth/xyz)." — recognized so it's never shown even for a code this map
// doesn't have an entry for yet.
const RAW_FIREBASE_STRING = /^Firebase:\s*Error\s*\(auth\//i;

/**
 * @param {Error & { code?: string }} err
 * @returns {string | null} friendly message, or null if this shouldn't be
 *   shown as an error at all (e.g. user closed the popup themselves).
 */
export function mapAuthError(err) {
  if (!err) return GENERIC_FALLBACK;

  const code = err.code;
  if (code && Object.prototype.hasOwnProperty.call(FIREBASE_AUTH_ERRORS, code)) {
    return FIREBASE_AUTH_ERRORS[code];
  }

  // No recognized code — if the message is already our own friendly copy
  // (e.g. a plain Error thrown deliberately elsewhere in the app, like the
  // email-uniqueness conflict messages in AuthContext.jsx that aren't
  // Firebase codes at all), pass it through rather than masking it with a
  // generic fallback. Only swallow it if it looks like raw SDK text.
  const msg = err.message || '';
  if (msg && !RAW_FIREBASE_STRING.test(msg) && !/^auth\//.test(code || '')) {
    return msg;
  }

  return GENERIC_FALLBACK;
}
