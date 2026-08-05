import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Users, FileText, MessageSquare, BookOpen, TrendingUp,
  Building2, Zap, Crown, CheckCircle2, Circle, AlertTriangle,
  ChevronRight, Wand2, Inbox, Library, ClipboardList,
  CreditCard, BookMarked, Send, Settings, Sparkles,
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
      className="bg-slate-800 rounded-2xl p-4 border border-white/5"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`h-7 w-7 rounded-lg ${color} flex items-center justify-center shrink-0`}>
          <Icon size={13} className="text-white" />
        </div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      </div>
      <p className="text-xl font-bold text-white leading-none">{value ?? '—'}</p>
      {sub && <p className="text-slate-600 text-[11px] mt-1.5">{sub}</p>}
    </motion.div>
  );
}

/* Quick-action launcher tile — shortcuts to the most common admin tasks,
 * distinct from the full sidebar nav (every hub/tab lives there already;
 * this is just the handful an admin reaches for daily). */
function ActionTile({ icon: Icon, iconColor, title, desc, onClick, delay = 0 }) {
  return (
    <motion.button
      onClick={onClick}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
      className="text-left bg-slate-800 hover:bg-slate-750 border border-white/5 hover:border-white/10 rounded-2xl p-4 transition-colors group"
    >
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center mb-3 ${iconColor}`}>
        <Icon size={16} className="text-white" />
      </div>
      <p className="text-sm font-bold text-white flex items-center gap-1">
        {title}
        <ChevronRight size={12} className="text-slate-600 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
      </p>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed">{desc}</p>
    </motion.button>
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
      supabase.storage.listBuckets(),
    ]).then(([users, sessions, chats, papers, kbCount, centres, activeToday, premium, pubTests, realPyq, pendingNotes, studyNotes, buckets]) => {
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
        bucketExists:  (buckets.data ?? []).some((b) => b.name === 'question-papers'),
      });
    });
  }, []);

  // Any real content anywhere in the pipeline — not just the two legacy
  // tables the stat cards above show.
  const anyContent = stats && (stats.papers > 0 || stats.kbChunks > 0 || stats.realPyqCount > 0 || stats.pendingNotes > 0 || stats.studyNotes > 0);

  const ACTION_TILES = [
    { icon: Inbox,        iconColor: 'bg-violet-600',  title: 'Content Intake',    desc: 'Upload PYQs or study material — AI reads, tags, and saves it.',   path: '/admin/content?tab=intake' },
    { icon: Library,      iconColor: 'bg-blue-600',    title: 'Content Library',   desc: 'Browse and manage everything already uploaded.',                   path: '/admin/content?tab=library' },
    { icon: ClipboardList,iconColor: 'bg-emerald-600', title: 'Published Tests',   desc: 'See what students can currently attempt.',                         path: '/admin/publish?tab=tests' },
    { icon: Users,        iconColor: 'bg-primary-600', title: 'Students',         desc: 'Roster, profiles, and per-student quota/progress.',                path: '/admin/students' },
    { icon: CreditCard,   iconColor: 'bg-amber-600',   title: 'Subscriptions',     desc: 'Plans, revenue, and upgrade/downgrade a student.',                 path: '/admin/students?tab=subscriptions' },
    { icon: BookMarked,   iconColor: 'bg-rose-600',    title: 'Study Notes',       desc: 'Review drafts and publish notes to students.',                     path: '/admin/content?tab=notes' },
    { icon: Send,         iconColor: 'bg-teal-600',    title: 'Push Notifications',desc: 'Message students in-app.',                                         path: '/admin/students?tab=push' },
    { icon: Settings,     iconColor: 'bg-slate-600',   title: 'Platform Settings', desc: 'Feature flags, pricing, quota limits.',                            path: '/admin/platform' },
  ];

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Overview</h1>
        <p className="text-slate-400 text-sm mt-1">Platform-wide stats at a glance</p>
      </div>

      {/* Hero — primary daily action */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-600 via-violet-700 to-violet-900 p-6"
      >
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex-1">
            <p className="flex items-center gap-1.5 text-primary-200 text-xs font-bold uppercase tracking-wide">
              <Sparkles size={12} /> AI Paper Generation
            </p>
            <h2 className="text-white text-xl font-bold mt-1.5">Generate a paper with AI</h2>
            <p className="text-primary-200 text-sm mt-1 max-w-md">
              Pick an exam, subject, and difficulty — AI builds a full paper from your uploaded PYQs in seconds.
            </p>
          </div>
          <button
            onClick={() => navigate('/admin/publish?tab=papergen')}
            className="shrink-0 flex items-center gap-2 bg-white text-primary-700 hover:bg-primary-50 font-bold text-sm px-5 py-3 rounded-xl transition-colors shadow-lg"
          >
            <Wand2 size={15} /> Generate Paper
          </button>
        </div>
        {/* Decorative — quiet, no distracting motion */}
        <div className="absolute -right-6 -bottom-10 h-40 w-40 rounded-full bg-white/5" />
        <div className="absolute right-16 -top-8 h-24 w-24 rounded-full bg-white/5" />
      </motion.div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {ACTION_TILES.map((t, i) => (
          <ActionTile key={t.title} {...t} onClick={() => navigate(t.path)} delay={i * 0.03} />
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={Users}        label="Total Students"    value={stats?.students}     color="bg-primary-600"  delay={0}    />
        <StatCard icon={Crown}        label="Premium Users"     value={stats?.premiumUsers}  color="bg-amber-600"    delay={0.05}
          sub={stats ? `${Math.round((stats.premiumUsers / Math.max(stats.students, 1)) * 100)}% of total` : undefined} />
        <StatCard icon={Zap}          label="Active Today (IST)"value={stats?.activeToday}  color="bg-emerald-600"  delay={0.10} />
        <StatCard icon={Building2}    label="Coaching Centres"  value={stats?.centres}      color="bg-violet-600"   delay={0.15} />
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
              { label: 'Storage bucket "question-papers" created', done: !!stats?.bucketExists,                  path: null, hint: 'Supabase Dashboard → Storage → New Bucket' },
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
