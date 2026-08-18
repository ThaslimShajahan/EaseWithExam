import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Mail, MessageCircle, Phone } from 'lucide-react';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { useSeo } from '../lib/seo';
import { usePlatformSettings } from '../hooks/usePlatformSettings';

export default function ContactPage() {
  useSeo('/contact');
  const navigate = useNavigate();
  const { support_widget_enabled } = usePlatformSettings();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PublicNavBar />
      <div className="flex-1 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>

        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary-50 flex items-center justify-center shrink-0">
            <MessageCircle size={20} className="text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Contact us</h1>
            <p className="text-xs text-slate-400 mt-0.5">We usually reply within a day.</p>
          </div>
        </div>

        <div className="card space-y-4">
          <p className="text-sm text-slate-600 leading-relaxed">
            Questions about your account, a bug report, a billing issue, or feedback on EaseWithExam — email or
            call us and we'll get back to you.
          </p>
          {/* Redber chat, gated behind Admin > Platform > Settings — same
              on/off pattern as the cookie banner, default off. Links into
              the same /support page the Help Center entry does, not a
              second implementation — see docs/CHANGELOG.md 2026-08-19. */}
          {support_widget_enabled === 'true' && (
            <Link
              to="/support"
              className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50/50 transition-colors"
            >
              <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                <MessageCircle size={18} className="text-primary-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Chat with us</p>
                <p className="text-xs text-slate-400">Get an instant answer from EWE Support</p>
              </div>
            </Link>
          )}
          <a
            href="mailto:info@acenzos.com"
            className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50/50 transition-colors"
          >
            <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
              <Mail size={18} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">info@acenzos.com</p>
              <p className="text-xs text-slate-400">Account, billing, bugs, or general feedback</p>
            </div>
          </a>
          <a
            href="tel:+916238910451"
            className="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50/50 transition-colors"
          >
            <div className="h-10 w-10 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
              <Phone size={18} className="text-primary-600" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">+91 62389 10451</p>
              <p className="text-xs text-slate-400">Call or WhatsApp</p>
            </div>
          </a>
          <p className="text-xs text-slate-400">
            EaseWithExam is operated by Acenzos.
          </p>
        </div>
      </div>
      </div>
      <PublicFooter />
    </div>
  );
}
