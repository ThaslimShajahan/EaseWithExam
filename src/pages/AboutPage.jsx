import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { PublicNavBar, PublicFooter } from '../components/layout/PublicChrome';
import { useSeo } from '../lib/seo';

export default function AboutPage() {
  useSeo('/about');
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
              <Sparkles size={20} className="text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-slate-900">About EaseWithExam</h1>
              <p className="text-xs text-slate-400 mt-0.5">AI-powered exam prep for NEET, JEE &amp; Boards</p>
            </div>
          </div>

          <div className="card space-y-6 text-sm text-slate-600 leading-relaxed">
            <p>
              EaseWithExam (EWE) is an AI-powered exam-preparation platform built for NEET, JEE, and board
              students. Instead of another generic quiz app, EWE is built around how these specific exams are
              actually structured and scored — real exam patterns, real marking schemes, and subject coverage
              that matches the syllabus.
            </p>
            <p>
              The platform combines an AI tutor that teaches with guided questions rather than just handing over
              answers, unlimited AI-generated practice questions with full worked solutions, full-length mock
              tests with post-test analysis, a personalised week-by-week study plan, and tools like an AI
              summarizer and podcast generator for turning notes into something you can review on the go.
            </p>
            <p>
              EWE is operated by <strong>Acenzos</strong>. For any questions, reach us at{' '}
              <a href="mailto:info@acenzos.com" className="text-primary-600 hover:underline font-semibold">
                info@acenzos.com
              </a>.
            </p>
          </div>
        </div>
      </div>
      <PublicFooter />
    </div>
  );
}
