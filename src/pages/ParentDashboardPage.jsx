import { useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Users, Flame, Trophy, Zap, TrendingUp, TrendingDown, Minus,
  BookOpen, Target, AlertTriangle, CheckCircle, Share2, Lock,
} from 'lucide-react';
import { getUser, getTestSessions } from '../lib/supabase';
import { getUserGamification, getLevelProgress, LEVEL_TITLES } from '../lib/gamification';
import { getUserSubscription, PLANS } from '../lib/subscription';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { formatExamLabel } from '../lib/categories';

/* ── Token validation against parent_student_links ──────────── */
async function validateParentToken(studentUid, token) {
  if (!token) return false;
  const { data } = await supabase
    .from('parent_student_links')
    .select('id')
    .eq('student_uid', studentUid)
    .eq('link_token', token)
    .eq('is_active', true)
    .maybeSingle();
  return !!data;
}

/* ── Generate a shareable link with token ────────────────────── */
export async function makeParentShareLink(firebaseUid) {
  // Upsert a link_token for this student
  const { data, error } = await supabase
    .from('parent_student_links')
    .upsert(
      { student_uid: firebaseUid, is_active: true },
      { onConflict: 'student_uid', ignoreDuplicates: false }
    )
    .select('link_token')
    .single();
  if (error || !data) return `${window.location.origin}/parent/${firebaseUid}`;
  return `${window.location.origin}/parent/${firebaseUid}?token=${data.link_token}`;
}

async function copyLink(uid) {
  const url = await makeParentShareLink(uid);
  if (navigator.share) {
    navigator.share({ title: 'My EaseWithExam Progress', url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url).catch(() => {});
  }
}

/* ── Trend icon ──────────────────────────────────────────── */
function Trend({ pct }) {
  if (pct > 0)  return <TrendingUp size={13} className="text-emerald-500" />;
  if (pct < 0)  return <TrendingDown size={13} className="text-red-400" />;
  return <Minus size={13} className="text-slate-400" />;
}

/* ── Stat card ───────────────────────────────────────────── */
function Stat({ icon: Icon, label, value, sub, color = 'primary' }) {
  const colors = {
    primary: 'bg-primary-50 text-primary-500',
    amber:   'bg-amber-50   text-amber-500',
    violet:  'bg-violet-50  text-violet-500',
    emerald: 'bg-emerald-50 text-emerald-500',
  };
  return (
    <div className="card flex items-center gap-4 p-4">
      <div className={`h-11 w-11 rounded-xl flex items-center justify-center shrink-0 ${colors[color]}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-xl font-extrabold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
        {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

/* ── Score trend chart (simple bars) ────────────────────── */
function ScoreBars({ sessions }) {
  if (!sessions?.length) return null;
  const recent = [...sessions].reverse().slice(-8);
  const max = Math.max(...recent.map((s) => s.total_marks || 100));
  return (
    <div className="card space-y-3">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Test Scores</p>
      <div className="flex items-end gap-2 h-24">
        {recent.map((s, i) => {
          const pct = Math.round(((s.score ?? 0) / (s.total_marks || 100)) * 100);
          const color = pct >= 70 ? 'bg-emerald-400' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400';
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1" title={`${s.test_name}: ${pct}%`}>
              <span className="text-[9px] text-slate-500">{pct}%</span>
              <div className={`w-full rounded-t ${color} transition-all`} style={{ height: `${(pct / 100) * 70}px` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-[9px] text-slate-400">
        <span>Oldest</span>
        <span>Latest</span>
      </div>
    </div>
  );
}

/* ── Weak topics derived from low-scoring sessions ───────── */
function WeakTopics({ sessions }) {
  const lowScoring = (sessions || [])
    .filter((s) => {
      const pct = (s.score ?? 0) / (s.total_marks || 100);
      return pct < 0.5 && s.test_name;
    })
    .slice(0, 5);

  if (!lowScoring.length) {
    return (
      <div className="card flex items-center gap-3 p-4">
        <CheckCircle size={18} className="text-emerald-500 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-slate-800">All Tests Above 50%</p>
          <p className="text-xs text-slate-500">No weak areas detected from recent tests.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={14} className="text-amber-500" />
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Needs Attention</p>
      </div>
      <div className="space-y-2">
        {lowScoring.map((s, i) => {
          const pct = Math.round(((s.score ?? 0) / (s.total_marks || 100)) * 100);
          return (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-100 last:border-0">
              <span className="text-sm text-slate-700 truncate">{s.test_name}</span>
              <span className="text-xs font-bold text-red-500 shrink-0 ml-2">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────── */
export default function ParentDashboardPage() {
  const { studentUid } = useParams();
  const [searchParams]  = useSearchParams();
  const { currentUser, subscription: ownSubscription } = useAuth();

  const token = searchParams.get('token');
  // Viewing own profile (logged-in student) — always allowed
  const isOwnView = !studentUid || studentUid === currentUser?.uid;
  const targetUid = studentUid || currentUser?.uid;

  const [profile,       setProfile]       = useState(null);
  const [sessions,      setSessions]      = useState([]);
  const [gam,           setGam]           = useState(null);
  const [sub,           setSub]           = useState(null);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');
  const [tokenInvalid,  setTokenInvalid]  = useState(false);

  useEffect(() => {
    if (!targetUid) { setLoading(false); return; }

    const load = async () => {
      // Enforce token gate for external parent views
      if (!isOwnView) {
        if (!token) { setTokenInvalid(true); setLoading(false); return; }
        const valid = await validateParentToken(targetUid, token).catch(() => false);
        if (!valid)  { setTokenInvalid(true); setLoading(false); return; }
      }

      try {
        // Fetch the profile first — getTestSessions needs its target_exam to
        // scope sessions to the student's current exam, so it can't run in
        // the same Promise.all as the profile fetch it depends on.
        const p = await getUser(targetUid);
        const [s, g, sb] = await Promise.all([
          getTestSessions(targetUid, 20, p?.target_exam),
          getUserGamification(targetUid),
          isOwnView ? Promise.resolve(ownSubscription) : getUserSubscription(targetUid),
        ]);
        setProfile(p);
        setSessions(s || []);
        setGam(g);
        setSub(sb);
      } catch (e) { setError(e.message); }
      finally     { setLoading(false); }
    };

    load();
  }, [targetUid, token, isOwnView, ownSubscription]); // ownSubscription in deps so own-view re-runs after refreshSubscription()

  if (tokenInvalid) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center p-6">
        <div className="h-16 w-16 rounded-full bg-red-50 flex items-center justify-center">
          <Lock size={28} className="text-red-400" />
        </div>
        <h2 className="text-lg font-bold text-slate-900">Access Denied</h2>
        <p className="text-sm text-slate-500 max-w-xs">
          This link is invalid or has expired. Ask the student to share a fresh link from their Profile page.
        </p>
      </div>
    );
  }

  if (!targetUid) {
    return (
      <div className="card text-center py-12 space-y-3">
        <Lock size={32} className="text-slate-300 mx-auto" />
        <p className="text-slate-600 font-medium">No student linked</p>
        <p className="text-xs text-slate-400">Share your progress link from your profile page.</p>
        <Link to="/profile" className="btn-primary text-sm inline-flex items-center gap-1.5 mt-2">
          Go to Profile
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 py-16 text-slate-500">
        <div className="h-5 w-5 border-2 border-slate-300 border-t-primary-500 rounded-full animate-spin" />
        Loading student progress…
      </div>
    );
  }

  if (error) {
    return (
      <div className="card text-center py-10">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    );
  }

  const name = profile?.display_name || profile?.email?.split('@')[0] || 'Student';
  const levelInfo = gam ? getLevelProgress(gam.xp ?? 0) : null;
  const levelTitle = levelInfo ? (LEVEL_TITLES[Math.min(levelInfo.level, LEVEL_TITLES.length - 1)] || 'Zenith') : 'Beginner';
  const subActive = sub?.isActive === true;
  const planName  = subActive ? (PLANS[sub?.plan]?.name ?? 'Premium') : 'Free';

  const avgScore = sessions.length
    ? Math.round(sessions.reduce((acc, s) => acc + ((s.score ?? 0) / (s.total_marks || 100)) * 100, 0) / sessions.length)
    : null;

  const recent2 = sessions.slice(0, 2);
  const trend = recent2.length === 2
    ? Math.round(((recent2[0].score ?? 0) / (recent2[0].total_marks || 100)) * 100) -
      Math.round(((recent2[1].score ?? 0) / (recent2[1].total_marks || 100)) * 100)
    : 0;

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-lg">
      {/* Header */}
      <motion.div className="flex items-start justify-between" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <div>
          <div className="flex items-center gap-2">
            <Users size={18} className="text-primary-500" />
            <h2 className="text-xl font-bold text-slate-900">Parent Dashboard</h2>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">Monitoring: <span className="font-semibold text-slate-700">{name}</span></p>
        </div>
        {currentUser && (
          <button
            onClick={() => copyLink(currentUser.uid)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-50 text-primary-600 text-xs font-semibold hover:bg-primary-100 transition-colors border border-primary-200"
          >
            <Share2 size={13} /> Share link
          </button>
        )}
      </motion.div>

      {/* Plan badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-xs font-semibold">
          <BookOpen size={11} /> {planName}
        </span>
        <span className="text-xs text-slate-400">
          {formatExamLabel(profile?.target_exam, '')} •{' '}
          {profile?.class_level ? `Class ${profile.class_level}` : ''}
        </span>
      </div>

      {/* Stats grid */}
      <motion.div className="grid grid-cols-2 gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
        <Stat icon={Flame}  label="Day Streak"    value={gam?.streak_days ?? 0} color="amber" />
        <Stat icon={Zap}    label="XP Earned"     value={(gam?.xp ?? 0).toLocaleString()} color="violet" />
        <Stat icon={Trophy} label="Level"         value={levelTitle} sub={`Level ${levelInfo?.level ?? 1}`} color="primary" />
        <Stat icon={Target} label="Avg Score"
          value={avgScore !== null ? `${avgScore}%` : '—'}
          sub={sessions.length ? `${sessions.length} tests taken` : 'No tests yet'}
          color="emerald"
        />
      </motion.div>

      {/* Trend pill */}
      {sessions.length >= 2 && (
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <Trend pct={trend} />
          <span>
            {trend > 0 ? `+${trend}%` : trend < 0 ? `${trend}%` : 'Same'} vs previous test
          </span>
        </div>
      )}

      {/* Level progress */}
      {levelInfo && (
        <div className="card space-y-2">
          <div className="flex justify-between text-xs text-slate-500">
            <span>{levelTitle} — Level {levelInfo.level}</span>
            <span>{levelInfo.pct}% to next</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full"
              initial={{ width: 0 }} animate={{ width: `${levelInfo.pct}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
        </div>
      )}

      {/* Score chart */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        <ScoreBars sessions={sessions} />
      </motion.div>

      {/* Weak topics */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <WeakTopics sessions={sessions} />
      </motion.div>

      {/* Recent tests table */}
      {sessions.length > 0 && (
        <motion.div className="card space-y-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18 }}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Test History</p>
          <div className="divide-y divide-slate-100">
            {sessions.slice(0, 6).map((s, i) => {
              const pct = Math.round(((s.score ?? 0) / (s.total_marks || 100)) * 100);
              const color = pct >= 70 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500';
              const date = new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              return (
                <div key={i} className="flex items-center justify-between py-2.5">
                  <div>
                    <p className="text-sm text-slate-800 truncate max-w-[180px]">{s.test_name || 'Practice Test'}</p>
                    <p className="text-[10px] text-slate-400">{date}</p>
                  </div>
                  <span className={`text-sm font-bold ${color}`}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      )}

      {/* Share note */}
      <p className="text-[10px] text-slate-400 text-center pb-4">
        This page is accessible to anyone with the share link. Only the student's progress is shown — no personal data beyond their name.
      </p>
    </div>
  );
}
