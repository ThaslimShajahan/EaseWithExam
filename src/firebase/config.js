import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase is used for Authentication only.
// Database is handled by Supabase (src/lib/supabase.js).
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// QA-EDIT-START (2026-09-06, student E2E test pass) ---------------------
// Firebase's own officially-documented mechanism for testing phone-OTP
// sign-in without solving reCAPTCHA: paired with a "test phone number"
// registered in the Firebase Console (Authentication → Sign-in method →
// Phone), it accepts that number's fixed OTP with zero reCAPTCHA
// involvement. Needed because reCAPTCHA correctly flags ANY
// automation-controlled Chromium (Playwright/Puppeteer) regardless of
// headless mode, so the real phone-login screen could not otherwise be
// driven end-to-end at all. Gated on import.meta.env.DEV, which Vite
// resolves to a static `false` in production builds — same dead-code-
// elimination guarantee as the QA_BYPASS_UID flag in AuthContext.jsx,
// so this line never ships and never weakens production reCAPTCHA.
if (import.meta.env.DEV) {
  auth.settings.appVerificationDisabledForTesting = true;
}
// QA-EDIT-END -------------------------------------------------------------

// Admin Portal uses a SEPARATE named Firebase app instance (same project/config,
// different Auth session) so signing in as an admin never touches the student
// session on `auth` above. Without this, admin + student shared one Auth
// instance/currentUser — logging into /admin/login also signed the same
// browser in as that Firebase user everywhere else (student routes included),
// even redirecting into onboarding for admin-only accounts with no student
// profile. Firebase scopes Auth persistence per named app, so this is enough
// to fully isolate the two sessions with no backend changes.
export const adminApp  = initializeApp(firebaseConfig, 'admin');
export const adminAuth = getAuth(adminApp);
