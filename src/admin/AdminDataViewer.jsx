import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Database, BookOpen, FileText, Users, BarChart3, RefreshCw, Loader2 } from 'lucide-react';
import {
  getKBStats,
  getPublishedTests,
  getPublishedTestsCount,
  adminGetPapers,
  adminGetAllUsers,
  adminGetTestSessionsStats,
} from '../lib/supabase';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function SectionCard({ icon, title, children, loading }) {
  return (
    <motion.div
      className="bg-slate-800 rounded-2xl border border-white/10 overflow-hidden"
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
        <span className="text-primary-400">{icon}</span>
        <h3 className="font-bold text-white text-sm">{title}</h3>
        {loading && <Loader2 size={13} className="text-slate-500 animate-spin ml-auto" />}
      </div>
      <div className="p-5">
        {children}
      </div>
    </motion.div>
  );
}

function StatPill({ label, value, color = 'text-white' }) {
  return (
    <div className="bg-slate-900/60 rounded-xl px-4 py-3 text-center border border-white/5">
      <p className={`text-xl font-extrabold ${color}`}>{value ?? '—'}</p>
      <p className="text-slate-400 text-[10px] mt-0.5">{label}</p>
    </div>
  );
}

/* ── Bar chart using divs ────────────────────────────────── */
function BarChart({ data, maxVal }) {
  const max = maxVal || Math.max(...Object.values(data), 1);
  return (
    <div className="space-y-2">
      {Object.entries(data).map(([label, count]) => (
        <div key={label} className="flex items-center gap-3">
          <span className="text-slate-400 text-[10px] w-20 shrink-0 truncate">{label}</span>
          <div className="flex-1 h-4 bg-slate-900/60 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500 rounded-full transition-all duration-700"
              style={{ width: `${(count / max) * 100}%` }}
            />
          </div>
          <span className="text-slate-300 text-[10px] w-6 text-right shrink-0">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminDataViewer() {
  const [loading,   setLoading]   = useState(true);
  const [kbStats,   setKBStats]   = useState(null);
  const [papers,    setPapers]    = useState([]);
  const [pubTests,  setPubTests]  = useState([]);
  const [sessions,  setSessions]  = useState([]);
  const [users,     setUsers]     = useState([]);
  const [error,     setError]     = useState('');

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [kb, pap, pub, sess, usr] = await Promise.all([
        getKBStats(),
        adminGetPapers(),
        getPublishedTests(),
        adminGetTestSessionsStats(),
        adminGetAllUsers(getCallerUid()),
      ]);
      setKBStats(kb);
      setPapers(pap);
      setPubTests(pub);
      setSessions(sess);
      setUsers(usr);
    } catch (e) {
      setError(e.message || 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  /* Derived session stats */
  const avgScore = sessions.length
    ? Math.round(sessions.reduce((acc, s) => acc + (s.total_marks ? (s.score / s.total_marks) * 100 : 0), 0) / sessions.length)
    : null;

  const sessionsByUser = {};
  sessions.forEach((s) => {
    sessionsByUser[s.firebase_uid] = (sessionsByUser[s.firebase_uid] || 0) + 1;
  });
  const topUserCount = Math.max(...Object.values(sessionsByUser), 1);

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Database size={22} className="text-primary-400" /> Data Overview
          </h1>
          <p className="text-slate-400 text-sm mt-0.5">Live snapshot of all platform data</p>
        </div>
        <button
          onClick={loadAll}
          disabled={loading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-xl px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatPill label="KB Chunks"      value={kbStats?.total}     color="text-primary-300" />
        <StatPill label="Published Tests" value={pubTests.length}    color="text-violet-300"  />
        <StatPill label="Test Sessions"   value={sessions.length}    color="text-emerald-300" />
        <StatPill label="Users"           value={users.length}       color="text-amber-300"   />
      </div>

      {/* 1. Knowledge Base */}
      <SectionCard icon={<BookOpen size={16} />} title="Knowledge Base" loading={loading}>
        {kbStats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-900/60 rounded-xl p-3 border border-white/5">
                <p className="text-2xl font-extrabold text-primary-300">{kbStats.total}</p>
                <p className="text-slate-400 text-xs">Total chunks</p>
              </div>
              <div className="bg-slate-900/60 rounded-xl p-3 border border-white/5">
                <p className="text-2xl font-extrabold text-slate-300">{Object.keys(kbStats.bySubject).length}</p>
                <p className="text-slate-400 text-xs">Subjects covered</p>
              </div>
            </div>
            {Object.keys(kbStats.bySubject).length > 0 && (
              <div>
                <p className="text-slate-500 text-[10px] uppercase font-bold mb-3">Chunks by subject</p>
                <BarChart data={kbStats.bySubject} />
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-500 text-sm">No data</p>
        )}
      </SectionCard>

      {/* 2. Uploaded Papers */}
      <SectionCard icon={<FileText size={16} />} title={`Uploaded Papers (${papers.length})`} loading={loading}>
        {papers.length === 0 ? (
          <p className="text-slate-500 text-sm">No papers crawled yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
            {papers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 bg-slate-900/40 rounded-xl px-4 py-2.5 border border-white/5">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{p.title || p.filename || 'Untitled'}</p>
                  <p className="text-slate-500 text-[10px]">{p.subject || '—'} · {formatDate(p.created_at)}</p>
                </div>
                {p.chunk_count !== undefined && (
                  <span className="text-[10px] text-primary-400 font-bold shrink-0">{p.chunk_count} chunks</span>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 3. Published Tests */}
      <SectionCard icon={<Database size={16} />} title={`Published Tests (${pubTests.length})`} loading={loading}>
        {pubTests.length === 0 ? (
          <p className="text-slate-500 text-sm">No tests published yet.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
            {pubTests.map((t) => (
              <div key={t.id} className="flex items-center gap-3 bg-slate-900/40 rounded-xl px-4 py-2.5 border border-white/5">
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{t.title}</p>
                  <p className="text-slate-500 text-[10px]">{t.exam_type} · {t.subject} · {formatDate(t.created_at)}</p>
                </div>
                <span className="text-[10px] text-slate-400 shrink-0">{t.duration_minutes}min</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 4. Test Sessions */}
      <SectionCard icon={<BarChart3 size={16} />} title="Test Sessions" loading={loading}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <StatPill label="Total sessions" value={sessions.length}  color="text-emerald-300" />
            <StatPill label="Avg score %"    value={avgScore !== null ? `${avgScore}%` : '—'} color="text-amber-300" />
          </div>

          {/* Sessions per user bar chart */}
          {Object.keys(sessionsByUser).length > 0 && (
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-3">Sessions per user (top 10)</p>
              <BarChart
                data={Object.fromEntries(
                  Object.entries(sessionsByUser)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([uid, cnt]) => [`…${uid.slice(-6)}`, cnt])
                )}
                maxVal={topUserCount}
              />
            </div>
          )}

          {/* Recent sessions list */}
          {sessions.length > 0 && (
            <div>
              <p className="text-slate-500 text-[10px] uppercase font-bold mb-2">Recent sessions</p>
              <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-hide">
                {sessions.slice(0, 20).map((s, i) => (
                  <div key={i} className="flex items-center gap-3 bg-slate-900/40 rounded-xl px-3 py-2 border border-white/5">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-[10px] font-semibold truncate">{s.test_name || 'Untitled'}</p>
                      <p className="text-slate-500 text-[9px]">…{(s.firebase_uid || '').slice(-6)} · {formatDate(s.created_at)}</p>
                    </div>
                    <span className="text-[10px] font-bold text-emerald-400 shrink-0">
                      {s.score}/{s.total_marks}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* 5. Users */}
      <SectionCard icon={<Users size={16} />} title={`Users (${users.length})`} loading={loading}>
        {users.length === 0 ? (
          <p className="text-slate-500 text-sm">No users found.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-hide">
            {users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 bg-slate-900/40 rounded-xl px-4 py-2.5 border border-white/5">
                {u.photo_url ? (
                  <img src={u.photo_url} alt={u.display_name} className="h-7 w-7 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-primary-700 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {(u.display_name || u.email || 'U')[0].toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-xs font-semibold truncate">{u.display_name || '—'}</p>
                  <p className="text-slate-500 text-[10px] truncate">{u.email}</p>
                </div>
                <span className="text-[10px] text-slate-500 shrink-0">{formatDate(u.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
