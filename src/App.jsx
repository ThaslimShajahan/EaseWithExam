import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import { trackPageView } from './lib/analytics';
import { COACHING_MODULE_ENABLED } from './lib/moduleStatus';
import AppShell from './components/layout/AppShell';
import SkeletonLoader from './components/ui/SkeletonLoader';
import PlatformChrome from './components/ui/PlatformChrome';
import MaintenanceGate from './components/ui/MaintenanceGate';

/* ── Eagerly loaded (tiny, needed on first paint) ─────────── */
import LandingPage    from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardPage  from './pages/DashboardPage';
// Eager: the 404 is the catch-all, so a lazy chunk would mean a crawler (and a
// lost visitor) waits on a second round-trip to find out the page is missing.
import NotFoundPage   from './pages/NotFoundPage';

const JoinCentrePage       = lazy(() => import('./pages/JoinCentrePage'));
const CoachingStaffJoinPage= lazy(() => import('./pages/CoachingStaffJoinPage'));

/* ── Hub pages ─────────────────────────────────────────────── */
const StudyHubPage         = lazy(() => import('./pages/StudyHubPage'));
const ExamsHubPage         = lazy(() => import('./pages/ExamsHubPage'));
const ProgressHubPage      = lazy(() => import('./pages/ProgressHubPage'));

/* ── Lazy loaded (heavy; only fetched when navigated to) ──── */
const MockTestPage         = lazy(() => import('./pages/MockTestPage'));
const DoubtStudioPage      = lazy(() => import('./pages/DoubtStudioPage'));
const PracticeGeneratorPage= lazy(() => import('./pages/PracticeGeneratorPage'));
const PaperModePage        = lazy(() => import('./pages/PaperModePage'));
const ProfilePage          = lazy(() => import('./pages/ProfilePage'));
const NotificationsPage    = lazy(() => import('./pages/NotificationsPage'));
const PricingPage          = lazy(() => import('./pages/PricingPage'));
const PaymentSuccessPage   = lazy(() => import('./pages/PaymentSuccessPage'));
const ParentDashboardPage  = lazy(() => import('./pages/ParentDashboardPage'));
const HelpPage             = lazy(() => import('./pages/HelpPage'));
const PrivacyPolicyPage    = lazy(() => import('./pages/PrivacyPolicyPage'));
const TermsOfServicePage   = lazy(() => import('./pages/TermsOfServicePage'));
const RefundPolicyPage     = lazy(() => import('./pages/RefundPolicyPage'));
const AboutPage            = lazy(() => import('./pages/AboutPage'));
const ContactPage          = lazy(() => import('./pages/ContactPage'));

/* ── Admin (fully isolated) ────────────────────────────────── */
// ~27 individual admin screens are grouped into 8 hubs (see Admin*Hub.jsx) — each hub
// lazy-imports its own tab pages internally, so only the hubs themselves are listed here.
const AdminLayout       = lazy(() => import('./admin/AdminLayout'));
const AdminGuard        = lazy(() => import('./admin/AdminGuard'));
const AdminOverview     = lazy(() => import('./admin/AdminOverview'));
const AdminContentHub   = lazy(() => import('./admin/AdminContentHub'));
const AdminPublishHub   = lazy(() => import('./admin/AdminPublishHub'));
const AdminStudentsHub  = lazy(() => import('./admin/AdminStudentsHub'));
const AdminPlatformHub  = lazy(() => import('./admin/AdminPlatformHub'));
const AdminOpsHub       = lazy(() => import('./admin/AdminOpsHub'));
const AdminPeopleHub    = lazy(() => import('./admin/AdminPeopleHub'));
const AdminLoginPage    = lazy(() => import('./admin/AdminLoginPage'));

/* ── Coaching Portal (fully isolated) ─────────────────────── */
const CoachingPortalGuard      = lazy(() => import('./coaching/CoachingPortalGuard'));
const CoachingPortalLayout     = lazy(() => import('./coaching/CoachingPortalLayout'));
const CoachingDashboard        = lazy(() => import('./coaching/CoachingDashboard'));
const CoachingStudentsPage     = lazy(() => import('./coaching/CoachingStudentsPage'));
const CoachingNotesPage        = lazy(() => import('./coaching/CoachingNotesPage'));
const CoachingAssignmentsPage  = lazy(() => import('./coaching/CoachingAssignmentsPage'));
const CoachingSettingsPage     = lazy(() => import('./coaching/CoachingSettingsPage'));
const CoachingTestBuilder      = lazy(() => import('./coaching/CoachingTestBuilder'));

/* ── Page skeleton shown during lazy chunk loading ──────────── */
function PageFallback() {
  return <SkeletonLoader type="page" />;
}

// Shown when a Firebase-authenticated user's Supabase profile fails to load
// (RLS/RPC error, network drop, etc.) — the guards below used to have no
// escape from this state at all (RequireNoAuth just returned a skeleton
// forever, since `userProfile` can structurally never arrive once the fetch
// has failed), which is exactly what produced a permanently-stuck loading
// screen. `retryProfile` re-runs the same fetch that failed on mount.
function AuthErrorScreen() {
  const { retryProfile, signOut } = useAuth();
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center gap-4">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-xl font-bold text-slate-900">Couldn't load your account</h2>
      <p className="text-slate-600 max-w-sm text-sm">
        Something went wrong loading your profile. This is usually temporary — try again, or sign out and back in.
      </p>
      <div className="flex gap-3">
        <button onClick={() => retryProfile()}
          className="px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-semibold hover:bg-primary-700 transition-colors">
          Try Again
        </button>
        <button onClick={() => signOut()}
          className="px-5 py-2.5 border border-slate-300 text-slate-600 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors">
          Sign Out
        </button>
      </div>
    </div>
  );
}

/* ── Route guards ───────────────────────────────────────────── */
function RequireAuth({ children }) {
  const { currentUser, userProfile, loading, profileError } = useAuth();
  if (loading)    return <SkeletonLoader type="page" />;
  if (!currentUser) return <Navigate to="/" replace />;
  if (profileError && !userProfile) return <AuthErrorScreen />;
  if (!userProfile?.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return <AppShell>{children}</AppShell>;
}

function RequireNoAuth({ children }) {
  const { currentUser, userProfile, loading, profileError } = useAuth();
  if (loading) return <SkeletonLoader type="page" />;
  if (!currentUser) return children;
  if (profileError && !userProfile) return <AuthErrorScreen />;
  if (!userProfile) return <SkeletonLoader type="page" />;
  if (userProfile.onboarding_completed) return <Navigate to="/dashboard" replace />;
  return <Navigate to="/onboarding" replace />;
}

function RequireAuthNoShell({ children }) {
  const { currentUser, loading } = useAuth();
  if (loading)      return <SkeletonLoader type="page" />;
  if (!currentUser) return <Navigate to="/" replace />;
  return children;
}

function RequireAuthFullScreen({ children }) {
  const { currentUser, userProfile, loading, profileError } = useAuth();
  if (loading)      return <SkeletonLoader type="test" />;
  if (!currentUser) return <Navigate to="/" replace />;
  if (profileError && !userProfile) return <AuthErrorScreen />;
  if (!userProfile?.onboarding_completed) return <Navigate to="/onboarding" replace />;
  return children;
}

/**
 * One GA4 pageview per client-side route change, for EVERY route.
 *
 * Sits on the router rather than in useSeo() because that hook bails out for any
 * path without a PAGE_SEO entry, which is all 40-odd authenticated screens. The
 * gtag config in index.html sets send_page_view:false, so this is the only
 * sender — the first load included, fired by this effect on mount.
 *
 * `search` is in the dependency list on purpose: several screens are addressed
 * only by query string (/progress?tab=analytics, /exam-center?mode=…), and
 * without it those read as one page. The hash is left out — it is used for
 * in-page anchors, not navigation.
 */
function usePageViews() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    trackPageView(`${pathname}${search}`);
  }, [pathname, search]);
}

export default function App() {
  usePageViews();
  return (
    <>
      <PlatformChrome />
      <Suspense fallback={<PageFallback />}>
      <MaintenanceGate>
      <Routes>
        <Route path="/auth"       element={<Navigate to="/" replace />} />
        <Route path="/onboarding" element={<RequireAuthNoShell><OnboardingPage /></RequireAuthNoShell>} />

        <Route path="/dashboard"           element={<RequireAuth><DashboardPage /></RequireAuth>} />

        {/* Hub pages */}
        <Route path="/study"               element={<RequireAuth><StudyHubPage /></RequireAuth>} />
        <Route path="/exams"               element={<RequireAuth><ExamsHubPage /></RequireAuth>} />
        <Route path="/progress"            element={<RequireAuth><ProgressHubPage /></RequireAuth>} />
        <Route path="/notifications"       element={<RequireAuth><NotificationsPage /></RequireAuth>} />

        {/* Direct pages still needed outside hubs */}
        <Route path="/doubt"               element={<RequireAuth><DoubtStudioPage /></RequireAuth>} />
        <Route path="/practice/generate"   element={<RequireAuth><PracticeGeneratorPage /></RequireAuth>} />
        <Route path="/paper-mode"          element={<RequireAuth><PaperModePage /></RequireAuth>} />
        <Route path="/pricing"             element={<RequireAuth><PricingPage /></RequireAuth>} />
        <Route path="/payment-success"     element={<RequireAuth><PaymentSuccessPage /></RequireAuth>} />
        <Route path="/parent"              element={<RequireAuth><ParentDashboardPage /></RequireAuth>} />
        <Route path="/parent/:studentUid"  element={<RequireAuth><ParentDashboardPage /></RequireAuth>} />
        <Route path="/profile"             element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/help"                element={<RequireAuth><HelpPage /></RequireAuth>} />

        {/* Redirects: old routes → hub+tab */}
        <Route path="/practice"            element={<Navigate to="/exams?tab=practice"   replace />} />
        <Route path="/flashcards"          element={<Navigate to="/study?tab=flashcards"  replace />} />
        <Route path="/flashcards/:key"     element={<Navigate to="/study?tab=flashcards"  replace />} />
        <Route path="/learn"               element={<Navigate to="/study?tab=videos"      replace />} />
        <Route path="/goals"               element={<Navigate to="/study?tab=plan"        replace />} />
        <Route path="/exam-center"         element={<Navigate to="/exams?tab=papers"      replace />} />
        <Route path="/notifications"       element={<Navigate to="/exams?tab=alerts"      replace />} />
        <Route path="/exam-alerts"         element={<Navigate to="/exams?tab=alerts"      replace />} />
        <Route path="/analytics"           element={<Navigate to="/progress?tab=analytics"   replace />} />
        <Route path="/notebook"            element={<Navigate to="/study?tab=notebook"       replace />} />
        <Route path="/syllabus"            element={<Navigate to="/progress?tab=syllabus"    replace />} />
        <Route path="/leaderboard"         element={<Navigate to="/progress?tab=leaderboard" replace />} />

        {/* Full-screen test engine */}
        <Route path="/test" element={<RequireAuthFullScreen><MockTestPage /></RequireAuthFullScreen>} />

        {/* Admin login — public, no auth required */}
        <Route path="/admin/login" element={
          <Suspense fallback={<PageFallback />}>
            <AdminLoginPage />
          </Suspense>
        } />

        {/* Admin — ~27 old flat screens are now grouped into 8 hubs with tabs inside.
            Old direct links (bookmarks, hardcoded navigate() calls) redirect below. */}
        <Route path="/admin" element={
          <Suspense fallback={<PageFallback />}>
            <AdminGuard><AdminLayout /></AdminGuard>
          </Suspense>
        }>
          <Route index               element={<AdminOverview />}    />
          <Route path="content"      element={<AdminContentHub />}  />
          <Route path="publish"      element={<AdminPublishHub />}  />
          <Route path="students"     element={<AdminStudentsHub />} />
          <Route path="platform"     element={<AdminPlatformHub />} />
          <Route path="ops"          element={<AdminOpsHub />}      />
          <Route path="people"       element={<AdminPeopleHub />}   />

          {/* Redirects: old flat routes → hub + tab */}
          <Route path="pdfupload"     element={<Navigate to="/admin/content?tab=intake"      replace />} />
          <Route path="library"       element={<Navigate to="/admin/content?tab=library"      replace />} />
          <Route path="review"        element={<Navigate to="/admin/content?tab=review"       replace />} />
          <Route path="papers"        element={<Navigate to="/admin/publish?tab=papers"       replace />} />
          <Route path="papergen"      element={<Navigate to="/admin/publish?tab=papergen"     replace />} />
          <Route path="tests"         element={<Navigate to="/admin/publish?tab=tests"        replace />} />
          <Route path="syllabus"      element={<Navigate to="/admin/content?tab=syllabus"      replace />} />
          <Route path="notes"         element={<Navigate to="/admin/content?tab=notes"         replace />} />
          <Route path="subscriptions" element={<Navigate to="/admin/students?tab=subscriptions" replace />} />
          <Route path="coaching"      element={<Navigate to="/admin/students?tab=coaching"     replace />} />
          <Route path="push"          element={<Navigate to="/admin/students?tab=push"         replace />} />
          <Route path="flags"         element={<Navigate to="/admin/platform?tab=flags"        replace />} />
          <Route path="settings"      element={<Navigate to="/admin/platform?tab=settings"     replace />} />
          <Route path="pricing"       element={<Navigate to="/admin/platform?tab=pricing"      replace />} />
          <Route path="quota"         element={<Navigate to="/admin/platform?tab=quota"        replace />} />
          <Route path="testdata"      element={<Navigate to="/admin/ops?tab=testdata"          replace />} />
          <Route path="data"          element={<Navigate to="/admin/ops?tab=data"              replace />} />
          <Route path="examwatch"     element={<Navigate to="/admin/ops?tab=examwatch"         replace />} />
          <Route path="veda"          element={<Navigate to="/admin/ops?tab=veda"              replace />} />
          <Route path="admins"        element={<Navigate to="/admin/people?tab=admins"         replace />} />
          <Route path="lookup"        element={<Navigate to="/admin/people?tab=lookup"          replace />} />
          <Route path="activity"      element={<Navigate to="/admin/people?tab=activity"        replace />} />
        </Route>

        {/* Coaching Centre Portal — completely separate from /admin.
            Paused via COACHING_MODULE_ENABLED (src/lib/moduleStatus.js) — flip that
            back to true to re-enable instead of restoring these routes by hand. */}
        {COACHING_MODULE_ENABLED && (
          <Route path="/coaching" element={
            <Suspense fallback={<PageFallback />}>
              <CoachingPortalGuard><CoachingPortalLayout /></CoachingPortalGuard>
            </Suspense>
          }>
            <Route index                  element={<Navigate to="/coaching/dashboard" replace />} />
            <Route path="dashboard"       element={<CoachingDashboard />}       />
            <Route path="students"        element={<CoachingStudentsPage />}    />
            <Route path="notes"           element={<CoachingNotesPage />}       />
            <Route path="assignments"     element={<CoachingAssignmentsPage />} />
            <Route path="settings"        element={<CoachingSettingsPage />}   />
            <Route path="tests"           element={<CoachingTestBuilder />}    />
          </Route>
        )}

        {/* Public — no auth required */}
        <Route path="/join/:code" element={<JoinCentrePage />} />
        <Route path="/privacy"    element={<PrivacyPolicyPage />} />
        <Route path="/terms"      element={<TermsOfServicePage />} />
        <Route path="/refund"     element={<RefundPolicyPage />} />
        <Route path="/about"      element={<AboutPage />} />
        <Route path="/contact"    element={<ContactPage />} />
        {COACHING_MODULE_ENABLED && (
          <Route path="/coaching-invite/:code" element={<CoachingStaffJoinPage />} />
        )}

        <Route path="/"  element={<RequireNoAuth><LandingPage /></RequireNoAuth>} />

        {/* A branded 404, NOT a redirect. This used to be
            <Navigate to="/dashboard" replace />, which sent every logged-out
            visitor — and so every crawler — bouncing off RequireAuth back to
            the homepage under HTTP 200. That made an unbounded set of bad URLs
            look like duplicates of `/`. See NotFoundPage for the half of the
            fix that needs nginx. */}
        <Route path="*"  element={<NotFoundPage />} />
      </Routes>
      </MaintenanceGate>
      </Suspense>
    </>
  );
}
