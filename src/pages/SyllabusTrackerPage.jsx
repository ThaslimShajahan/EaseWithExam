import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen, ArrowLeft, CheckCircle2, Circle, BookMarked,
  ChevronDown, ChevronRight, Star, BarChart2, RotateCcw, Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { createNotification } from '../lib/notifications';
import { getAllChapters } from '../lib/syllabus';
import { buildExamType } from '../lib/categories';
import {
  getChapterProgress, upsertChapter, initChapterProgress, computeProgress,
} from '../lib/syllabusTracker';
import RingChart from '../components/ui/RingChart';

const STATUS_META = {
  not_started: { label: 'Not Started', color: 'text-slate-400', bg: 'bg-slate-100', icon: Circle },
  reading:     { label: 'In Progress', color: 'text-amber-600', bg: 'bg-amber-100', icon: BookOpen },
  done:        { label: 'Done',        color: 'text-emerald-600', bg: 'bg-emerald-100', icon: CheckCircle2 },
  revision_due:{ label: 'Revise',      color: 'text-violet-600', bg: 'bg-violet-100', icon: RotateCcw },
};

const STATUS_CYCLE = ['not_started', 'reading', 'done'];

const SUBJECT_COLORS = {
  Biology:     { ring: '#7c3aed', bg: 'bg-violet-50',   text: 'text-violet-700',   bar: 'bg-violet-500' },
  Physics:     { ring: '#2563eb', bg: 'bg-blue-50',     text: 'text-blue-700',     bar: 'bg-blue-500' },
  Chemistry:   { ring: '#059669', bg: 'bg-emerald-50',  text: 'text-emerald-700',  bar: 'bg-emerald-500' },
  Mathematics: { ring: '#ea580c', bg: 'bg-orange-50',   text: 'text-orange-700',   bar: 'bg-orange-500' },
};


/* ── Subject summary card ──────────────────────────────────── */
function SubjectCard({ subject, chapters, progressMap, isActive, onClick }) {
  const col = SUBJECT_COLORS[subject] || SUBJECT_COLORS.Physics;
  const prog = computeProgress(chapters, progressMap);
  return (
    <button onClick={onClick}
      className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all w-full text-left ${
        isActive ? `border-primary-400 bg-primary-50 shadow-sm` : 'border-slate-100 bg-white hover:border-primary-200'
      }`}
    >
      <div className="relative shrink-0">
        <RingChart pct={prog.pct} color={isActive ? '#3b82f6' : col.ring} size={52} stroke={5} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-slate-700">
          {prog.pct}%
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold text-sm ${isActive ? 'text-primary-700' : 'text-slate-800'}`}>{subject}</p>
        <p className="text-xs text-slate-500 mt-0.5">{prog.done}/{prog.total} chapters done</p>
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1.5">
          <div className={`h-full rounded-full transition-all ${isActive ? 'bg-primary-500' : col.bar}`}
            style={{ width: `${prog.pct}%` }} />
        </div>
      </div>
      <ChevronDown size={14} className={`text-slate-400 transition-transform shrink-0 ${isActive ? 'rotate-180' : ''}`} />
    </button>
  );
}

/* ── Star confidence picker ─────────────────────────────────── */
function StarPicker({ value, onChange }) {
  return (
    <div className="flex gap-0.5">
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => onChange(n)} className="p-0.5">
          <Star size={12} className={n <= value ? 'text-amber-400 fill-amber-400' : 'text-slate-300'} />
        </button>
      ))}
    </div>
  );
}

/* ── Chapter row ───────────────────────────────────────────── */
function ChapterRow({ chapter, progress, onUpdate }) {
  const status = progress?.status || 'not_started';
  const confidence = progress?.confidence || 0;
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  const cycleStatus = () => {
    const idx = STATUS_CYCLE.indexOf(status);
    const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
    onUpdate(chapter, next, confidence);
  };

  return (
    <div className="flex items-center gap-3 py-2.5 px-3 rounded-xl hover:bg-slate-50 group transition-colors">
      <button onClick={cycleStatus}
        className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 transition-colors ${meta.bg} ${meta.color}`}>
        <Icon size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${status === 'done' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>
          {chapter.name}
        </p>
        {chapter.class_level && <span className="text-[10px] text-slate-400">Class {chapter.class_level}</span>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {status !== 'not_started' && (
          <StarPicker value={confidence} onChange={(v) => onUpdate(chapter, status, v)} />
        )}
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} hidden group-hover:inline-flex sm:inline-flex`}>
          {meta.label}
        </span>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function SyllabusTrackerPage() {
  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();

  // userProfile.target_exam is the raw onboarding enum (e.g. 'CLASS_10', 'JEE_MAIN') —
  // must be normalized to the key syllabus_nodes actually uses (e.g. 'CBSE Class 10').
  const examType = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);

  const [syllabus, setSyllabus] = useState({});
  const [subjects, setSubjects] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [activeSubject, setActiveSubject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(null);

  const uid = currentUser?.uid;

  const load = useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    try {
      const live = await getAllChapters(examType, userProfile?.class_level);
      const subs = Object.keys(live);
      setSyllabus(live);
      setSubjects(subs);
      setActiveSubject((prev) => (prev && subs.includes(prev) ? prev : subs[0]));

      // Init all chapters with not_started if not present
      const allChapters = subs.flatMap(s => live[s].map(c => ({ ...c, subject: s })));
      await initChapterProgress(uid, examType, allChapters).catch(() => {});

      const rows = await getChapterProgress(uid, examType);
      const map = {};
      rows.forEach(r => { map[r.chapter_key] = r; });
      setProgressMap(map);
    } catch (e) { setLoadError(e.message || 'Failed to load syllabus progress.'); }
    finally { setLoading(false); }
  }, [uid, examType]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const SYLLABUS_MILESTONES = new Set([25, 50, 75, 100]);

  const handleUpdate = async (chapter, status, confidence) => {
    setSaving(chapter.key);
    const prevMap = progressMap;
    // Optimistic update
    setProgressMap(prev => ({
      ...prev,
      [chapter.key]: { ...prev[chapter.key], status, confidence },
    }));
    try {
      await upsertChapter(uid, examType, chapter, status, confidence);
      // Check for syllabus milestones only when marking a chapter done
      if (status === 'done' && uid && totalChaps > 0) {
        const prevDone = Object.values(prevMap).filter(p => p.status === 'done').length;
        const newDone  = prevDone + (prevMap[chapter.key]?.status === 'done' ? 0 : 1);
        const prevPct  = Math.round((prevDone / totalChaps) * 100);
        const newPct   = Math.round((newDone  / totalChaps) * 100);
        for (const milestone of SYLLABUS_MILESTONES) {
          if (prevPct < milestone && newPct >= milestone) {
            createNotification(
              uid,
              'syllabus_milestone',
              `${milestone}% of ${examType} syllabus complete! 🎯`,
              `You've covered ${newDone} out of ${totalChaps} chapters. Keep the momentum!`,
              '/syllabus',
            ).catch(() => {});
            break;
          }
        }
      }
    } catch (e) {
      console.error(e);
      // Revert on error
      setProgressMap(prev => {
        const revert = { ...prev };
        delete revert[chapter.key];
        return revert;
      });
    } finally {
      setSaving(null);
    }
  };

  // Overall stats
  const allChapters = subjects.flatMap(s => syllabus[s].map(c => ({ ...c, subject: s })));
  const totalDone = Object.values(progressMap).filter(p => p.status === 'done').length;
  const totalChaps = allChapters.length;
  const overallPct = totalChaps > 0 ? Math.round((totalDone / totalChaps) * 100) : 0;

  const activeChs = (syllabus[activeSubject] || []).map(c => ({ ...c, subject: activeSubject }));

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/dashboard')}
          className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart2 size={20} className="text-primary-500" /> Syllabus Tracker
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{examType} · {totalChaps} chapters</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-primary-600">{overallPct}%</p>
          <p className="text-[10px] text-slate-400">Overall</p>
        </div>
      </div>

      {/* Overall bar */}
      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-700">Overall Progress</span>
          <span className="text-xs text-slate-500">{totalDone} / {totalChaps} done</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full"
            initial={{ width: 0 }} animate={{ width: `${overallPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
          {Object.entries(STATUS_META).slice(0, 3).map(([k, v]) => {
            const Icon = v.icon;
            const count = Object.values(progressMap).filter(p => p.status === k).length;
            return (
              <div key={k} className="flex items-center gap-1">
                <Icon size={11} className={v.color} /> {count} {v.label}
              </div>
            );
          })}
        </div>
      </div>

      {loadError ? (
        <div className="rounded-card bg-danger-light border border-danger/20 p-5 text-center">
          <p className="text-sm font-semibold text-danger">Failed to load progress</p>
          <p className="text-xs text-slate-500 mt-1">{loadError}</p>
          <button onClick={load} className="mt-3 text-xs font-semibold text-primary-600 hover:underline">Try again</button>
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-50 rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <>
          {/* Subject cards */}
          <div className="space-y-2">
            {subjects.map(sub => (
              <div key={sub}>
                <SubjectCard
                  subject={sub}
                  chapters={(syllabus[sub] || []).map(c => ({ ...c, subject: sub }))}
                  progressMap={progressMap}
                  isActive={activeSubject === sub}
                  onClick={() => setActiveSubject(activeSubject === sub ? null : sub)}
                />

                <AnimatePresence>
                  {activeSubject === sub && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-1 ml-2 pl-3 border-l-2 border-slate-100 space-y-0.5 py-2">
                        {activeChs.map(ch => (
                          <ChapterRow
                            key={ch.key}
                            chapter={ch}
                            progress={progressMap[ch.key]}
                            onUpdate={handleUpdate}
                          />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="card bg-slate-50 border-slate-100">
            <p className="text-xs font-semibold text-slate-600 mb-2">How to use</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              Tap the icon next to any chapter to cycle through <strong>Not Started → In Progress → Done</strong>.
              Rate your confidence with the stars. Topics marked "Done" help the AI generate targeted revision questions.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
