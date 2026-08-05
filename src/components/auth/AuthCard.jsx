import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import GoogleSignIn from './GoogleSignIn';
import PhoneOTP from './PhoneOTP';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

/**
 * The actual sign-in form content — logo, phone OTP (primary), Google
 * (secondary, below a divider). Shared by the full-page /auth route
 * (AuthScreen) and the landing page's sign-in modal (AuthModal), so the two
 * entry points never drift into two different-looking forms.
 */
export default function AuthCard() {
  const [error, setError] = useState('');
  // Phone entry ('otpStep') hides the Google row below it — a mid-OTP student
  // shouldn't see an unrelated "Or Login with" divider above their code input.
  const [otpStep, setOtpStep] = useState(false);
  const { platform_tagline } = usePlatformSettings();

  return (
    <div>
      <div className="flex flex-col items-center mb-7">
        <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-12 w-auto mb-2" />
        {platform_tagline && (
          <p className="text-xs text-slate-400 text-center">{platform_tagline}</p>
        )}
      </div>

      <h2 className="text-2xl font-bold text-slate-900 mb-1 text-center">Log in to your account</h2>
      <p className="text-slate-500 text-sm mb-8 text-center">Sign in to continue your preparation journey.</p>

      <AnimatePresence>
        {error && (
          <motion.div
            className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 mb-5 text-sm text-red-700"
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
          >
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <PhoneOTP onError={setError} onStepChange={setOtpStep} />

      {!otpStep && (
        <>
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-400 font-medium">Or Login with</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
          <GoogleSignIn onError={setError} />
        </>
      )}
    </div>
  );
}
