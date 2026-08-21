import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  GoogleAuthProvider,
  RecaptchaVerifier,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signInWithPhoneNumber,
  linkWithPhoneNumber,
  linkWithPopup,
  unlink,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth } from '../firebase/config';
import { getUser, upsertUser, updateUser, getSubscription, getUserByPhone } from '../lib/supabase';

const AuthContext = createContext(null);

// Captured once at module load (before React/React Router render anything) —
// reading window.location.search lazily inside AuthProvider's effect instead
// races several routes that are bare `<Navigate replace>` aliases (e.g.
// /practice → /exams?tab=practice): that redirect's own effect can rewrite
// the URL and drop this query param before AuthProvider's effect gets to
// read it, since both are child effects competing to run first.
const QA_BYPASS_UID = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get('qa_uid')
  : null;

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading,      setLoading]      = useState(true);
  // Set whenever fetching/creating the Supabase profile row fails for an
  // otherwise-authenticated Firebase user (RLS/RPC error, network drop,
  // anything). Route guards use this to show a real retry screen instead of
  // silently waiting forever on a `userProfile` that structurally can never
  // arrive once this has failed — see RequireNoAuth in App.jsx, which
  // previously had no escape from that wait at all.
  const [profileError, setProfileError] = useState(null);

  /* ── Supabase helpers ──────────────────────────────────── */

  const loadSubscription = async (uid) => {
    try {
      const sub = await getSubscription(uid);
      setSubscription(sub);
    } catch { setSubscription(null); }
  };

  // Derives the auth_method to upsert from Firebase's providerData rather
  // than a hardcoded literal — needed now that a single call site (see
  // onAuthStateChanged below) handles both Google and phone sign-in. Google
  // always wins if present, matching the pre-existing invariant that linking
  // a phone number to an existing Google account (the `wasLinking` path in
  // verifyOTP) never relabels auth_method as 'phone'.
  const deriveAuthMethod = (user) => {
    const providers = (user.providerData || []).map((p) => p.providerId);
    if (providers.includes('google.com')) return 'google';
    if (providers.includes('phone'))      return 'phone';
    return 'google';
  };

  // The single write shape used both on initial sign-in and on retry — see
  // callers below. Kept as one function so the two paths can't drift apart.
  const upsertProfileFor = (user) =>
    upsertUser(user.uid, {
      auth_method:  deriveAuthMethod(user),
      display_name: user.displayName || null,
      email:        user.email       || null,
      phone_number: user.phoneNumber || null,
      photo_url:    user.photoURL    || null,
    });

  // Re-runs the SAME upsert onAuthStateChanged does on mount, not a plain
  // read — a brand-new sign-in whose very first upsert_own_user call failed
  // has NO row yet, so a plain getUser() here would just re-read nothing
  // (get_own_user returns null for a missing row, not an error) and silently
  // clear profileError without ever actually creating the account. Forces a
  // fresh ID token first: this is the retry path for exactly the case where
  // the first attempt's token/RPC round-trip hit a transient blip.
  const retryProfile = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      await currentUser.getIdToken(true);
      const profile = await upsertProfileFor(currentUser);
      setUserProfile(profile);
      setProfileError(null);
      await loadSubscription(currentUser.uid);
    } catch (err) {
      console.error('Profile fetch error (retry):', err);
      setProfileError(err);
    } finally {
      setLoading(false);
    }
  };

  /* ── Auth state listener ───────────────────────────────── */

  useEffect(() => {
    // ── QA-only auth bypass ──────────────────────────────────────────
    // Google OAuth can't be driven headlessly, so there was no way to do a
    // real click-through test of authenticated screens. Gated on
    // import.meta.env.DEV, which Vite resolves to a static `false` in
    // production builds — this whole branch is dead-code-eliminated and
    // never ships. Visit /auth?qa_uid=some-id in `npm run dev` to sign in
    // as that fake uid (auto-creates a `users` row on first use).
    if (QA_BYPASS_UID) {
      const qaUid = QA_BYPASS_UID;
      const fakeUser = { uid: qaUid, email: `${qaUid}@qa.local`, displayName: 'QA Tester', photoURL: null };
      setCurrentUser(fakeUser);
      // StrictMode double-invokes effects in dev — without this guard, the
      // first invocation's async fetch can resolve AFTER a real user action
      // in between (e.g. completing onboarding), and its stale profile
      // snapshot silently overwrites the fresh one. Same missing-cancellation
      // shape as any un-guarded async effect; onAuthStateChanged below
      // doesn't need this because it's a real subscription with its own
      // unsub cleanup, not a plain fire-and-forget IIFE.
      let cancelled = false;
      (async () => {
        let profile = await getUser(qaUid).catch(() => null);
        if (!profile) {
          // 'google' — users.auth_method has a check constraint allowing only
          // 'google'/'phone'; this fake profile just needs to satisfy it.
          profile = await upsertUser(qaUid, { auth_method: 'google', display_name: 'QA Tester', email: fakeUser.email });
        }
        if (cancelled) return;
        setUserProfile(profile);
        await loadSubscription(qaUid);
        if (cancelled) return;
        setLoading(false);
      })();
      return () => { cancelled = true; };
    }

    // Consume the pending redirect result on mobile after Google sign-in —
    // still needs to be called to complete Firebase's redirect round-trip,
    // but no longer does its own profile upsert: onAuthStateChanged below
    // fires independently for this same sign-in and now owns that write
    // exclusively (see the comment there for why this used to race it).
    getRedirectResult(auth).catch((err) => {
      console.error(err);
      setProfileError(err);
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          // Single writer for the post-auth profile row. This used to be a
          // plain read (getUser) here, while signInWithGoogle/verifyOTP
          // separately fired their OWN upsertUser call for the exact same
          // sign-in event — two independent, unsequenced writers racing to
          // set `userProfile`, and whichever's response landed last in the
          // browser won. On a fresh sign-in, this SELECT could execute at
          // the DB just before the other call's INSERT committed, correctly
          // find no row yet (not an error — data is fine, no console noise),
          // and then still "win" the race by resolving after the real
          // upsert — permanently stuck at userProfile=null. Doing the
          // upsert HERE instead makes this the only writer, so there's
          // nothing left to race. Safe to call on every auth-state firing,
          // not just first sign-in — upsert_own_user coalesces against the
          // existing row for every field, so it never clobbers
          // onboarding_completed/target_exam/syllabus/class_level.
          const profile = await upsertProfileFor(user);
          setUserProfile(profile);
          setProfileError(null);
          await loadSubscription(user.uid);
        } catch (err) {
          // Reverse of the phone-login de-dupe check: this email is already
          // the verified email on a DIFFERENT existing account (e.g. a
          // phone-signup student who connected this exact email via
          // Notification Settings — Batch 9) — users_email_unique_idx
          // (sql/0056) rejects the write rather than silently attaching it
          // to two accounts. Surface a clear message and drop this brand-new,
          // otherwise-profile-less Firebase identity instead of leaving the
          // user stuck signed in with no Supabase row behind them. Not
          // retried below — this is a deterministic conflict, not a blip.
          if (err.code === '23505' || /duplicate key.*email/i.test(err.message || '')) {
            console.error('Profile fetch error: email already in use by another account', err);
            setProfileError(new Error('An account already exists with this email. Please sign in with your original method instead.'));
            await user.delete().catch(() => firebaseSignOut(auth));
          } else {
            // One transient-tolerant retry before surfacing AuthErrorScreen —
            // real incident (2026-08-21): a first-time signup's very first
            // upsert_own_user call is the one most exposed to a cold
            // network/token blip, and it has no existing row to fall back on
            // if it fails. Forces a fresh ID token (not just whatever was
            // cached from sign-in) before retrying once.
            console.error('Profile fetch error, retrying once:', err);
            try {
              await user.getIdToken(true);
              await new Promise((resolve) => setTimeout(resolve, 1000));
              const profile = await upsertProfileFor(user);
              setUserProfile(profile);
              setProfileError(null);
              await loadSubscription(user.uid);
            } catch (retryErr) {
              console.error('Profile fetch error (auto-retry failed):', retryErr);
              setProfileError(retryErr);
            }
          }
        }
      } else {
        setUserProfile(null);
        setSubscription(null);
        setProfileError(null);
      }
      setLoading(false);
    });

    return unsub;
  }, []);

  /* ── Google Sign-In ────────────────────────────────────── */

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    try {
      const result = await signInWithPopup(auth, provider);
      // Profile upsert happens exclusively in onAuthStateChanged, which
      // fires independently for this same sign-in — see the comment there.
      return result.user;
    } catch (err) {
      // auth/popup-closed-by-user is a very common FALSE POSITIVE on mobile —
      // many mobile browsers/WebViews report the popup as "closed" immediately
      // (OS tab-switch behavior, viewport constraints) even though the user
      // never dismissed anything and never got a chance to sign in. Treat it
      // the same as popup-blocked: fall back to redirect rather than stranding
      // the user with a dead "Continue with Google" button. Deliberately NOT
      // catching auth/cancelled-popup-request here — that fires when a second
      // popup request overlaps an in-flight one, not an actual failure.
      if (
        err.code === 'auth/popup-blocked' ||
        err.code === 'auth/popup-closed-by-user' ||
        err.code === 'auth/operation-not-supported-in-this-environment'
      ) {
        // Redirect is used only as a fallback, not the default, because mobile
        // browsers frequently partition/clear the storage Firebase needs to
        // read back getRedirectResult() after the round-trip, which silently
        // strands the user back on the login page with no error at all.
        await signInWithRedirect(auth, provider);
        return null; // getRedirectResult() in useEffect will handle the result
      }
      throw err;
    }
  };

  // Adds Google as a second sign-in credential to an already-signed-in
  // (typically phone-signup) account — the reverse direction of the phone-
  // linking flow below, same uid throughout. Popup-only (no redirect
  // fallback like signInWithGoogle): this is an in-app settings action
  // reachable only while already authenticated, not the initial sign-in
  // gate where a blocked popup would otherwise strand a new user entirely.
  const linkGoogleAccount = async () => {
    if (!currentUser) throw new Error('Not authenticated');
    const provider = new GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');

    // Errors from linkWithPopup (credential-already-in-use, popup-closed-by-
    // user, etc.) are left as real Firebase errors with their original
    // `.code` here — deliberately NOT re-wrapped in a custom message, so
    // the single shared mapAuthError (lib/authErrors.js) at the UI layer is
    // the one place that decides the copy, including which codes (like a
    // user just closing the popup) shouldn't show an error banner at all.
    const result = await linkWithPopup(currentUser, provider);

    try {
      const updated = await updateUser(currentUser.uid, {
        email:      result.user.email    || undefined,
        photo_url:  result.user.photoURL || undefined,
      });
      setUserProfile(updated);
      return result.user;
    } catch (err) {
      // Firebase-side linking succeeded, but this Google email is already
      // the verified email on a DIFFERENT Supabase account
      // (users_email_unique_idx, sql/0056) — a narrow split-brain case, only
      // reachable if that other account separately verified this exact
      // email via connect-email. Unlink the credential we just added rather
      // than leaving Firebase and Supabase disagreeing about who owns it —
      // this is the user's real, established account, so the credential
      // gets rolled back, never the account itself.
      await unlink(currentUser, 'google.com').catch(() => {});
      if (err.code === '23505' || /duplicate key.*email/i.test(err.message || '')) {
        throw new Error('This email is already associated with a different account.');
      }
      throw err;
    }
  };

  /* ── Phone OTP sign-in / linking ───────────────────────────
   * Firebase treats phone and Google sign-in as separate identities (different
   * uids) unless explicitly linked — sendOTP/verifyOTP below handle both cases:
   *   - Already signed in (e.g. adding a phone number from Profile) → links the
   *     phone credential to the SAME account via linkWithPhoneNumber, uid unchanged.
   *   - Not signed in (phone as the first sign-in method) → checks our own
   *     `users` table for an existing account under that phone number before
   *     creating a new one, since Firebase itself can't know they're the same
   *     person as an existing Google-based account.
   */
  const confirmationRef = useRef(null);
  const recaptchaRef    = useRef(null);

  const sendOTP = async (phoneNumber, recaptchaContainerId = 'recaptcha-container') => {
    if (!recaptchaRef.current) {
      recaptchaRef.current = new RecaptchaVerifier(auth, recaptchaContainerId, { size: 'invisible' });
    }
    confirmationRef.current = currentUser
      ? await linkWithPhoneNumber(currentUser, phoneNumber, recaptchaRef.current)
      : await signInWithPhoneNumber(auth, phoneNumber, recaptchaRef.current);
  };

  const verifyOTP = async (code) => {
    if (!confirmationRef.current) throw new Error('No OTP request in progress. Please request a new code.');
    const wasLinking = !!currentUser;

    // A wrong/expired code, or (when linking) this phone number already
    // being the real Firebase credential for a DIFFERENT uid, both surface
    // here as real Firebase errors with their original `.code` — left
    // untranslated for the same reason as linkGoogleAccount above: the
    // shared mapAuthError (lib/authErrors.js) is the single place that
    // turns auth/credential-already-in-use, auth/invalid-verification-code,
    // etc. into friendly copy.
    const result = await confirmationRef.current.confirm(code);
    confirmationRef.current = null;

    if (wasLinking) {
      // Adding a phone number to an already-signed-in account — same uid throughout.
      const updated = await updateUser(currentUser.uid, { phone_number: result.user.phoneNumber });
      setUserProfile(updated);
      return result.user;
    }

    // Fresh phone sign-in — de-dupe against an existing account with this phone
    // number before creating a new `users` row under this new Firebase uid.
    const existing = await getUserByPhone(result.user.phoneNumber);
    if (existing && existing.firebase_uid !== result.user.uid) {
      await result.user.delete().catch(() => firebaseSignOut(auth));
      throw new Error('An account already exists for this phone number. Please continue with Google instead.');
    }

    // Profile upsert happens in onAuthStateChanged, which fires independently
    // for this same fresh sign-in — same reasoning as signInWithGoogle above.
    return result.user;
  };

  /* ── Onboarding completion ─────────────────────────────── */

  const completeOnboarding = async ({ targetExam, syllabus, classLevel, subjects, academicTrack }) => {
    if (!currentUser) throw new Error('Not authenticated');
    const fields = {
      onboarding_completed: true,
      target_exam:          targetExam,
      syllabus,
      class_level:          classLevel,
      // Only present for students who completed Class 11/12 stream selection
      // (see 20260813050000) — every other signup writes neither key, and
      // upsert_own_user/update_own_user coalesce-preserve whatever was there
      // before when a key is absent, so this never overwrites existing
      // stream data with nothing.
      ...(subjects ? { subjects } : {}),
      ...(academicTrack ? { academic_track: academicTrack } : {}),
    };
    // update_own_user is UPDATE-only (matches every row genuinely reaching
    // onboarding in production, since loading already gates the UI until
    // the row exists). Falls back to upsert only for the narrow case where
    // that assumption doesn't hold — found via the QA-bypass dev harness
    // racing ahead of its own mount-time row creation, not a path real
    // users can reach, but a cheap, safe guard regardless.
    let updated = await updateUser(currentUser.uid, fields);
    if (!updated?.firebase_uid) {
      updated = await upsertUser(currentUser.uid, fields);
    }
    setUserProfile(updated);
  };

  /* ── Refresh subscription (call after admin grants premium) ── */
  const refreshSubscription = async () => {
    if (currentUser) await loadSubscription(currentUser.uid);
  };

  /* ── Sign Out ──────────────────────────────────────────── */

  const signOut = async () => {
    await firebaseSignOut(auth);
    setCurrentUser(null);
    setUserProfile(null);
    setSubscription(null);
  };

  const isPremium = subscription?.isActive === true;

  const value = {
    currentUser, userProfile, subscription, isPremium,
    loading, profileError, retryProfile,
    signInWithGoogle, linkGoogleAccount, sendOTP, verifyOTP, completeOnboarding, signOut, refreshSubscription,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
};
