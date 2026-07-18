import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Zap, TrendingUp } from 'lucide-react';
import { getUserGamification, getLevelProgress, LEVEL_TITLES } from '../../lib/gamification';
import { useAuth } from '../../context/AuthContext';

/* ── Compact pill for TopHeader ─────────────────────────── */

export function StreakPill() {
  const { currentUser } = useAuth();
  const [streak, setStreak] = useState(null);

  useEffect(() => {
    if (!currentUser) return;
    getUserGamification(currentUser.uid)
      .then((g) => setStreak(g.streak_days))
      .catch(() => {});
  }, [currentUser]);

  if (!streak) return null;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"
    >
      <Flame size={13} className="text-amber-500" />
      <span className="text-xs font-bold text-amber-700">{streak}</span>
    </motion.div>
  );
}

/* ── Full widget for Dashboard ──────────────────────────── */

export default function StreakWidget() {
  const { currentUser } = useAuth();
  const [gam,     setGam]     = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    getUserGamification(currentUser.uid)
      .then(setGam)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentUser]);

  if (loading || !gam) return null;

  const { level, pct, nextXP } = getLevelProgress(gam.xp ?? 0);
  const title  = LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)] || 'Zenith';
  const streak = gam.streak_days ?? 0;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <Flame size={16} className="text-amber-500" /> Study Streak
        </h3>
        <span className="text-xs text-slate-400">Keep the flame alive</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        {/* Current streak */}
        <div className="bg-amber-50 rounded-2xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Flame size={16} className="text-amber-500" />
          </div>
          <p className="text-2xl font-extrabold text-amber-600">{streak}</p>
          <p className="text-[10px] text-amber-500 font-medium">Day streak</p>
        </div>

        {/* XP */}
        <div className="bg-violet-50 rounded-2xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Zap size={16} className="text-violet-500" />
          </div>
          <p className="text-2xl font-extrabold text-violet-600">{(gam.xp || 0).toLocaleString()}</p>
          <p className="text-[10px] text-violet-500 font-medium">XP earned</p>
        </div>

        {/* Best streak */}
        <div className="bg-emerald-50 rounded-2xl p-3 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp size={16} className="text-emerald-500" />
          </div>
          <p className="text-2xl font-extrabold text-emerald-600">{gam.longest_streak ?? 0}</p>
          <p className="text-[10px] text-emerald-500 font-medium">Best streak</p>
        </div>
      </div>

      {/* Level + XP bar */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-700">
            Level {level} — {title}
          </span>
          <span className="text-slate-400">{pct}% to Level {level + 1}</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-violet-500 to-primary-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
        <p className="text-[10px] text-slate-400">
          {(nextXP - (gam.xp ?? 0)).toLocaleString()} XP to next level
        </p>
      </div>

      {/* Streak milestone nudges */}
      {streak === 0 && (
        <p className="mt-3 text-xs text-slate-500 bg-slate-50 rounded-xl p-2.5 text-center">
          Start your streak today — complete any question or daily challenge 🔥
        </p>
      )}
      {streak >= 7 && streak < 30 && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 rounded-xl p-2.5 text-center font-medium">
          🎉 {streak}-day streak! Keep going to reach 30 days for +200 bonus XP!
        </p>
      )}
      {streak >= 30 && (
        <p className="mt-3 text-xs text-violet-700 bg-violet-50 rounded-xl p-2.5 text-center font-medium">
          🏆 Legend! {streak}-day streak — you earned the 30-day bonus XP!
        </p>
      )}
    </motion.div>
  );
}
