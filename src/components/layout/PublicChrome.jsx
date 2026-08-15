import { useState } from 'react';
import { Menu, X } from 'lucide-react';

/**
 * Shared nav + footer for the public marketing/info pages (landing, about,
 * contact, terms, privacy) so they read as one site.
 *
 * Light chrome on a light page, matching the reference design: logo left,
 * centred links, and a two-button cluster on the right (outline "Sign Up" +
 * solid "Get Started"). Flat brand green throughout — the previous version
 * used a gradient top rule and a gradient CTA, both dropped per the no-gradient
 * rule for this redesign.
 */

const NAV_LINKS = [
  { label: 'Home',     href: '/' },
  { label: 'Features', href: '/#features' },
  { label: 'Pricing',  href: '/#pricing' },
  { label: 'About',    href: '/about/' },
  { label: 'Contact',  href: '/contact/' },
];

export function PublicNavBar({ onSignIn }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-30 bg-white/90 backdrop-blur-xl border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[72px] flex items-center justify-between gap-4">
        <a href="/" className="flex items-center gap-2.5 shrink-0">
          {/* alt="" — the wordmark beside it already names the brand, so
              repeating it would make a screen reader read "EaseWithExam"
              twice for one link. */}
          <img src="/ewe_nav_icon.svg" alt="" className="h-9 w-auto" />
          <span className="text-[17px] font-bold text-slate-900 tracking-tight">EaseWithExam</span>
        </a>

        {/* Centre links — the reference puts these between the logo and the
            action cluster rather than hugging either edge. */}
        <div className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors"
            >
              {label}
            </a>
          ))}
        </div>

        <div className="hidden sm:flex items-center gap-2.5 shrink-0">
          {onSignIn && (
            <>
              <button
                onClick={onSignIn}
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold hover:border-slate-300 hover:bg-slate-50 transition-colors"
              >
                Sign Up
              </button>
              <button
                onClick={onSignIn}
                className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-semibold transition-colors"
              >
                Get Started
              </button>
            </>
          )}
        </div>

        <button
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="lg:hidden p-2 rounded-xl text-slate-700 hover:bg-slate-100 transition-colors"
        >
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-slate-100 px-4 py-3 space-y-1 bg-white">
          {NAV_LINKS.map(({ label, href }) => (
            <a
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="block px-3 py-2.5 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              {label}
            </a>
          ))}
          {onSignIn && (
            <div className="pt-2 space-y-2">
              <button onClick={onSignIn} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-sm font-semibold">
                Sign Up
              </button>
              <button onClick={onSignIn} className="w-full px-4 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold">
                Get Started
              </button>
            </div>
          )}
        </div>
      )}
    </nav>
  );
}

const FOOTER_COLUMNS = [
  {
    heading: 'Explore',
    links: [
      { label: 'Home',        href: '/' },
      { label: 'Features',    href: '/#features' },
      { label: 'Pricing',     href: '/#pricing' },
      { label: 'How it works', href: '/#how-it-works' },
      { label: 'FAQ',         href: '/#faq' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About Us',            href: '/about/' },
      { label: 'Contact',             href: '/contact/' },
      { label: 'Privacy & Cookies',   href: '/privacy/' },
      { label: 'Terms of Service',    href: '/terms/' },
      { label: 'Refund Policy',       href: '/refund/' },
      { label: 'info@acenzos.com',    href: 'mailto:info@acenzos.com' },
    ],
  },
];

export function PublicFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-slate-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-10 grid gap-10 md:grid-cols-[1.8fr_1fr_1fr]">
        <div>
          <img src="/ewe_nav_icon.svg" alt="EaseWithExam" className="h-9 w-auto" />
          <p className="text-sm text-slate-500 mt-4 leading-relaxed max-w-xs">
            AI-powered prep for NEET, JEE and board exams — real exam-pattern papers,
            a tutor that explains, and progress you can actually see.
          </p>
        </div>

        {FOOTER_COLUMNS.map(({ heading, links }) => (
          <div key={heading}>
            <h3 className="text-sm font-bold text-slate-900 mb-4">{heading}</h3>
            <ul className="space-y-2.5 text-sm">
              {links.map(({ label, href }) => (
                <li key={label}>
                  <a href={href} className="text-slate-500 hover:text-primary-700 transition-colors">{label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}

      </div>

      <div className="border-t border-slate-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-400">
          <div className="flex items-center gap-5">
            <a href="/terms/" className="hover:text-slate-700 transition-colors">Terms of service</a>
            <a href="/privacy/" className="hover:text-slate-700 transition-colors">Privacy policy</a>
          </div>
          <span>
            &copy; {year} EaseWithExam · A product by{' '}
            <a href="https://acenzos.com" target="_blank" rel="noopener noreferrer"
              className="font-semibold text-slate-500 hover:text-slate-800 transition-colors">
              Acenzos
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
