import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Network, ChevronRight, ChevronDown, FileQuestion, BookOpen,
  Loader2, AlertTriangle, Search, Info,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import TabRow from '../components/admin/TabRow';

const EXAM_TABS = [
  'CBSE', 'ICSE', 'State Board', 'Kerala State', 'NEET', 'JEE Main', 'JEE Advanced',
];

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// Board exam_type keys can appear as "CBSE", "CBSE Class 10", or (legacy) "CBSE" + a
// separate class_level column — group by the board's base name so all three collapse
// into one branch instead of scattering across near-duplicate top-level nodes. The
// class itself is tracked separately (see buildTree) rather than discarded here.
function baseExamType(examType) {
  if (!examType) return 'Unmapped';
  const combo = examType.match(/^(.+?)\s+Class\s+\d+$/);
  return combo ? combo[1] : examType;
}

function classFromExamType(examType, classLevel) {
  if (classLevel) return String(classLevel);
  const combo = examType?.match(/Class\s+(\d+)$/);
  return combo ? combo[1] : null;
}

const CLASS_SORT = (a, b) => {
  if (a === 'All') return -1;
  if (b === 'All') return 1;
  return Number(a) - Number(b);
};

function buildTree(syllabusRows, pyqRows, noteRows) {
  const tree = {};

  const ensureChapter = (exam, cls, subject, chapter) => {
    tree[exam] ??= { classes: {} };
    tree[exam].classes[cls] ??= { subjects: {} };
    tree[exam].classes[cls].subjects[subject] ??= { chapters: {} };
    tree[exam].classes[cls].subjects[subject].chapters[chapter] ??= { pyq: 0, notes: 0, inSyllabus: false };
    return tree[exam].classes[cls].subjects[subject].chapters[chapter];
  };

  // Syllabus rows carry their own real class_level — this is the source of truth
  // for the class dimension.
  syllabusRows.forEach((r) => {
    const exam = baseExamType(r.exam_type);
    const cls  = classFromExamType(r.exam_type, r.class_level) ?? 'All';
    ensureChapter(exam, cls, r.subject || 'Unmapped', r.chapter_name || 'Unmapped').inSyllabus = true;
  });

  // pyq_questions and study_notes don't carry their own class_level column, but
  // their exam_type is often already class-specific (e.g. "CBSE Class 8" — set
  // whenever the admin picked a class during upload) — that's authoritative and
  // should be used directly instead of guessing. Only fall back to "which class
  // already has a matching syllabus chapter" for genuinely class-ambiguous
  // exam_types (a bare "CBSE" or "NEET" with no class suffix at all).
  const applyContent = (rows, field) => {
    rows.forEach((r) => {
      const exam    = baseExamType(r.exam_type);
      const subject = r.subject || 'Unmapped';
      const chapter = r.chapter || 'Unmapped';

      const explicitClass = classFromExamType(r.exam_type, null);
      if (explicitClass) {
        ensureChapter(exam, explicitClass, subject, chapter)[field] += 1;
        return;
      }

      const examNode = tree[exam];
      const matchingClasses = examNode
        ? Object.keys(examNode.classes).filter((cls) => examNode.classes[cls].subjects[subject]?.chapters[chapter])
        : [];
      const targets = matchingClasses.length ? matchingClasses : ['All'];
      targets.forEach((cls) => { ensureChapter(exam, cls, subject, chapter)[field] += 1; });
    });
  };
  applyContent(pyqRows, 'pyq');
  applyContent(noteRows, 'notes');

  return tree;
}

function ChapterRow({ name, data, approximate }) {
  const empty = data.pyq === 0 && data.notes === 0;
  return (
    <div className={`flex items-center justify-between gap-3 pl-9 pr-3 py-2 rounded-lg ${empty ? 'bg-amber-950/20' : 'hover:bg-white/5'}`}>
      <div className="flex items-center gap-2 min-w-0">
        {!data.inSyllabus && (
          <span title="Not in Admin > Syllabus — content only" className="shrink-0">
            <AlertTriangle size={11} className="text-amber-500" />
          </span>
        )}
        <p className="text-sm text-slate-300 truncate">{name}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0 text-xs">
        <span className={`flex items-center gap-1 ${data.pyq === 0 ? 'text-slate-600' : 'text-primary-400'}`} title={approximate ? 'PYQ count not split by class in the data — shown for this chapter name across the board' : undefined}>
          <FileQuestion size={11} /> {data.pyq}
        </span>
        <span className={`flex items-center gap-1 ${data.notes === 0 ? 'text-slate-600' : 'text-emerald-400'}`} title={approximate ? 'Notes count not split by class in the data — shown for this chapter name across the board' : undefined}>
          <BookOpen size={11} /> {data.notes}
        </span>
      </div>
    </div>
  );
}

function SubjectBlock({ subject, data, search, approximate }) {
  const [open, setOpen] = useState(!!search);
  const chapters = Object.entries(data.chapters)
    .filter(([name]) => !search || name.toLowerCase().includes(search.toLowerCase()));
  if (search && chapters.length === 0) return null;

  const totalPyq   = chapters.reduce((s, [, c]) => s + c.pyq, 0);
  const totalNotes = chapters.reduce((s, [, c]) => s + c.notes, 0);
  const gaps       = chapters.filter(([, c]) => c.pyq === 0 && c.notes === 0).length;

  return (
    <div className="border border-white/5 rounded-xl overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 bg-slate-800/50 hover:bg-slate-800 transition-colors">
        <div className="flex items-center gap-2">
          {open ? <ChevronDown size={13} className="text-slate-500" /> : <ChevronRight size={13} className="text-slate-500" />}
          <p className="text-sm font-semibold text-white">{subject}</p>
          <span className="text-[10px] text-slate-500">{chapters.length} chapters</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          {gaps > 0 && <span className="text-amber-500 font-semibold">{gaps} gap{gaps !== 1 ? 's' : ''}</span>}
          <span className="text-primary-400">{totalPyq} PYQ</span>
          <span className="text-emerald-400">{totalNotes} notes</span>
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="py-1.5 space-y-0.5">
              {chapters.map(([name, data]) => <ChapterRow key={name} name={name} data={data} approximate={approximate} />)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function AdminContentMap() {
  const [examTab,  setExamTab]  = useState('NEET');
  const [classTab, setClassTab] = useState('All');
  const [search,   setSearch]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [tree,     setTree]     = useState({});

  useEffect(() => {
    (async () => {
      setLoading(true); setError('');
      try {
        const [syllabusRes, pyqRes, notesRes] = await Promise.all([
          supabase.from('syllabus_nodes').select('exam_type, class_level, subject, chapter_name').eq('is_active', true).limit(5000),
          supabase.from('pyq_questions').select('exam_type, subject, chapter').limit(5000),
          supabase.rpc('admin_list_study_notes', { p_caller: getCallerUid() }),
        ]);
        if (syllabusRes.error) throw syllabusRes.error;
        if (pyqRes.error) throw pyqRes.error;

        const noteRows = Array.isArray(notesRes.data) ? notesRes.data : [];
        setTree(buildTree(syllabusRes.data ?? [], pyqRes.data ?? [], noteRows));
      } catch (e) {
        setError(e.message || 'Failed to load content map');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const examKeys = useMemo(() => {
    const known = EXAM_TABS.filter((e) => tree[e]);
    const extra = Object.keys(tree).filter((e) => !EXAM_TABS.includes(e));
    return [...known, ...extra];
  }, [tree]);

  // examTab defaults to 'NEET' — if that exam has no data at all but something
  // else does (e.g. only CBSE has content), jump to the first exam that
  // actually has something instead of showing a stuck "no data for NEET"
  // empty state while the tab with real data sits unselected.
  useEffect(() => {
    if (examKeys.length && !examKeys.includes(examTab)) setExamTab(examKeys[0]);
  }, [examKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const classKeys = useMemo(() => {
    const keys = Object.keys(tree[examTab]?.classes ?? {});
    return keys.sort(CLASS_SORT);
  }, [tree, examTab]);

  // Reset class tab when exam changes and the previously-selected class doesn't exist here.
  useEffect(() => {
    if (classKeys.length && !classKeys.includes(classTab)) setClassTab(classKeys[0]);
  }, [classKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeSubjects = tree[examTab]?.classes?.[classTab]?.subjects ?? {};
  const multiClass = classKeys.length > 1;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3"><Network size={22} /> Content Map</h1>
          <p className="text-slate-400 text-sm mt-1">
            Syllabus coverage — board/class → subject → chapter, with how many PYQs and study notes exist for it.
            <span className="inline-flex items-center gap-1 ml-2 text-amber-500"><AlertTriangle size={11} /> = no content yet</span>
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 size={22} className="animate-spin text-primary-500" /></div>
      ) : error ? (
        <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>
      ) : (
        <>
          <TabRow
            layoutId="admin-content-map-exam-underline"
            items={examKeys.map((e) => ({ key: e, label: e }))}
            active={examTab}
            onChange={setExamTab}
          />

          {classKeys.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {classKeys.map((c) => (
                <button
                  key={c}
                  onClick={() => setClassTab(c)}
                  className={[
                    'px-3 py-1 rounded-lg text-[11px] font-semibold border transition-colors',
                    classTab === c ? 'bg-violet-600 border-violet-600 text-white' : 'border-white/10 text-slate-500 hover:bg-white/5',
                  ].join(' ')}
                >
                  {c === 'All' ? 'All classes' : `Class ${c}`}
                </button>
              ))}
            </div>
          )}

          {multiClass && (
            <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-white/5 rounded-xl px-3 py-2">
              <Info size={12} className="shrink-0 mt-0.5" />
              <p>Content uploaded with a specific class selected (e.g. "CBSE Class 8") is placed under that class directly. Content uploaded under a class-less exam type instead falls back to matching an existing syllabus chapter, or "All classes" if none exists yet.</p>
            </div>
          )}

          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chapters…"
              className="w-full pl-8 pr-3 py-2 text-sm rounded-xl bg-slate-900 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
            />
          </div>

          {Object.keys(activeSubjects).length === 0 ? (
            <div className="text-center py-16 text-slate-500 text-sm">
              No syllabus or content data found for {examTab}{classTab !== 'All' ? ` · Class ${classTab}` : ''}.
            </div>
          ) : (
            <div className="space-y-2">
              {Object.entries(activeSubjects).map(([subject, data]) => (
                <SubjectBlock key={subject} subject={subject} data={data} search={search} approximate={multiClass} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
