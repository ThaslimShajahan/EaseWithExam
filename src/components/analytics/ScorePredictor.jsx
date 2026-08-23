import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, Lock, Share2, Crown } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getTestSessions } from '../../lib/supabase';
import { buildExamType } from '../../lib/categories';
import Button from '../ui/Button';
import { useNavigate } from 'react-router-dom';

/* ── Exam score ranges ─────────────────────────────────── */
// Keys match buildExamType()'s normalized output (e.g. 'JEE Main', 'CBSE Class 10').

const EXAM_CONFIG = {
  NEET:          { label: 'NEET UG',        max: 720, qualify: 550, good: 600, excellent: 660, unit: 'marks' },
  'JEE Main':    { label: 'JEE Main',       max: 300, qualify: 120, good: 180, excellent: 240, unit: 'marks' },
  'JEE Advanced':{ label: 'JEE Advanced',   max: 360, qualify: 100, good: 180, excellent: 250, unit: 'marks' },
  CBSE:          { label: 'CBSE Boards',      max: 100, qualify: 60, good: 75, excellent: 90, unit: '%' },
  ICSE:          { label: 'ICSE Boards',       max: 100, qualify: 60, good: 75, excellent: 90, unit: '%' },
  'State Board': { label: 'State Board',       max: 100, qualify: 50, good: 65, excellent: 85, unit: '%' },
  'Kerala State':{ label: 'Kerala State',      max: 100, qualify: 50, good: 65, excellent: 85, unit: '%' },
  'Class 6':     { label: 'Class 6',           max: 100, qualify: 40, good: 60, excellent: 80, unit: '%' },
  'Class 7':     { label: 'Class 7',           max: 100, qualify: 40, good: 60, excellent: 80, unit: '%' },
  'Class 8':     { label: 'Class 8',           max: 100, qualify: 40, good: 60, excellent: 80, unit: '%' },
  'Class 9':     { label: 'Class 9',           max: 100, qualify: 45, good: 65, excellent: 82, unit: '%' },
  'Class 10':    { label: 'Class 10 Boards',   max: 100, qualify: 60, good: 75, excellent: 90, unit: '%' },
  'Class 11':    { label: 'Class 11',          max: 100, qualify: 55, good: 70, excellent: 85, unit: '%' },
  'Class 12':    { label: 'Class 12 Boards',   max: 100, qualify: 60, good: 75, excellent: 90, unit: '%' },
};

const GENERIC_CONFIG = { label: 'Exam', max: 100, qualify: 50, good: 70, excellent: 85, unit: '%' };

// Board+class combos (e.g. 'CBSE Class 10') aren't individual keys above — fall back to
// the bare class ('Class 10') so board students still get class-tuned thresholds.
function getExamConfig(examType) {
  if (EXAM_CONFIG[examType]) return EXAM_CONFIG[examType];
  const classMatch = examType?.match(/Class (\d+)$/);
  if (classMatch && EXAM_CONFIG[`Class ${classMatch[1]}`]) return EXAM_CONFIG[`Class ${classMatch[1]}`];
  return GENERIC_CONFIG;
}

/* ── Prediction algorithm ──────────────────────────────── */

function predict(sessions, examConfig) {
  if (sessions.length < 2) return null;

  const recent = sessions.slice(0, 8);
  const weights = recent.map((_, i) => Math.exp(-i * 0.3));
  const sumW = weights.reduce((a, b) => a + b, 0);

  const weightedAvgPct = recent.reduce((acc, s, i) => {
    const pct = s.total_marks > 0 ? s.score / s.total_marks : 0;
    return acc + pct * weights[i];
  }, 0) / sumW;

  const variance = recent.reduce((acc, s, i) => {
    const pct = s.total_marks > 0 ? s.score / s.total_marks : 0;
    return acc + weights[i] * Math.pow(pct - weightedAvgPct, 2);
  }, 0) / sumW;
  const stdDev = Math.sqrt(variance);

  const trend = recent.length >= 3
    ? (recent[0].score / recent[0].total_marks - recent[recent.length - 1].score / recent[recent.length - 1].total_marks) / recent.length
    : 0;

  const projectedPct = Math.min(1, Math.max(0, weightedAvgPct + trend * 3));
  const projectedScore = Math.round(projectedPct * examConfig.max);
  const margin = Math.round(stdDev * examConfig.max * 1.5);

  return {
    score:  projectedScore,
    low:    Math.max(0,              projectedScore - margin),
    high:   Math.min(examConfig.max, projectedScore + margin),
    pct:    Math.round(projectedPct * 100),
    trend:  trend > 0.005 ? 'improving' : trend < -0.005 ? 'declining' : 'stable',
    testsUsed: recent.length,
  };
}

function TrendBadge({ trend }) {
  const map = {
    improving: { label: '↑ Improving',  cls: 'bg-emerald-100 text-emerald-700' },
    declining:  { label: '↓ Declining',  cls: 'bg-red-100     text-red-700'     },
    stable:     { label: '→ Stable',     cls: 'bg-slate-100   text-slate-600'   },
  };
  const { label, cls } = map[trend] ?? map.stable;
  return <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}

function ScoreBar({ score, low, high, max, qualify, good }) {
  const pct    = (score / max) * 100;
  const lowPct = (low / max) * 100;
  const hiPct  = (high / max) * 100;
  const qPct   = (qualify / max) * 100;
  const gPct   = (good / max) * 100;

  return (
    <div className="relative mt-4 mb-2">
      {/* Track */}
      <div className="h-4 bg-slate-100 rounded-full overflow-hidden relative">
        {/* Confidence band */}
        <div
          className="absolute h-full bg-primary-200 rounded-full opacity-60"
          style={{ left: `${lowPct}%`, width: `${hiPct - lowPct}%` }}
        />
        {/* Score pointer */}
        <motion.div
          className="absolute h-full w-1 bg-primary-600 rounded-full"
          initial={{ left: 0 }}
          animate={{ left: `${pct}%` }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />
      </div>
      {/* Labels */}
      <div className="relative h-5 mt-1">
        <span
          className="absolute text-[9px] text-slate-400 -translate-x-1/2"
          style={{ left: `${qPct}%` }}
        >
          Qualify
        </span>
        <span
          className="absolute text-[9px] text-slate-400 -translate-x-1/2"
          style={{ left: `${gPct}%` }}
        >
          Good
        </span>
      </div>
    </div>
  );
}

/* ── Share card generator ──────────────────────────────── */

function handleShare(prediction, examLabel) {
  const text = `🎯 My predicted ${examLabel} score: ${prediction.low}–${prediction.high} (avg ${prediction.score}) based on my last ${prediction.testsUsed} mock tests on EaseWithExam!\n\nTrack your progress → easewithexam.com`;
  if (navigator.share) {
    navigator.share({ title: 'My Score Prediction', text });
  } else {
    navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard!'));
  }
}

/* ── Main widget ───────────────────────────────────────── */

export default function ScorePredictor() {
  const { currentUser, userProfile, isPremium: premium } = useAuth();
  const navigate = useNavigate();
  const [sessions,    setSessions]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [prediction,  setPrediction]  = useState(null);
  const exam     = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const examConf = getExamConfig(exam);

  useEffect(() => {
    if (!currentUser || !premium) { setLoading(false); return; }
    getTestSessions(currentUser.uid, 10, userProfile?.target_exam)
      .then((s) => {
        setSessions(s);
        const p = predict(s, examConf);
        setPrediction(p);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser, premium, userProfile?.target_exam]);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary-500" /> Score Predictor
        </h3>
        {premium && (
          <span className="text-[10px] font-bold bg-primary-100 text-primary-700 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Crown size={9} /> Premium
          </span>
        )}
      </div>

      {/* Not premium — locked state */}
      {!premium && (
        <div className="text-center py-6 space-y-3">
          <div className="h-12 w-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto">
            <Lock size={20} className="text-slate-400" />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">Predict your exam score</p>
            <p className="text-xs text-slate-500 mt-0.5 max-w-[240px] mx-auto">
              Based on your last 8 mock tests, we'll project your {examConf.label} score range.
            </p>
          </div>
          <Button variant="primary" size="sm" onClick={() => navigate('/pricing')} icon={<Crown size={14} />} className="!h-11">
            Upgrade to unlock
          </Button>
        </div>
      )}

      {/* Premium + loading */}
      {premium && loading && (
        <div className="text-center py-6 text-slate-400 text-sm">Analysing your tests…</div>
      )}

      {/* Premium + not enough data */}
      {premium && !loading && !prediction && (
        <div className="text-center py-6 space-y-2">
          <p className="font-semibold text-slate-700 text-sm">Need at least 2 mock tests</p>
          <p className="text-xs text-slate-400 max-w-[220px] mx-auto">
            Complete more mock tests and we'll predict your {examConf.label} score.
          </p>
          <Button variant="secondary" size="sm" onClick={() => navigate('/test')}>Take a mock test →</Button>
        </div>
      )}

      {/* Premium + prediction ready */}
      {premium && !loading && prediction && (
        <>
          <div className="bg-gradient-to-r from-primary-50 to-primary-100 rounded-2xl p-4 mb-4">
            <div className="flex items-end gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">Projected {examConf.label} score</p>
                <p className="text-4xl font-extrabold text-slate-900">
                  {prediction.low}<span className="text-2xl text-slate-400">–</span>{prediction.high}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">out of {examConf.max} · 95% confidence</p>
              </div>
              <div className="ml-auto flex flex-col items-end gap-2">
                <TrendBadge trend={prediction.trend} />
                <p className="text-[10px] text-slate-400">Based on {prediction.testsUsed} tests</p>
              </div>
            </div>

            <ScoreBar
              score={prediction.score}
              low={prediction.low}
              high={prediction.high}
              max={examConf.max}
              qualify={examConf.qualify}
              good={examConf.good}
            />
          </div>

          {/* Insight line */}
          <p className="text-xs text-slate-500 mb-3">
            {prediction.trend === 'improving'
              ? `You're on an upward trajectory! Maintain this pace and you'll exceed your target.`
              : prediction.trend === 'declining'
              ? `Recent scores are dipping — review weak topics with EWE to recover.`
              : `Scores are consistent. Push into the next bracket with targeted practice.`}
          </p>

          <Button
            variant="secondary"
            size="sm"
            icon={<Share2 size={13} />}
            onClick={() => handleShare(prediction, examConf.label)}
          >
            Share prediction
          </Button>
        </>
      )}
    </motion.div>
  );
}
