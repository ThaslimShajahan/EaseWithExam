import { motion } from 'framer-motion';
import AuthCard from '../components/auth/AuthCard';

/**
 * Root screen for the native Android build (Capacitor.isNativePlatform()),
 * replacing LandingPage — see App.jsx's root route. A marketing page with a
 * nav bar, hero copy, and a cookie-consent banner reads as "a website loaded
 * in a box" rather than an app; a logged-out user opening the app has
 * already decided to use it, so they land straight on sign-in instead of
 * being sold on it again. AuthCard itself (logo, phone OTP, Google) is
 * unchanged — same form as the web sign-in modal, just full-screen instead
 * of over marketing content behind it.
 */
export default function NativeAuthScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-800 to-violet-800 flex items-center justify-center p-5">
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="w-full max-w-sm bg-white rounded-3xl shadow-2xl p-7"
      >
        <AuthCard />
      </motion.div>
    </div>
  );
}
