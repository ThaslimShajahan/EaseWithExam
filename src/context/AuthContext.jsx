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

export function AuthProvider({ children }) {
  const [currentUser,  setCurrentUser]  = useState(null);
  const [userProfile,  setUserProfile]  = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading,      setLoading]      = useState(true);

  const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

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

    if (isMobile()) {
      // popup is blocked by iOS Safari and many Android WebViews — use redirect
      await signInWithRedirect(auth, provider);
      return null; // getRedirectResult() in useEffect will handle the result
    }

    const result = await signInWithPopup(auth, provider);
    await createOrFetchProfile(result.user);
    return result.user;
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
