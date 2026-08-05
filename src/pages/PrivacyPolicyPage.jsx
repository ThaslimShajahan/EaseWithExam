import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Shield } from 'lucide-react';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';

const LAST_UPDATED = 'August 4, 2026';

function Section({ title, children }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-bold text-slate-900">{title}</h2>
      <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
    </div>
  );
}

/**
 * Plain-language privacy & cookie policy — drafted to accurately describe
 * what this app actually does (Firebase auth, Supabase storage, OpenAI for
 * AI features, Razorpay for payments). This is a starting point for the
 * business to review/adapt, not a substitute for actual legal review.
 */
export default function PrivacyPolicyPage() {
  const navigate = useNavigate();

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
            <Shield size={20} className="text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900">Privacy &amp; Cookie Policy</h1>
            <p className="text-xs text-slate-400 mt-0.5">Last updated: {LAST_UPDATED}</p>
          </div>
        </div>

        <div className="card space-y-6">
          <Section title="Who we are">
            <p>
              EaseWithExam ("EWE", "we", "us") is an exam-preparation platform for NEET, JEE, and board
              students, operated by Acenzos. This page explains what information we collect, why, and how
              you can control it.
            </p>
          </Section>

          <Section title="Information we collect">
            <p><strong>Account information</strong> — when you sign in with Google or phone number, we receive your
              name, email or phone number, and profile photo from that sign-in provider.</p>
            <p><strong>Academic profile</strong> — the exam you're preparing for, your board/syllabus, and class,
              which you provide during onboarding.</p>
            <p><strong>Usage &amp; progress data</strong> — mock test scores, practice sessions, answers, streaks,
              XP, and daily feature usage, so we can track your progress and enforce plan limits.</p>
            <p><strong>Uploaded content</strong> — if you upload a photo of your handwritten answer sheet or a
              question paper for AI evaluation, that image is sent to our AI provider to generate feedback and is
              not used for anything beyond producing that response.</p>
            <p><strong>Payment information</strong> — if you subscribe to Premium, payment is processed directly by
              Razorpay. We do not receive or store your card, UPI, or bank details ourselves.</p>
          </Section>

          <Section title="How we use your information">
            <p>To run the core product: authenticate you, save your progress, generate personalised AI practice
              questions and explanations, evaluate uploaded answer sheets, show your analytics and leaderboard
              rank, process payments, and send you product notifications (e.g. daily challenge reminders).</p>
            <p>We do not sell your personal data to third parties.</p>
          </Section>

          <Section title="Third-party services we use">
            <p><strong>Firebase (Google)</strong> — authentication (Google sign-in, phone OTP).</p>
            <p><strong>Supabase</strong> — our database, where your profile, test history, and progress are stored.</p>
            <p><strong>OpenAI</strong> — powers AI practice question generation, the EWE chat tutor, and answer
              sheet evaluation. Content you send to these features (questions, uploaded images) is processed by
              OpenAI's API to generate a response.</p>
            <p><strong>Razorpay</strong> — payment processing for Premium subscriptions.</p>
          </Section>

          <Section title="Cookies & local storage">
            <p>We use browser local storage (not third-party ad-tracking cookies) for:</p>
            <p>• Keeping you signed in between visits.</p>
            <p>• Saving in-progress mock test answers locally so a refresh doesn't lose your attempt.</p>
            <p>• Remembering that you've dismissed this cookie notice.</p>
            <p>We don't use advertising or cross-site tracking cookies.</p>
          </Section>

          <Section title="Students under 18">
            <p>Many of our users are school students. If you are under 18, please use this platform with a
              parent or guardian's awareness. Parents can view a student's progress via the Share with Parent
              feature in Profile.</p>
          </Section>

          <Section title="Your choices">
            <p>You can review your academic profile and subscription from the Profile page at any time. To
              request a copy or deletion of your data, or ask any question about this policy, email us at{' '}
              <a href="mailto:info@acenzos.com" className="text-primary-600 hover:underline font-semibold">
                info@acenzos.com
              </a>.</p>
          </Section>

          <Section title="Changes to this policy">
            <p>We may update this policy as the product changes. Material changes will be reflected by updating
              the date at the top of this page.</p>
          </Section>
        </div>
      </div>
      </div>
      <PublicFooter />
    </div>
  );
}
