import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, Loader2, AlertTriangle, User, GraduationCap,
  BarChart3, Zap, MessageSquare, Calendar, Target,
  Building2, Trophy,
} from 'lucide-react';
import { supabase } from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const IST_DATE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

async function fetchStudentProfile(query) {
  const { data, error } = await supabase.rpc('admin_search_users', {
    p_caller: getCallerUid(), p_query: query.trim(), p_limit: 5,
  });
  if (error) throw error;
  return data ?? [];
}

async function fetchStudentDetail(uid) {
  const today = IST_DATE();
  const [
    { data: profile },
    { data: quota },
    { data: gamification },
    { data: sessions },
    { data: coachingRow },
  ] = await Promise.all([
    supabase.rpc('admin_get_user', { p_caller: getCallerUid(), p_uid: uid }),
    supabase.from('daily_usage_quota').select('*').eq('user_id', uid).eq('usage_date', today).maybeSingle(),
    supabase.from('user_gamification').select('*').eq('user_id', uid).maybeSingle(),
    supabase.from('test_sessions').select('id, score, total_marks, created_at').eq('firebase_uid', uid).order('created_at', { ascending: false }).limit(10),
    // was .from('coaching_students').eq('student_uid', uid) selecting
    // coaching_centres(centre_name, centre_brand_color) — neither the
    // filter column nor the selected columns exist on the live schema
    // (real columns: firebase_uid, name, brand_color), so this 400'd
    // silently every time and the coaching badge never rendered.
    supabase.rpc('student_get_own_centre', { p_uid: uid }),
  ]);

  const coaching = coachingRow?.[0]
    ? { coaching_centres: { centre_name: coachingRow[0].centre_name, centre_brand_color: coachingRow[0].brand_color } }
    : null;

  return { profile, quota, gamification, sessions: sessions ?? [], coaching };
}

function StatPill({ label, value, color = 'bg-slate-700 text-slate-300' }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${color}`}>
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-xs font-bold ml-auto">{value ?? '—'}</span>
    </div>
  );
}

function StudentCard({ detail }) {
  const { profile, quota, gamification, sessions, coaching } = detail;
  const pct = (used, limit) => limit > 0 ? Math.round((used / limit) * 100) : 0;

  return (
    <motion.div
      className="space-y-5"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      {/* Identity */}
      <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-5 flex items-start gap-4">
        {profile?.photo_url ? (
          <img src={profile.photo_url} alt="" className="h-14 w-14 rounded-2xl object-cover shrink-0" />
        ) : (
          <div className="h-14 w-14 rounded-2xl bg-primary-700 flex items-center justify-center shrink-0">
            <User size={22} className="text-white" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-bold text-white text-lg leading-snug">{profile?.display_name || '—'}</p>
          <p className="text-slate-400 text-sm">{profile?.email || '—'}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {profile?.target_exam && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-primary-900/50 text-primary-400 px-2 py-0.5 rounded-full border border-primary-700/30">
                <Target size={9} /> {profile.target_exam}
              </span>
            )}
            {coaching?.coaching_centres?.centre_name && (
              <span className="flex items-center gap-1 text-[10px] font-bold bg-violet-900/40 text-violet-400 px-2 py-0.5 rounded-full border border-violet-700/30">
                <Building2 size={9} /> {coaching.coaching_centres.centre_name}
              </span>
            )}
            {profile?.is_premium && (
              <span className="text-[10px] font-bold bg-amber-900/50 text-amber-400 px-2 py-0.5 rounded-full border border-amber-700/30">
                Premium
              </span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-[10px] text-slate-600 font-mono">{profile?.firebase_uid?.slice(0, 14)}…</p>
          <p className="text-[10px] text-slate-600 mt-0.5">
            Joined {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
          </p>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Today's Quota */}
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Zap size={12} className="text-amber-400" /> Today's Quota (IST)
          </p>
          <StatPill label="AI Questions" value={quota?.ai_questions_used ?? 0} color="bg-violet-900/30 text-violet-300" />
          <StatPill label="EWE Messages"  value={quota?.veda_messages_used ?? 0} color="bg-emerald-900/30 text-emerald-300" />
          <StatPill label="Mock Tests" value={quota?.mock_tests_used ?? 0} color="bg-blue-900/30 text-blue-300" />
        </div>

        {/* Gamification */}
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4 space-y-2">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5">
            <Trophy size={12} className="text-amber-400" /> Gamification
          </p>
          <StatPill label="XP" value={gamification?.xp ?? 0} color="bg-amber-900/30 text-amber-300" />
          <StatPill label="Level" value={gamification?.level ?? 1} color="bg-orange-900/30 text-orange-300" />
          <StatPill label="Streak" value={`${gamification?.streak_days ?? 0}d`} color="bg-rose-900/30 text-rose-300" />
        </div>
      </div>

      {/* Recent test sessions */}
      {sessions.length > 0 && (
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl p-4">
          <p className="text-xs font-bold text-slate-400 flex items-center gap-1.5 mb-3">
            <BarChart3 size={12} className="text-primary-400" /> Last {sessions.length} Test Sessions
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-slate-600 uppercase tracking-wider">
                  <th className="text-left pb-2 font-semibold">Date</th>
                  <th className="text-right pb-2 font-semibold">Score</th>
                  <th className="text-right pb-2 font-semibold">Total</th>
                  <th className="text-right pb-2 font-semibold">%</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => {
                  const p = s.total_marks > 0 ? Math.round((s.score / s.total_marks) * 100) : 0;
                  return (
                    <tr key={s.id} className="border-t border-white/5">
                      <td className="py-1.5 text-slate-400">
                        {new Date(s.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="py-1.5 text-right text-white font-bold">{s.score}</td>
                      <td className="py-1.5 text-right text-slate-500">{s.total_marks}</td>
                      <td className={`py-1.5 text-right font-bold ${p >= 75 ? 'text-emerald-400' : p >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {p}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </motion.div>
  );
}

export default function AdminStudentLookup() {
  const [query,   setQuery]   = useState('');
  const [results, setResults] = useState([]);
  const [detail,  setDetail]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setError(''); setResults([]); setDetail(null);
    try {
      const data = await fetchStudentProfile(query);
      setResults(data);
      if (data.length === 1) await loadDetail(data[0].firebase_uid);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (uid) => {
    setLoading(true); setError('');
    try {
      const d = await fetchStudentDetail(uid);
      setDetail(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Search size={22} className="text-primary-400" /> Student Lookup
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          View any student's profile, quota, gamification, and test history (read-only).
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 bg-slate-800/60 border border-white/10 rounded-xl px-3 py-2">
          <Search size={14} className="text-slate-500 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Email address, display name, or Firebase UID…"
            className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white text-sm font-bold transition-colors"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : 'Look Up'}
        </button>
      </form>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* Multiple results picker */}
      {results.length > 1 && !detail && (
        <div className="bg-slate-800/60 border border-white/5 rounded-2xl overflow-hidden">
          <p className="px-5 py-3 text-xs text-slate-500 border-b border-white/5">
            {results.length} students found — click to view details
          </p>
          {results.map((u) => (
            <button
              key={u.firebase_uid}
              onClick={() => loadDetail(u.firebase_uid)}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white/5 border-b border-white/5 last:border-0 text-left transition-colors"
            >
              <User size={14} className="text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white font-medium truncate">{u.display_name || '—'}</p>
                <p className="text-xs text-slate-500 truncate">{u.email} · {u.target_exam}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Student detail card */}
      <AnimatePresence>
        {detail && <StudentCard detail={detail} />}
      </AnimatePresence>

      {!loading && results.length === 0 && query && (
        <div className="text-center py-12 text-slate-500">
          <User size={32} className="mx-auto mb-3 text-slate-700" />
          <p className="text-sm">No students found for "{query}"</p>
        </div>
      )}
    </div>
  );
}
