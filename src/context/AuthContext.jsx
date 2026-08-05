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

  /* ── Supabase helpers ──────────────────────────────────── */

  const loadSubscription = async (uid) => {
    try {
      const sub = await getSubscription(uid);
      setSubscription(sub);
    } catch { setSubscription(null); }
  };

  const createOrFetchProfile = async (user) => {
    const profile = await upsertUser(user.uid, {
      auth_method:  'google',
      display_name: user.displayName || null,
      email:        user.email       || null,
      photo_url:    user.photoURL    || null,
    });
    setUserProfile(profile);
    await loadSubscription(user.uid);
    return profile;
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
      (async () => {
        let profile = await getUser(qaUid).catch(() => null);
        if (!profile) {
          // 'google' — users.auth_method has a check constraint allowing only
          // 'google'/'phone'; this fake profile just needs to satisfy it.
          profile = await upsertUser(qaUid, { auth_method: 'google', display_name: 'QA Tester', email: fakeUser.email });
        }
        setUserProfile(profile);
        await loadSubscription(qaUid);
        setLoading(false);
      })();
      return;
    }

    // Consume redirect result on mobile after Google sign-in
    getRedirectResult(auth)
      .then(async (result) => {
        if (result?.user) await createOrFetchProfile(result.user);
      })
      .catch(console.error);

    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        try {
          const profile = await getUser(user.uid);
          setUserProfile(profile);
          await loadSubscription(user.uid);
        } catch (err) {
          console.error('Profile fetch error:', err);
        }
      } else {
        setUserProfile(null);
        setSubscription(null);
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
      await createOrFetchProfile(result.user);
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

    await createOrFetchProfilePhone(result.user);
    return result.user;
  };

  const createOrFetchProfilePhone = async (user) => {
    const profile = await upsertUser(user.uid, {
      auth_method:  'phone',
      phone_number: user.phoneNumber || null,
    });
    setUserProfile(profile);
    await loadSubscription(user.uid);
    return profile;
  };

  /* ── Onboarding completion ─────────────────────────────── */

  const completeOnboarding = async ({ targetExam, syllabus, classLevel }) => {
    if (!currentUser) throw new Error('Not authenticated');
    const updated = await updateUser(currentUser.uid, {
      onboarding_completed: true,
      target_exam:          targetExam,
      syllabus,
      class_level:          classLevel,
    });
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
    loading, signInWithGoogle, sendOTP, verifyOTP, completeOnboarding, signOut, refreshSubscription,
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
