import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Users, FileText, MessageSquare, BookOpen, TrendingUp,
  Building2, Zap, Crown, CheckCircle2, Circle, AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import {
  adminGetAllUsers, adminGetAllTestSessions,
  adminGetDoubtChats, adminGetPapers, adminGetKBCount,
  supabase,
} from '../lib/supabase';

const IST_DATE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function StatCard({ icon: Icon, label, value, color, sub, delay = 0 }) {
  return (
    <motion.div
      className="bg-slate-800 rounded-2xl p-5 border border-white/5"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className={`h-10 w-10 rounded-xl ${color} flex items-center justify-center mb-3`}>
        <Icon size={18} className="text-white" />
      </div>
      <p className="text-2xl font-bold text-white">{value ?? '—'}</p>
      <p className="text-slate-400 text-sm mt-0.5">{label}</p>
      {sub && <p className="text-slate-600 text-xs mt-1">{sub}</p>}
    </motion.div>
  );
}

export default function AdminOverview() {
  const [stats, setStats] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const today = IST_DATE();
    Promise.all([
      adminGetAllUsers(),
      adminGetAllTestSessions(),
      adminGetDoubtChats(),
      adminGetPapers(),
      adminGetKBCount(),
      supabase.from('coaching_centres').select('id', { count: 'exact' }),
      supabase.from('daily_usage_quota').select('user_id', { count: 'exact' }).eq('usage_date', today),
      supabase.from('subscriptions').select('user_id', { count: 'exact' }).eq('status', 'active'),
      supabase.from('published_tests').select('id', { count: 'exact' }),
      // "Papers Loaded" (question_papers) and "KB Chunks" (knowledge_base) are
      // legacy tables the current Content Intake pipeline doesn't primarily
      // write to anymore — real uploaded content lands in pyq_questions
      // (published PYQs, or KB_NOTE chunks pending review) and study_notes.
      // Query those too so "any content uploaded" reflects reality instead of
      // two tables that stay empty even with a full review queue.
      supabase.from('pyq_questions').select('id', { count: 'exact', head: true }).neq('question_type', 'KB_NOTE'),
      supabase.from('pyq_questions').select('id', { count: 'exact', head: true }).eq('question_type', 'KB_NOTE'),
      supabase.from('study_notes').select('id', { count: 'exact', head: true }),
    ]).then(([users, sessions, chats, papers, kbCount, centres, activeToday, premium, pubTests, realPyq, pendingNotes, studyNotes]) => {
      setStats({
        students:      users?.length       ?? 0,
        tests:         sessions?.length    ?? 0,
        chats:         chats?.length       ?? 0,
        papers:        papers?.length      ?? 0,
        kbChunks:      kbCount             ?? 0,
        centres:       centres.count       ?? 0,
        activeToday:   activeToday.count   ?? 0,
        premiumUsers:  premium.count       ?? 0,
        publishedTests: pubTests.count     ?? 0,
        realPyqCount:  realPyq.count       ?? 0,
        pendingNotes:  pendingNotes.count  ?? 0,
        studyNotes:    studyNotes.count    ?? 0,
      });
    });
  }, []);

  // Any real content anywhere in the pipeline — not just the two legacy
  // tables the stat cards above show.
  const anyContent = stats && (stats.papers > 0 || stats.kbChunks > 0 || stats.realPyqCount > 0 || stats.pendingNotes > 0 || stats.studyNotes > 0);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-slate-400 text-sm mt-1">Platform-wide stats at a glance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users}        label="Total Students"    value={stats?.students}     color="bg-primary-600"  delay={0}    />
        <StatCard icon={Crown}        label="Premium Users"     value={stats?.premiumUsers}  color="bg-amber-600"    delay={0.05}
          sub={stats ? `${Math.round((stats.premiumUsers / Math.max(stats.students, 1)) * 100)}% of total` : undefined} />
        <StatCard icon={Zap}          label="Active Today (IST)"value={stats?.activeToday}  color="bg-emerald-600"  delay={0.10} />
        <StatCard icon={Building2}    label="Coaching Centres"  value={stats?.centres}      color="bg-violet-600"   delay={0.15} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FileText}     label="Tests Taken"       value={stats?.tests}        color="bg-blue-600"     delay={0.20} />
        <StatCard icon={MessageSquare}label="EWE Chat Sessions" value={stats?.chats}        color="bg-rose-600"     delay={0.25} />
        <StatCard icon={BookOpen}     label="Papers Loaded"     value={stats?.papers}       color="bg-orange-600"   delay={0.30} />
        <StatCard icon={TrendingUp}   label="KB Chunks"         value={stats?.kbChunks}     color="bg-teal-600"     delay={0.35} />
      </div>

      {!stats && (
        <div className="flex items-center gap-3 text-slate-500 text-sm">
          <div className="h-4 w-4 border-2 border-slate-600 border-t-primary-500 rounded-full animate-spin" />
          Loading stats…
        </div>
      )}

      {/* Setup checklist */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-2xl p-5 border border-white/5">
          <p className="text-white font-semibold mb-4">Setup Checklist</p>
          <div className="space-y-2 text-sm">
            {[
              { label: 'Admin schema migrations applied',          done: true,                                   path: null },
              { label: 'Storage bucket "question-papers" created', done: false,                                  path: null, hint: 'Supabase Dashboard → Storage → New Bucket' },
              { label: 'First content uploaded or crawled',        done: anyContent,                            path: '/admin/content' },
              { label: 'Knowledge base populated',                 done: (stats?.kbChunks ?? 0) > 0 || (stats?.pendingNotes ?? 0) > 0 || (stats?.studyNotes ?? 0) > 0, path: '/admin/library' },
              { label: 'First student registered',                 done: (stats?.students ?? 0) > 0,            path: '/admin/students' },
              { label: 'First test published for students',        done: (stats?.publishedTests ?? 0) > 0,      path: '/admin/tests' },
              { label: 'First coaching centre onboarded',         done: (stats?.centres ?? 0) > 0,             path: '/admin/coaching' },
            ].map(({ label, done, path, hint }) => (
              <div
                key={label}
                onClick={() => path && navigate(path)}
                className={`flex items-center gap-2.5 py-1 rounded-lg transition-colors ${path ? 'cursor-pointer hover:bg-white/5 px-2 -mx-2 group' : ''}`}
              >
                {done
                  ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                  : <Circle       size={14} className="text-slate-600 shrink-0" />
                }
                <span className={`flex-1 ${done ? 'text-emerald-400' : 'text-slate-400'}`}>{label}</span>
                {hint && !done && <span className="text-[9px] text-slate-600 hidden sm:block truncate max-w-[120px]">{hint}</span>}
                {path && <ChevronRight size={11} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />}
              </div>
            ))}
          </div>
          <p className="text-slate-600 text-xs mt-4">
            Click a pending item to navigate directly to the relevant admin page.
          </p>
        </div>

        {/* Needs Attention */}
        <div className="bg-slate-800 rounded-2xl p-5 border border-white/5">
          <p className="text-white font-semibold mb-4">Needs Attention</p>
          {!stats ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm">
              <div className="h-3.5 w-3.5 border-2 border-slate-700 border-t-primary-500 rounded-full animate-spin" /> Loading…
            </div>
          ) : (() => {
            const warnings = [];
            if (!anyContent)
              warnings.push({ msg: 'No content uploaded yet — use Content Intake to upload PYQs or study notes', path: '/admin/content' });
            if (stats.pendingNotes > 0 && stats.kbChunks === 0 && stats.studyNotes === 0)
              warnings.push({ msg: `${stats.pendingNotes} item(s) waiting in the Content Review Queue`, path: '/admin/content?tab=review' });
            if (stats.publishedTests === 0 && anyContent)
              warnings.push({ msg: 'No tests published for students yet — generate a paper', path: '/admin/papergen' });
            if (stats.students > 20 && stats.premiumUsers === 0)
              warnings.push({ msg: `${stats.students} students registered but 0 premium conversions`, path: '/admin/subscriptions' });
            if (stats.activeToday === 0 && stats.students > 0)
              warnings.push({ msg: 'No students active today — check onboarding or send a push notification', path: '/admin/push' });
            if (warnings.length === 0)
              return <p className="text-emerald-400 text-sm flex items-center gap-2"><CheckCircle2 size={14} /> All systems look good!</p>;
            return (
              <div className="space-y-2">
                {warnings.map(({ msg, path }) => (
                  <button
                    key={msg}
                    onClick={() => navigate(path)}
                    className="w-full flex items-start gap-2.5 text-left px-3 py-2.5 rounded-xl bg-amber-900/20 border border-amber-700/20 hover:bg-amber-900/30 transition-colors group"
                  >
                    <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
                    <span className="text-xs text-amber-300/80 flex-1">{msg}</span>
                    <ChevronRight size={11} className="text-amber-600 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
