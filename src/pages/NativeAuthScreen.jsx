import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { mapAuthError } from '../lib/authErrors';
import { ScienceBg } from '../components/ui/Illustrations';

/**
 * Root screen for the native Android build (Capacitor.isNativePlatform()),
 * replacing LandingPage — see App.jsx's root route. A marketing page with a
 * nav bar, hero copy, and a cookie-consent banner reads as "a website loaded
 * in a box" rather than an app; a logged-out user opening the app has
 * already decided to use it, so they land straight on sign-in instead of
 * being sold on it again.
 *
 * DELIBERATELY NOT sharing PhoneOTP.jsx/AuthCard.jsx/GoogleSignIn.jsx with
 * the web sign-in modal — this is its own premium, native-feeling
 * presentation (dark hero + bottom sheet, boxed auto-submitting OTP input,
 * slide transitions) built specifically for this screen, per owner request
 * (2026-09-16: the shared-component version "looked cheap/generic"). It
 * calls the exact same useAuth() methods (sendOTP/verifyOTP/signInWithGoogle)
 * the web components do — only the presentation differs, never touches
 * LandingPage or the shared auth components.
 */

const PHONE_PREFIX = '+91';

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

/* ── Phone entry step ──────────────────────────────────────────────── */

function PhoneStep({ phone, setPhone, onSubmit, loading, googleLoading, onGoogle }) {
  const cleaned = phone.replace(/\D/g, '');
  const valid = cleaned.length === 10;
  // Soft feedback only — no red state at all here. A wrong/short number only
  // ever surfaces as the shared error banner below the headline, triggered
  // by actually tapping Send OTP, never mid-keystroke.
  const helper = cleaned.length === 0 ? 'Enter your 10-digit mobile number' : valid ? 'Looks good' : `${10 - cleaned.length} more digit${10 - cleaned.length === 1 ? '' : 's'}`;

  return (
    <motion.div
      key="phone"
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <h1 className="text-2xl font-bold text-slate-900 text-center">Welcome back</h1>
      <p className="text-slate-500 text-sm text-center mt-1.5 mb-8">Sign in to continue your preparation journey</p>

      <label className="block text-xs font-semibold text-slate-500 mb-2 ml-1">Mobile number</label>
      <div className="flex items-center gap-2 bg-slate-50 border-2 border-slate-200 rounded-2xl px-2 h-16 focus-within:border-primary-500 focus-within:bg-white transition-colors">
        <span className="flex items-center gap-1 px-3 h-11 rounded-xl bg-white border border-slate-200 text-slate-700 font-semibold text-base shrink-0">
          🇮🇳 {PHONE_PREFIX}
        </span>
        <input
          type="tel"
          inputMode="numeric"
          autoFocus
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
          onKeyDown={(e) => e.key === 'Enter' && valid && onSubmit()}
          className="flex-1 min-w-0 h-full bg-transparent outline-none text-xl font-semibold text-slate-900 placeholder:text-slate-300 placeholder:font-normal tracking-wide"
        />
      </div>
      <div className="flex items-center gap-1.5 mt-2 ml-1 h-4">
        {valid && <Check size={13} className="text-emerald-500" />}
        <p className={`text-xs ${valid ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>{helper}</p>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading}
        className="w-full h-14 mt-6 rounded-2xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white font-bold text-base flex items-center justify-center gap-2 shadow-lg shadow-primary-600/25 transition-all active:scale-[0.98]"
      >
        {loading ? <Loader2 size={18} className="animate-spin" /> : <>Send OTP <ArrowRight size={17} /></>}
      </button>

      <p className="text-xs text-center text-slate-400 mt-4">
        By continuing, you agree to our <span className="text-primary-600 font-medium">Terms &amp; Privacy Policy</span>
      </p>

      <div className="flex items-center gap-3 my-6">
        <div className="flex-1 h-px bg-slate-200" />
        <span className="text-xs text-slate-400 font-medium">or continue with</span>
        <div className="flex-1 h-px bg-slate-200" />
      </div>

      {/* Material sign-in button: white surface, neutral border, full-color
          G at fixed left inset, medium-weight #3c4043 label — Google's own
          branding guidelines, not a generic outlined box. */}
      <button
        onClick={onGoogle}
        disabled={googleLoading}
        className="w-full h-14 rounded-2xl bg-white border border-slate-300 disabled:opacity-60 flex items-center justify-center gap-3 shadow-sm active:scale-[0.98] transition-all"
      >
        {googleLoading ? <Loader2 size={18} className="animate-spin text-slate-500" /> : <GoogleG />}
        <span className="text-[15px] font-medium text-[#3c4043]">Continue with Google</span>
      </button>
    </motion.div>
  );
}

/* ── OTP entry step ────────────────────────────────────────────────── */

function OtpStep({ phone, onVerify, onBack, error }) {
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [verifying, setVerifying] = useState(false);
  const [countdown, setCountdown] = useState(30);
  const refs = useRef([]);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const reset = () => {
    setOtp(['', '', '', '', '', '']);
    submittedRef.current = false;
    refs.current[0]?.focus();
  };

  // Exposed so the parent can clear+refocus after a failed verify (error
  // comes back from the parent, this only resets local box state).
  useEffect(() => { if (error) reset(); }, [error]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (value, idx) => {
    if (!/^\d*$/.test(value)) return;
    const next = [...otp];
    next[idx] = value.slice(-1);
    setOtp(next);
    if (value && idx < 5) refs.current[idx + 1]?.focus();

    // Auto-submit the instant all 6 boxes are filled — the standard premium
    // OTP pattern (WhatsApp/Uber-style), no separate Verify button to tap.
    if (next.every((d) => d !== '') && !submittedRef.current) {
      submittedRef.current = true;
      setVerifying(true);
      onVerify(next.join('')).finally(() => setVerifying(false));
    }
  };

  const handleKey = (e, idx) => {
    if (e.key === 'Backspace' && !otp[idx] && idx > 0) refs.current[idx - 1]?.focus();
  };

  const handleResend = () => {
    reset();
    setCountdown(30);
    onBack(true); // true = resend immediately rather than going back to phone entry
  };

  return (
    <motion.div
      key="otp"
      initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
    >
      <h1 className="text-2xl font-bold text-slate-900 text-center">Enter the code</h1>
      <p className="text-slate-500 text-sm text-center mt-1.5 mb-8">
        Sent to <span className="font-semibold text-slate-700">{PHONE_PREFIX} {phone}</span>
      </p>

      <div className="flex justify-center gap-2.5">
        {otp.map((digit, i) => (
          <motion.input
            key={i}
            ref={(el) => (refs.current[i] = el)}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            disabled={verifying}
            onChange={(e) => handleChange(e.target.value, i)}
            onKeyDown={(e) => handleKey(e, i)}
            animate={digit ? { scale: [1.08, 1] } : {}}
            transition={{ duration: 0.15 }}
            className="w-12 h-14 text-center text-2xl font-bold rounded-2xl border-2 border-slate-200
                       bg-slate-50 text-slate-900 outline-none disabled:opacity-50
                       focus:border-primary-500 focus:bg-white focus:ring-4 focus:ring-primary-100
                       transition-colors"
          />
        ))}
      </div>

      <div className="h-8 flex items-center justify-center mt-4">
        {verifying && (
          <p className="flex items-center gap-2 text-sm text-primary-600 font-medium">
            <Loader2 size={14} className="animate-spin" /> Verifying…
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 mt-2">
        {countdown > 0 ? (
          <p className="text-sm text-slate-400">Resend code in {countdown}s</p>
        ) : (
          <button onClick={handleResend} className="text-sm text-primary-600 font-semibold hover:underline">
            Resend code
          </button>
        )}
        <span className="text-slate-300">•</span>
        <button
          onClick={() => onBack(false)}
          className="text-sm text-slate-500 font-medium flex items-center gap-1 hover:text-slate-700"
        >
          <RefreshCw size={12} /> Change number
        </button>
      </div>
    </motion.div>
  );
}

/* ── Screen shell ──────────────────────────────────────────────────── */

export default function NativeAuthScreen() {
  const { sendOTP, verifyOTP, signInWithGoogle } = useAuth();
  const [step, setStep] = useState('phone'); // 'phone' | 'otp'
  const [phone, setPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  const doSendOtp = async () => {
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length !== 10) { setError('Enter a valid 10-digit mobile number.'); return; }
    setError('');
    setSending(true);
    try {
      await sendOTP(`${PHONE_PREFIX}${cleaned}`);
      setStep('otp');
    } catch (err) {
      const msg = mapAuthError(err);
      if (msg) setError(msg);
    } finally {
      setSending(false);
    }
  };

  const doVerify = async (code) => {
    setError('');
    try {
      await verifyOTP(code);
    } catch (err) {
      const msg = mapAuthError(err);
      if (msg) setError(msg);
      else setError(' '); // still triggers OtpStep's box-reset effect even on a "silent" error
    }
  };

  const doGoogle = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = mapAuthError(err);
      if (msg) setError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleOtpBack = (resend) => {
    setError('');
    if (resend) { doSendOtp(); return; }
    setStep('phone');
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col">
      {/* Dark hero — logo + decorative study-themed illustration layer,
          soft blurred glow blobs for depth instead of a flat gradient. */}
      <div className="relative overflow-hidden flex-1 min-h-[160px] pt-14 pb-10 px-6 flex flex-col items-center">
        <div className="absolute -top-20 -left-16 w-64 h-64 rounded-full bg-primary-500/25 blur-3xl" />
        <div className="absolute -bottom-24 -right-10 w-64 h-64 rounded-full bg-violet-500/20 blur-3xl" />
        <ScienceBg />
        <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-11 w-auto relative z-10 mb-2" />
        <p className="text-primary-200/70 text-xs font-medium relative z-10">AI-powered NEET, JEE &amp; CBSE prep</p>
      </div>

      {/* Bottom sheet */}
      <div className="shrink-0 bg-white rounded-t-[32px] shadow-2xl px-6 pt-8 pb-10 -mt-4">
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mb-5 text-sm text-red-700 overflow-hidden"
            >
              {error.trim() || 'Something went wrong. Please try again.'}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {step === 'phone' ? (
            <PhoneStep
              phone={phone} setPhone={setPhone}
              onSubmit={doSendOtp} loading={sending}
              googleLoading={googleLoading} onGoogle={doGoogle}
            />
          ) : (
            <OtpStep phone={phone} onVerify={doVerify} onBack={handleOtpBack} error={error} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
