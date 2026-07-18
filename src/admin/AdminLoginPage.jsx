import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Loader2, AlertTriangle } from 'lucide-react';
import { signInWithPopup, GoogleAuthProvider, signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import { supabase } from '../lib/supabase';

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

export default function AdminLoginPage() {
  const navigate          = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleGoogle = async () => {
    setLoading(true); setError('');
    try {
      const result = await signInWithPopup(auth, new GoogleAuthProvider());
      const uid    = result.user.uid;

      const { data } = await supabase.rpc('get_admin_record', { p_uid: uid });
      if (!data) {
        await signOut(auth);
        setError('This Google account is not registered as an admin. Ask your super admin to add you.');
        return;
      }

      // Admin confirmed — AdminGuard handles passcode from here
      navigate('/admin', { replace: true });
    } catch (e) {
      if (e.code === 'auth/popup-closed-by-user') { /* silent */ }
      else setError(e.message || 'Sign-in failed. Try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 select-none">
      {/* Brand mark */}
      <motion.div
        className="h-[72px] w-[72px] rounded-[26px] bg-gradient-to-br from-primary-500 to-violet-600 flex items-center justify-center shadow-2xl shadow-primary-900/40 mb-8"
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1,   opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
      >
        <Shield size={34} className="text-white" />
      </motion.div>

      <motion.div
        className="text-center mb-10"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0  }}
        transition={{ delay: 0.1 }}
      >
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Admin Portal</h1>
        <p className="text-slate-500 text-sm mt-2">Authorised personnel only</p>
      </motion.div>

      <motion.div
        className="w-full max-w-[340px] space-y-4"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0  }}
        transition={{ delay: 0.18 }}
      >
        <AnimatePresence>
          {error && (
            <motion.div
              key="err"
              initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="flex items-start gap-2 bg-red-900/20 border border-red-700/30 rounded-2xl p-3.5 text-xs text-red-400"
            >
              <AlertTriangle size={13} className="shrink-0 mt-0.5" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={handleGoogle}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-4 px-5 bg-white hover:bg-slate-50 active:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed rounded-2xl font-semibold text-slate-900 text-sm transition-colors shadow-lg"
        >
          {loading ? <Loader2 size={18} className="animate-spin text-slate-500" /> : <GoogleIcon />}
          {loading ? 'Signing in…' : 'Continue with Google'}
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-3 bg-slate-950 text-xs text-slate-600">secure admin access</span>
          </div>
        </div>

        <div className="bg-slate-900 border border-white/5 rounded-2xl p-4 space-y-1.5">
          {[
            'Your account must be added by a super admin',
            'A 6-digit passcode is required after sign-in',
            'Sessions expire when the browser tab closes',
          ].map((t) => (
            <p key={t} className="text-[11px] text-slate-500 flex items-start gap-2">
              <span className="mt-0.5 h-1 w-1 rounded-full bg-slate-600 shrink-0" />
              {t}
            </p>
          ))}
        </div>
      </motion.div>

      <p className="mt-12 text-[11px] text-slate-800">
        Student? Go to <a href="/auth" className="text-slate-600 underline underline-offset-2 hover:text-slate-400 transition-colors">/auth</a>
      </p>
    </div>
  );
}
