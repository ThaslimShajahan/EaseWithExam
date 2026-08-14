import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Compass, ArrowLeft, LayoutDashboard, BookOpen, Mail } from 'lucide-react';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { useAuth } from '../context/AuthContext';
import { useSeo } from '../lib/seo';

/**
 * Branded 404.
 *
 * REPLACES a catch-all `<Route path="*" element={<Navigate to="/dashboard" />}>`,
 * which was actively harmful rather than merely unhelpful: an unauthenticated
 * visitor (every crawler) hitting any bad URL was redirected to /dashboard,
 * bounced off RequireAuth back to /, and served the homepage under HTTP 200.
 * Google saw an unbounded set of URLs all returning homepage content — a soft
 * 404 that dilutes the one page currently worth indexing.
 *
 * THE STATUS CODE IS NOT SET HERE, AND CANNOT BE.
 * This is a static SPA: nginx has already returned 200 with index.html by the
 * time React runs. A genuine 404 needs the server to say so — see the vhost
 * block in docs/DEPLOY.md and public/404.html. This component covers the half
 * that lives in the bundle: correct UX, and `noindex` via useSeo('/404') so the
 * page cannot compete for search traffic while the server half is outstanding.
 */
export default function NotFoundPage() {
  useSeo('/404');
  const { currentUser } = useAuth();

  // Signed-in users get the app; everyone else gets the marketing site. Sending
  // a logged-out visitor to /dashboard is what created the redirect loop above.
  const primary = currentUser
    ? { to: '/dashboard', label: 'Go to dashboard', Icon: LayoutDashboard }
    : { to: '/', label: 'Go to homepage', Icon: Compass };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <PublicNavBar />

      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="text-center max-w-md"
        >
          <div className="mx-auto h-16 w-16 rounded-3xl bg-primary-50 flex items-center justify-center mb-7">
            <Compass size={30} className="text-primary-600" />
          </div>

          <p className="text-[13px] font-bold tracking-[0.18em] text-primary-600 uppercase">
            Error 404
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            We couldn&rsquo;t find that page
          </h1>
          <p className="mt-4 text-[15px] text-slate-500 leading-relaxed">
            The link may be broken, or the page may have moved. Nothing you did
            went wrong.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to={primary.to}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-primary-600 hover:bg-primary-700 text-white font-semibold transition-colors"
            >
              <primary.Icon size={16} /> {primary.label}
            </Link>
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl border border-slate-200 text-slate-800 font-semibold hover:bg-white transition-colors"
            >
              <ArrowLeft size={16} /> Go back
            </button>
          </div>

          {/* Internal links give a crawler that does reach this page somewhere
              to go, and give a lost visitor the two things they most likely
              wanted. */}
          <div className="mt-10 pt-8 border-t border-slate-200/80">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">
              Try instead
            </p>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm">
              <Link to="/about/" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-primary-700 font-medium transition-colors">
                <BookOpen size={14} /> About EaseWithExam
              </Link>
              <Link to="/contact/" className="inline-flex items-center gap-1.5 text-slate-600 hover:text-primary-700 font-medium transition-colors">
                <Mail size={14} /> Contact support
              </Link>
            </div>
          </div>
        </motion.div>
      </div>

      <PublicFooter />
    </div>
  );
}
