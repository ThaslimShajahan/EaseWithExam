import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  BarChart3, FileText, Zap, AlertCircle, TrendingUp,
  Clock, Target, Brain,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getTestSessions } from '../../lib/supabase';
import Button from '../ui/Button';
import SkeletonLoader from '../ui/SkeletonLoader';

/* ── Helpers ───────────────────────────────────────────── */
function pct(score, total) {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}
function fmtDate(iso) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtSecs(s) {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/* ── Sub-components ────────────────────────────────────── */
function ScoreBar({ value, color = '#4F46E5' }) {
  return (
    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
      <motion.div className="h-full rounded-full" style={{ backgroundColor: color }}
        initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.7, ease: 'easeOut' }} />
    </div>
  );
}

function ScoreBadge({ pct: p }) {
  const color = p >= 70 ? 'bg-emerald-100 text-emerald-700' : p >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-600';
  return <span className={`badge ${color} tabular-nums`}>{p}%</span>;
}

function EmptyState({ onStart }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center gap-4">
      <div className="h-16 w-16 rounded-2xl bg-slate-100 flex items-center justify-center">
        <BarChart3 size={28} className="text-slate-400" />
      </div>
      <div>
        <p className="font-semibold text-slate-700">No test data yet</p>
        <p className="text-sm text-slate-400 mt-1 max-w-xs">
          Your performance graphs, subject scores, and reasoning fingerprint will appear here after you complete mock tests.
        </p>
      </div>
      <Button variant="primary" icon={<FileText size={15} />} onClick={onStart}>Take Your First Test</Button>
    </div>
  );
}

function Donut({ value, color = '#4F46E5', size = 52 }) {
  const r = 19, circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox="0 0 44 44">
      <circle cx="22" cy="22" r={r} fill="none" stroke="#E2E8F0" strokeWidth="6" />
      <motion.circle cx="22" cy="22" r={r} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round"
        strokeDasharray={`${circ * value / 100} ${circ}`} strokeDashoffset={circ / 4}
        initial={{ strokeDasharray: `0 ${circ}` }} animate={{ strokeDasharray: `${circ * value / 100} ${circ}` }}
        transition={{ duration: 0.8, ease: 'easeOut' }} />
      <text x="22" y="26" textAnchor="middle" fontSize="9" fontWeight="800" fill="#0F172A">{value}%</text>
    </svg>
  );
}

function ScoreTrend({ sessions }) {
  if (sessions.length < 2) return null;
  const pts    = sessions.slice().reverse();
  const scores = pts.map((s) => pct(s.score, s.total_marks));
  const maxV   = Math.max(...scores) + 5;
  const minV   = Math.max(0, Math.min(...scores) - 5);
  const H = 100, W = 100;
  const coords = scores.map((v, i) => ({
    x: (i / (scores.length - 1)) * W,
    y: H - ((v - minV) / (maxV - minV)) * H,
  }));
  const d    = coords.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x},${p.y}`).join(' ');
  const fill = `${d} L ${coords[coords.length - 1].x},${H} L 0,${H} Z`;
  return (
    <div className="card">
      <h3 className="font-semibold text-slate-900 mb-4">Score Trend</h3>
      <div className="relative h-36 pl-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4F46E5" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4F46E5" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={fill} fill="url(#sg)" />
          <motion.path d={d} fill="none" stroke="#4F46E5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2 }} />
          {coords.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="1.8" fill="#4F46E5" />)}
        </svg>
        <div className="absolute left-0 top-0 h-full flex flex-col justify-between text-[9px] text-slate-400">
          <span>{maxV}%</span><span>{Math.round((maxV + minV) / 2)}%</span><span>{minV}%</span>
        </div>
      </div>
    </div>
  );
}

/* ── Behavioral fingerprint ──────────────────────────────── */
function computeFingerprint(sessions) {
  const allBeh = sessions.flatMap((s) => s.behavioral_data || []);
  if (!allBeh.length) return null;

  const total     = allBeh.length;
  const answered  = allBeh.filter((b) => !b.isSkipped);
  const rushed    = allBeh.filter((b) => !b.isSkipped && b.timeSpentMs < 20_000).length;
  const hesitated = allBeh.filter((b) => b.answerChangeCount > 1).length;
  const correct   = allBeh.filter((b) => b.isCorrect).length;

  const avgTimeMs = answered.length
    ? answered.reduce((s, b) => s + (b.timeSpentMs || 0), 0) / answered.length
    : 0;

  const quickCorrect = allBeh.filter((b) => b.isCorrect && b.timeSpentMs < 30_000).length;
  const slowCorrect  = allBeh.filter((b) => b.isCorrect && b.timeSpentMs >= 90_000).length;
  const quickWrong   = allBeh.filter((b) => !b.isCorrect && !b.isSkipped && b.timeSpentMs < 20_000).length;

  // Subject time breakdown
  const subjTime = {};
  allBeh.forEach((b) => {
    if (!b.subject) return;
    if (!subjTime[b.subject]) subjTime[b.subject] = { total: 0, count: 0 };
    subjTime[b.subject].total += b.timeSpentMs || 0;
    subjTime[b.subject].count++;
  });

  return {
    total, answered: answered.length, correct, rushed, hesitated,
    avgTimeSec: Math.round(avgTimeMs / 1000),
    quickCorrect, slowCorrect, quickWrong,
    hesitationRate: total > 0 ? Math.round((hesitated / total) * 100) : 0,
    rushRate:       total > 0 ? Math.round((rushed    / total) * 100) : 0,
    subjTime,
  };
}

function BehavioralInsights({ sessions }) {
  const fp = computeFingerprint(sessions);
  if (!fp) {
    return (
      <div className="card bg-slate-50 border-dashed border-slate-200 text-center py-8">
        <Brain size={24} className="text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-400">Reasoning fingerprint unlocks after completing tests with behavioral tracking.</p>
      </div>
    );
  }

  const traits = [];
  if (fp.rushRate > 25)       traits.push({ icon: Zap,          color: 'text-amber-500', bg: 'bg-amber-50  border-amber-200', label: 'Rusher',      desc: `${fp.rushed} questions answered in under 20s` });
  if (fp.hesitationRate > 20) traits.push({ icon: AlertCircle,  color: 'text-violet-500', bg: 'bg-violet-50 border-violet-200', label: 'Hesitant',   desc: `Changed answer ${fp.hesitated}× across tests` });
  if (fp.slowCorrect > 3)     traits.push({ icon: TrendingUp,   color: 'text-blue-500',  bg: 'bg-blue-50   border-blue-200',   label: 'Deliberate', desc: `${fp.slowCorrect} correct answers took 90s+` });
  if (fp.quickCorrect > 10)   traits.push({ icon: Target,       color: 'text-emerald-500', bg: 'bg-emerald-50 border-emerald-200', label: 'Sharp', desc: `${fp.quickCorrect} correct in under 30s` });
  if (fp.quickWrong > 5)      traits.push({ icon: AlertCircle,  color: 'text-red-500',   bg: 'bg-red-50     border-red-200',   label: 'Impulsive', desc: `${fp.quickWrong} rushed wrong answers` });

  const subjEntries = Object.entries(fp.subjTime)
    .map(([s, v]) => ({ subject: s, avgSec: Math.round(v.total / v.count / 1000) }))
    .sort((a, b) => b.avgSec - a.avgSec);

  const maxAvg = subjEntries[0]?.avgSec || 1;

  return (
    <div className="card space-y-5">
      <div className="flex items-center gap-2">
        <Brain size={17} className="text-violet-600" />
        <h3 className="font-semibold text-slate-900">Reasoning Fingerprint</h3>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3 text-center text-xs">
        {[
          { label: 'Avg. Time/Q',  value: fmtSecs(fp.avgTimeSec),              color: 'text-slate-900' },
          { label: 'Hesitation',   value: `${fp.hesitationRate}%`,              color: fp.hesitationRate > 20 ? 'text-violet-600' : 'text-slate-900' },
          { label: 'Rush Rate',    value: `${fp.rushRate}%`,                     color: fp.rushRate > 25 ? 'text-amber-600' : 'text-slate-900' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-50 rounded-xl p-2.5">
            <p className={`text-base font-extrabold ${color}`}>{value}</p>
            <p className="text-slate-400 text-[10px] mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Trait pills */}
      {traits.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {traits.map(({ icon: Icon, color, bg, label, desc }) => (
            <div key={label} className={`flex items-center gap-1.5 border px-3 py-1.5 rounded-full ${bg}`}>
              <Icon size={11} className={color} />
              <span className={`text-xs font-semibold ${color}`}>{label}</span>
              <span className="text-[10px] text-slate-500 hidden sm:inline">— {desc}</span>
            </div>
          ))}
        </div>
      )}

      {/* Subject time bars */}
      {subjEntries.length > 1 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Avg time per subject</p>
          {subjEntries.map(({ subject, avgSec }) => (
            <div key={subject}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-slate-700 font-medium">{subject}</span>
                <span className="text-slate-400 flex items-center gap-0.5"><Clock size={9} />{fmtSecs(avgSec)}</span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <motion.div className="h-full bg-violet-400 rounded-full"
                  initial={{ width: 0 }} animate={{ width: `${(avgSec / maxAvg) * 100}%` }}
                  transition={{ duration: 0.7 }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Insight text */}
      <div className="bg-slate-50 rounded-xl p-3">
        <p className="text-xs text-slate-500 leading-relaxed">
          {fp.rushed > fp.hesitated
            ? `You tend to answer quickly. Make sure you're reading questions fully — ${fp.quickWrong} rushed answers were wrong.`
            : fp.hesitated > 5
            ? `You change answers often (${fp.hesitated} times). Trust your first instinct more — in ${(sessions[0]?.exam_type || 'competitive')} exams, initial answers are more often correct.`
            : `Solid pacing. Average ${fmtSecs(fp.avgTimeSec)} per question across ${fp.total} total questions.`}
        </p>
      </div>
    </div>
  );
}

/* ── Main component ───────────────────────────────────── */
export default function PerformanceAnalytics() {
  const { currentUser } = useAuth();
  const navigate        = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    if (!currentUser) return;
    getTestSessions(currentUser.uid, 50)
      .then(setSessions)
      .catch((e) => setError(e.message || 'Failed to load test data.'))
      .finally(() => setLoading(false));
  }, [currentUser]);

  if (loading) return <SkeletonLoader type="card" />;

  if (error) return (
    <div className="rounded-card bg-danger-light border border-danger/20 p-6 text-center">
      <BarChart3 size={24} className="text-danger mx-auto mb-2" />
      <p className="text-sm font-semibold text-danger">Failed to load analytics</p>
      <p className="text-xs text-slate-500 mt-1">{error}</p>
    </div>
  );

  return (
    <div className="space-y-5 p-4 lg:p-0">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Performance Analytics</h2>
        <p className="text-sm text-slate-500 mt-0.5">Based on your actual test history</p>
      </div>

      {sessions.length === 0 ? (
        <EmptyState onStart={() => navigate('/test')} />
      ) : (
        <>
          <ScoreTrend sessions={sessions} />

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Best Score', value: `${Math.max(...sessions.map((s) => pct(s.score, s.total_marks)))}%`, color: 'text-emerald-600' },
              { label: 'Avg. Score', value: `${Math.round(sessions.reduce((a, s) => a + pct(s.score, s.total_marks), 0) / sessions.length)}%`, color: 'text-primary-600' },
              { label: 'Tests Done', value: sessions.length, color: 'text-violet-600' },
            ].map(({ label, value, color }) => (
              <div key={label} className="card text-center">
                <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Reasoning fingerprint */}
          <BehavioralInsights sessions={sessions} />

          {/* Test history */}
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-4">
              All Tests <span className="text-slate-400 font-normal text-sm">({sessions.length})</span>
            </h3>
            <div className="space-y-3">
              {sessions.map((s) => {
                const p = pct(s.score, s.total_marks);
                return (
                  <div key={s.id} className="flex items-center gap-3">
                    <Donut value={p} color={p >= 70 ? '#10B981' : p >= 50 ? '#F59E0B' : '#EF4444'} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-slate-800 truncate">{s.test_name || 'Mock Test'}</p>
                        <ScoreBadge pct={p} />
                      </div>
                      <ScoreBar value={p} color={p >= 70 ? '#10B981' : p >= 50 ? '#F59E0B' : '#EF4444'} />
                      <p className="text-xs text-slate-400 mt-1">
                        {s.score}/{s.total_marks} marks · {s.correct ?? '?'}✓ {s.wrong ?? '?'}✗ · {fmtDate(s.created_at)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
