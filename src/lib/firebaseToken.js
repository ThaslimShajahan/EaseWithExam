import { auth, adminAuth } from '../firebase/config';

/**
 * The current Firebase ID token for whoever is signed in here, or null.
 *
 * Every Supabase request carries it (supabase.js passes this as the client's
 * `accessToken`), and since security pass 2 (2026-09-25) every call to our own
 * edge functions carries it too, in `x-firebase-id-token` — ai-proxy, send-email,
 * send-push, connect-email, exam-scraper, pdf-proxy all verify it server-side.
 * Supabase validates it against Google's JWKS (Firebase is a third-party auth
 * provider), which makes `auth.jwt() ->> 'sub'` a PROVEN Firebase UID in
 * Postgres (verified_uid()).
 *
 * Admin and student sessions are deliberately separate Firebase app instances
 * (see firebase/config.js), so the right identity depends on where we are:
 * the admin portal authenticates via `adminAuth`, everything else via `auth`.
 * Falling back the other way keeps a signed-in identity attached rather than
 * dropping to anon.
 *
 * Returning null is normal — signed-out visitors hit public reads only.
 *
 * Its own module (moved out of supabase.js) because aiProxy.js needs it and
 * supabase.js already imports aiProxy.js — importing back would be a cycle.
 */
export async function currentFirebaseIdToken() {
  try {
    const onAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
    const primary  = onAdminRoute ? adminAuth : auth;
    const fallback = onAdminRoute ? auth      : adminAuth;
    const user = primary.currentUser ?? fallback.currentUser;
    return user ? await user.getIdToken() : null;
  } catch {
    return null;
  }
}

/**
 * Headers for calling our own edge functions. Authorization stays the anon key
 * so the gateway's JWT check is unchanged; the caller's Firebase ID token rides
 * in x-firebase-id-token, which the function verifies server-side
 * (supabase/functions/_shared/caller.ts, ai-proxy's authorize()). No function
 * trusts a caller_uid in the body any more.
 */
export async function edgeFunctionHeaders(extra = {}) {
  const idToken = await currentFirebaseIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization:  `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    ...(idToken ? { 'x-firebase-id-token': idToken } : {}),
    ...extra,
  };
}
