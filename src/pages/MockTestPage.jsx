import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { getPublishedTest, getTestAttempt, lockExamAttemptMode } from '../lib/supabase';
import MockTestEngine from '../components/exam/MockTestEngine';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import { useAuth } from '../context/AuthContext';
import { checkQuota, incrementQuota } from '../lib/quota';
import { getExamPattern, isCBSEStyle } from '../lib/examPattern';
import PaywallModal from '../components/ui/PaywallModal';

export default function MockTestPage() {
  const [params]    = useSearchParams();
  const navigate    = useNavigate();
  const testId      = params.get('id');
  const [test,         setTest]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [quotaErr,     setQuotaErr]     = useState('');
  const [priorAttempt, setPriorAttempt] = useState(null);
  const [loadErr,      setLoadErr]      = useState('');
  const { currentUser, isPremium } = useAuth();

  useEffect(() => {
    async function init() {
      if (!testId) { navigate('/exam-center', { replace: true }); return; }

      try {
        // One-time attempt check — before quota so re-viewers don't burn quota
        const attempt = await getTestAttempt(currentUser?.uid, testId);
        if (attempt) {
          const data = await getPublishedTest(testId);
          if (!data) { setLoadErr('This test could not be found. It may have been removed.'); setLoading(false); return; }
          setTest(data);
          setPriorAttempt(attempt);
          setLoading(false);
          return;
        }

        // An IN-PROGRESS attempt (not yet submitted) also must not re-charge quota —
        // getTestAttempt only sees completed test_sessions rows, so a mid-exam
        // refresh (MockTestEngine saves progress to localStorage, keyed by test
        // TITLE — see the matching storageKey in MockTestEngine.jsx) would otherwise
        // burn quota again on every remount, and a free-tier student who refreshes
        // a couple of times mid-exam could get shown "Daily Limit Reached" with no
        // way back into their in-progress answers. Fetch the test first (needed to
        // compute the same key) before deciding whether to charge quota at all.
        const data = await getPublishedTest(testId);
        if (!data) { setLoadErr('This test could not be found. It may have been removed.'); setLoading(false); return; }
        // The Exam Center listing already hides drafts, but a direct/bookmarked
        // link to a test's id bypassed that entirely — nothing here checked
        // is_published, so an unpublished (or since-unpublished) test was
        // still fully launchable.
        if (data.is_published === false) { setLoadErr('This test is not currently available.'); setLoading(false); return; }

        // Item 7: once a student has started this test in either mode, they're
        // locked to it — idempotent, so this is a no-op if already locked to
        // 'online'. If it comes back 'paper' (started there instead, e.g. via
        // /paper-mode), bounce straight there instead of letting a second,
        // independent online attempt spin up.
        const lockedMode = await lockExamAttemptMode(currentUser?.uid, testId, 'online');
        if (lockedMode === 'paper') {
          navigate(`/paper-mode?id=${encodeURIComponent(testId)}`, { replace: true });
          return;
        }

        const storageKey = `ewe_exam_${String(data.title || '').replace(/\W+/g, '_').slice(0, 40)}`;
        const hasLocalProgress = (() => {
          try { return !!localStorage.getItem(storageKey); } catch { return false; }
        })();
        if (hasLocalProgress) {
          setTest(data);
          setLoading(false);
          return;
        }

        const quota = await checkQuota(currentUser?.uid, 'mock_tests_used', isPremium);
        if (!quota.allowed) { setQuotaErr(quota.reason); setLoading(false); return; }

        setTest(data);
        await incrementQuota(currentUser?.uid, 'mock_tests_used');
        setLoading(false);
      } catch (err) {
        setLoadErr(err?.message || 'Could not load this test. Please try again.');
        setLoading(false);
      }
    }
    init();
  }, [testId, currentUser?.uid, isPremium]);

  if (loading) return <SkeletonLoader type="test" />;

  if (loadErr) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center gap-4">
        <div className="text-4xl">⚠️</div>
        <h2 className="text-xl font-bold text-slate-900">Couldn't load test</h2>
        <p className="text-slate-600 max-w-sm">{loadErr}</p>
        <button onClick={() => navigate('/exam-center')}
          className="mt-2 px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition-colors">
          Back to Exam Center
        </button>
      </div>
    );
  }

  if (quotaErr) {
    return (
      <PaywallModal
        onClose={() => navigate('/exam-center')}
        feature="Mock tests"
        firebaseUid={currentUser?.uid}
        email={currentUser?.email}
      />
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
            const isCBSE = isCBSEStyle(getExamPattern(test.exam_type));
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
