import { useState } from 'react';
import { Sparkles, ListChecks, Crown, Menu, X } from 'lucide-react';

/**
 * Shared nav + footer for public marketing/info pages (landing page, about,
 * contact, terms, privacy) so they all read as one site instead of the
 * landing page looking branded and everything else looking like a bare
 * utility screen.
 */
export function PublicNavBar({ onSignIn }) {
  const [open, setOpen] = useState(false);
  return (
    <nav className="sticky top-0 z-30">
      <div className="h-1 bg-gradient-to-r from-primary-400 via-violet-400 to-primary-400" />
      <div className="bg-slate-900 backdrop-blur-xl border-b border-white/10 shadow-lg shadow-black/20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-9 w-auto brightness-0 invert" />
            <span className="hidden md:block text-sm font-semibold text-slate-300 border-l border-white/15 pl-2.5">AI Exam Prep for NEET, JEE &amp; Boards</span>
          </a>

          <div className="hidden sm:flex items-center gap-1">
            <a href="/#features" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <Sparkles size={14} className="text-primary-400" /> Features
            </a>
            <a href="/#how-it-works" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <ListChecks size={14} className="text-violet-400" /> How it works
            </a>
            <a href="/#pricing" className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition-colors">
              <Crown size={14} className="text-amber-400" /> Pricing
            </a>
            {onSignIn && (
              <button onClick={onSignIn} className="ml-3 px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-violet-500 hover:from-primary-400 hover:to-violet-400 text-white text-sm font-bold shadow-md shadow-primary-900/40 transition-all">
                Sign In
              </button>
            )}
          </div>

          <button onClick={() => setOpen((v) => !v)} className="sm:hidden p-2 rounded-lg bg-white/10 text-white">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {open && (
          <div className="sm:hidden border-t border-white/10 px-4 py-3 space-y-1 bg-slate-900/95">
            <a href="/#features" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/10">
              <Sparkles size={14} className="text-primary-400" /> Features
            </a>
            <a href="/#how-it-works" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/10">
              <ListChecks size={14} className="text-violet-400" /> How it works
            </a>
            <a href="/#pricing" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-slate-300 hover:bg-white/10">
              <Crown size={14} className="text-amber-400" /> Pricing
            </a>
            {onSignIn && (
              <button onClick={onSignIn} className="w-full mt-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-primary-500 to-violet-500 text-white text-sm font-bold shadow-md shadow-primary-900/40">
                Sign In
              </button>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}

export function PublicFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-slate-900 text-slate-400">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-9 w-auto brightness-0 invert" />
          <p className="text-sm mt-4 leading-relaxed max-w-xs">
            AI-powered exam prep for NEET, JEE &amp; Boards — unlimited practice, real exam-pattern mock tests,
            and a personal AI tutor.
          </p>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300 mb-4">Product</h3>
          <ul className="space-y-2.5 text-sm">
            <li><a href="/#features" className="hover:text-white transition-colors">Features</a></li>
            <li><a href="/#how-it-works" className="hover:text-white transition-colors">How it works</a></li>
            <li><a href="/#pricing" className="hover:text-white transition-colors">Pricing</a></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300 mb-4">Company</h3>
          <ul className="space-y-2.5 text-sm">
            <li><a href="/about" className="hover:text-white transition-colors">About</a></li>
            <li><a href="/contact" className="hover:text-white transition-colors">Contact</a></li>
            <li><a href="mailto:info@acenzos.com" className="hover:text-white transition-colors">info@acenzos.com</a></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300 mb-4">Legal</h3>
          <ul className="space-y-2.5 text-sm">
            <li><a href="/privacy" className="hover:text-white transition-colors">Privacy &amp; Cookie Policy</a></li>
            <li><a href="/terms" className="hover:text-white transition-colors">Terms of Service</a></li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs">
          <span>&copy; {year} EaseWithExam. All rights reserved.</span>
          <span>
            A product by{' '}
            <a
              href="https://acenzos.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-slate-300 hover:text-white transition-colors"
            >
              Acenzos
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
