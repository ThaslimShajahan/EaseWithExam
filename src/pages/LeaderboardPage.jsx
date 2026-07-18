import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Flame, Zap, ArrowLeft, Crown, Star, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { LEVEL_TITLES } from '../lib/gamification';

const EXAM_LABELS = {
  NEET: 'NEET', JEE_MAIN: 'JEE', JEE_ADVANCED: 'JEE Adv',
  BOTH: 'NEET+JEE', CBSE: 'CBSE',
};

async function fetchLeaderboard(tab) {
  const view = tab === 'weekly' ? 'leaderboard_weekly' : 'leaderboard_alltime';
  const { data, error } = await supabase.from(view).select('*').limit(50);
  if (error) throw error;
  return data ?? [];
}

function MedalIcon({ rank }) {
  if (rank === 1) return <Crown size={16} className="text-amber-400" />;
  if (rank === 2) return <Trophy size={14} className="text-slate-400" />;
  if (rank === 3) return <Trophy size={14} className="text-amber-700" />;
  return <span className="text-xs font-bold text-slate-400 w-4 text-center">{rank}</span>;
}

function Avatar({ name, photoUrl, size = 36 }) {
  if (photoUrl) return <img src={photoUrl} alt={name} className="rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <div className="rounded-full bg-primary-700 flex items-center justify-center text-white font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.35 }}>
      {(name?.[0] || '?').toUpperCase()}
    </div>
  );
}

function TopThree({ entries, currentUid }) {
  const [first, second, third] = entries;
  if (!first) return null;

  const Card = ({ entry, height, crown }) => (
    <div className={`flex flex-col items-center gap-2 ${height}`}>
      <div className="relative">
        <Avatar name={entry.display_name} photoUrl={entry.photo_url} size={crown ? 52 : 44} />
        {crown && (
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <Crown size={18} className="text-amber-400" />
          </div>
        )}
        {entry.user_id === currentUid && (
          <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-primary-500 border-2 border-white" />
        )}
      </div>
      <p className="text-xs font-semibold text-slate-800 text-center max-w-[72px] truncate">
        {entry.user_id === currentUid ? 'You' : entry.display_name?.split(' ')[0] || 'Student'}
      </p>
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <Zap size={10} className="text-violet-500" />
        {entry.xp?.toLocaleString()}
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
        crown ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
      }`}>#{entry.rank}</span>
    </div>
  );

  return (
    <div className="flex items-end justify-center gap-6 py-4 px-2">
      {second && <Card entry={second} height="pt-6" crown={false} />}
      {first  && <Card entry={first}  height=""    crown={true} />}
      {third  && <Card entry={third}  height="pt-10" crown={false} />}
    </div>
  );
}

export default function LeaderboardPage() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('weekly');

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['leaderboard', tab],
    queryFn:  () => fetchLeaderboard(tab),
    staleTime: 60_000,
  });

  const top3    = entries.slice(0, 3);
  const rest    = entries.slice(3);
  const myRank  = entries.find(e => e.user_id === currentUser?.uid);

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Trophy size={20} className="text-amber-500" /> Leaderboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Top students by XP earned</p>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
        {[['weekly','This Week'],['alltime','All Time']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}>{label}</button>
        ))}
      </div>

      {/* Your rank pill */}
      {myRank && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="card bg-gradient-to-r from-primary-50 to-violet-50 border-primary-100 flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
            <Star size={16} className="text-primary-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">Your Rank</p>
            <p className="text-xs text-slate-500">{myRank.xp?.toLocaleString()} XP · {LEVEL_TITLES[Math.min(myRank.level || 1, 11)] || 'Scholar'}</p>
          </div>
          <span className="text-2xl font-extrabold text-primary-600">#{myRank.rank}</span>
        </motion.div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 rounded-2xl bg-slate-50 animate-pulse" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="card text-center py-12">
          <TrendingUp size={28} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-slate-500">No data yet for this period.</p>
          <p className="text-xs text-slate-400 mt-1">Complete practice sessions to earn XP and appear here.</p>
        </div>
      ) : (
        <>
          {/* Top 3 podium */}
          <div className="card">
            <TopThree entries={top3} currentUid={currentUser?.uid} />
          </div>

          {/* Ranked list (4th onwards) */}
          <div className="space-y-1.5">
            <AnimatePresence>
              {rest.map((entry, i) => {
                const isMe = entry.user_id === currentUser?.uid;
                return (
                  <motion.div key={entry.user_id}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.02 }}
                    className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${
                      isMe ? 'bg-primary-50 border-primary-200' : 'bg-white border-slate-100'
                    }`}
                  >
                    <div className="w-6 flex items-center justify-center shrink-0">
                      <MedalIcon rank={entry.rank} />
                    </div>
                    <Avatar name={entry.display_name} photoUrl={entry.photo_url} size={36} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-semibold truncate ${isMe ? 'text-primary-700' : 'text-slate-800'}`}>
                        {isMe ? 'You' : entry.display_name?.split(' ')[0] || 'Student'}
                      </p>
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="flex items-center gap-0.5"><Flame size={9} className="text-amber-500" />{entry.streak_days}d</span>
                        {entry.target_exam && <span>{EXAM_LABELS[entry.target_exam] || entry.target_exam}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${isMe ? 'text-primary-600' : 'text-slate-700'}`}>
                        {entry.xp?.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400">XP</p>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>

          {tab === 'weekly' && (
            <p className="text-center text-xs text-slate-400 pb-2">Resets every Monday at midnight IST</p>
          )}
        </>
      )}
    </div>
  );
}
