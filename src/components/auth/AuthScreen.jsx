import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Phone, Chrome } from 'lucide-react';
import GoogleSignIn from './GoogleSignIn';
import PhoneOTP from './PhoneOTP';
import { VedaAvatarLg } from '../ui/VedaAvatar';
import { ScienceBg, AtomDoodle, StarDoodle, FormulaText } from '../ui/Illustrations';
import EweLogo from '../ui/EweLogo';
import { usePlatformSettings } from '../../hooks/usePlatformSettings';

function BrandPanel() {
  const { platform_tagline } = usePlatformSettings();
  return (
    <div className="hidden lg:flex flex-col justify-between h-full p-10 text-white
                    bg-gradient-to-br from-primary-900 via-primary-800 to-violet-800 relative overflow-hidden">
      {/* Science doodle background */}
      <ScienceBg />

      {/* Logo */}
      <div className="relative z-10">
        <EweLogo variant="light" className="h-12 w-auto max-w-[200px]" />
      </div>

      {/* Veda intro card */}
      <div className="relative z-10 space-y-6">
        <div className="flex items-center gap-4 bg-white/10 backdrop-blur-sm rounded-2xl p-4 w-fit">
          <div className="shrink-0">
            <VedaAvatarLg />
          </div>
          <div>
            <p className="font-bold text-lg">Meet EWE</p>
            <p className="text-primary-200 text-sm leading-snug max-w-[180px]">
              Your personal AI exam companion
            </p>
          </div>
        </div>

        <h1 className="text-4xl font-extrabold leading-tight">
          Crack any exam<br />
          <span className="text-primary-300">smarter, faster.</span>
        </h1>
        <p className="text-primary-200 text-base leading-relaxed max-w-xs">
          {platform_tagline}
        </p>

        {/* Feature highlights */}
        <div className="flex flex-wrap gap-2 pt-1">
          {['SM-2 Spaced Repetition', 'Error Notebook', 'AI Doubt Clearing', 'Deep Analytics'].map(f => (
            <span key={f} className="px-2.5 py-1 rounded-full bg-white/15 text-xs font-medium backdrop-blur-sm flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 inline-block" /> {f}
            </span>
          ))}
        </div>
      </div>

      {/* Tags */}
      <div className="relative z-10 flex flex-wrap gap-2">
        {['NEET', 'JEE', 'CBSE', 'UPSC', 'Class 10', 'Class 12', 'Olympiad'].map((tag) => (
          <span key={tag} className="px-3 py-1 rounded-full bg-white/15 text-xs font-medium backdrop-blur-sm">
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

/* Mobile banner doodles */
function MobileDoodles() {
  return (
    <div className="lg:hidden absolute top-0 right-0 left-0 h-40 overflow-hidden pointer-events-none">
      <div className="absolute top-4 right-4">   <AtomDoodle size={50} opacity={0.08} color="#6366F1" /></div>
      <div className="absolute top-8 right-20">  <StarDoodle size={14} opacity={0.12} color="#6366F1" /></div>
      <div className="absolute top-16 right-8">  <FormulaText size={11} color="#6366F1" opacity={0.08}>F = ma</FormulaText></div>
    </div>
  );
}

export default function AuthScreen() {
  const [error, setError] = useState('');
  const [method, setMethod] = useState('google'); // 'google' | 'phone'

  return (
    <div className="min-h-screen bg-slate-50 lg:bg-white flex relative">
      <MobileDoodles />

      <div className="lg:w-1/2 xl:w-[55%] shrink-0">
        <BrandPanel />
      </div>

      <div className="w-full lg:w-1/2 xl:w-[45%] flex items-center justify-center p-6 lg:p-12">
        <motion.div
          className="w-full max-w-sm"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* Mobile header */}
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="h-10 w-10 rounded-xl bg-primary-600 flex items-center justify-center font-bold text-white text-lg">E</div>
            <div>
              <p className="text-base font-bold text-slate-900 leading-none">EaseWithExam</p>
              <p className="text-xs text-slate-400 mt-0.5">Powered by EWE</p>
            </div>
          </div>

          {/* Mobile Veda chip */}
          <div className="lg:hidden flex items-center gap-2 bg-primary-50 border border-primary-100 rounded-2xl px-3 py-2.5 mb-6">
            <div className="shrink-0 h-9 w-9 rounded-full overflow-hidden">
              <VedaAvatarLg />
            </div>
            <div>
              <p className="text-xs font-semibold text-primary-900">Study with EWE</p>
              <p className="text-[10px] text-primary-600">Your AI exam companion</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold text-slate-900 mb-1">Welcome back</h2>
          <p className="text-slate-500 text-sm mb-8">Sign in to continue your preparation journey.</p>

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

          {method === 'google' ? <GoogleSignIn onError={setError} /> : <PhoneOTP onError={setError} />}

          <button
            onClick={() => { setError(''); setMethod(m => m === 'google' ? 'phone' : 'google'); }}
            className="w-full flex items-center justify-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mt-4 transition-colors"
          >
            {method === 'google' ? <><Phone size={13} /> Sign in with phone number instead</> : <><Chrome size={13} /> Sign in with Google instead</>}
          </button>

          {method === 'google' && (
            <p className="text-xs text-center text-slate-400 mt-6">
              By signing in you agree to our Terms of Service &amp; Privacy Policy.
            </p>
          )}
        </motion.div>
      </div>
    </div>
  );
}
