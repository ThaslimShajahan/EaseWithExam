import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getPublishedTest, getTestAttempt } from '../lib/supabase';
import MockTestEngine from '../components/exam/MockTestEngine';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import { useAuth } from '../context/AuthContext';
import { checkQuota, incrementQuota } from '../lib/quota';

export default function MockTestPage() {
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const testId      = params.get('id');
  const [test,         setTest]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [quotaErr,     setQuotaErr]     = useState('');
  const [priorAttempt, setPriorAttempt] = useState(null);
  const { currentUser, isPremium } = useAuth();

  useEffect(() => {
    async function init() {
      if (!testId) { navigate('/exam-center', { replace: true }); return; }

      // One-time attempt check — before quota so re-viewers don't burn quota
      const attempt = await getTestAttempt(currentUser?.uid, testId);
      if (attempt) {
        const data = await getPublishedTest(testId);
        setTest(data);
        setPriorAttempt(attempt);
        setLoading(false);
        return;
      }

      const quota = await checkQuota(currentUser?.uid, 'mock_tests_used', isPremium);
      if (!quota.allowed) { setQuotaErr(quota.reason); setLoading(false); return; }

      const data = await getPublishedTest(testId);
      if (!data) { navigate('/exam-center', { replace: true }); return; }
      setTest(data);
      await incrementQuota(currentUser?.uid, 'mock_tests_used');
      setLoading(false);
    }
    init();
  }, [testId, currentUser?.uid, isPremium]);

  if (loading) return <SkeletonLoader type="test" />;

  if (quotaErr) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center gap-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-xl font-bold text-slate-900">Daily Limit Reached</h2>
        <p className="text-slate-600 max-w-sm">{quotaErr}</p>
        <button onClick={() => navigate('/exam-center')}
          className="mt-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
          Back to Exam Center
        </button>
      </div>
    );
  }

  /* Already submitted — show score summary, no retake */
  if (priorAttempt && test) {
    const pct = test ? Math.round((priorAttempt.score / priorAttempt.total_marks) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center gap-5 max-w-sm mx-auto">
        <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center">
          <span className="text-4xl">✅</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Already Submitted</h2>
          <p className="text-sm text-slate-500 mt-1">{test.title}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl px-8 py-5 space-y-1 shadow-sm w-full">
          <p className="text-4xl font-extrabold text-primary-600">
            {priorAttempt.score}<span className="text-xl text-slate-400">/{priorAttempt.total_marks}</span>
          </p>
          <p className="text-sm font-semibold text-slate-600">{pct}%</p>
          <p className="text-[11px] text-slate-400 mt-1">
            Submitted {new Date(priorAttempt.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
          {priorAttempt.correct != null && (
            <div className="flex justify-center gap-4 mt-2 text-xs">
              <span className="text-emerald-600 font-semibold">✓ {priorAttempt.correct} correct</span>
              <span className="text-red-500 font-semibold">✗ {priorAttempt.wrong} wrong</span>
            </div>
          )}
        </div>
        <p className="text-xs text-slate-400">Each exam can only be attempted once.</p>
        <button onClick={() => navigate('/exam-center')}
          className="px-6 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors">
          Back to Exam Center
        </button>
      </div>
    );
  }

  if (test) {
    return (
      <MockTestEngine
        testId={testId}
        questions={test.questions}
        testConfig={{
          title:        test.title,
          duration:     test.duration_minutes,
          instructions: (() => {
            const cbseExams = new Set(['CBSE','ICSE','State Board','Class 8','Class 9','Class 10','Class 11','Class 12']);
            const isCBSE    = cbseExams.has(test.exam_type);
            return [
              `${test.questions.length} questions · ${test.exam_type} style`,
              isCBSE
                ? 'Marks vary by section (1–5 marks per question). No negative marking.'
                : 'Each correct answer carries +4 marks. Each wrong answer carries −1 mark.',
              'Do not close the browser tab during the test.',
            ];
          })(),
        }}
      />
    );
  }

  return <MockTestEngine />;
}
