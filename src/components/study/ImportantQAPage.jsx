import { useEffect, useState } from 'react';
import { Star, Sparkles, Calendar, ChevronRight, ChevronLeft, ChevronDown, Loader2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { buildExamType, getSchoolExamType } from '../../lib/categories';
import { useStudentSubjects } from '../../hooks/useStudentSubjects';
import SubjectSetupPrompt from '../ui/SubjectSetupPrompt';
import { getStudyChapters } from '../../lib/syllabus';
import { getCachedImportantQA, generateImportantQA } from '../../lib/questionGen';
import { checkQuota, incrementQuota } from '../../lib/quota';
import HubPageHeader from '../ui/HubPageHeader';
import PaywallModal from '../ui/PaywallModal';
import MathText from '../ui/MathText';

function QACard({ item }) {
  const [open, setOpen] = useState(false);
  const isPYQ = item.asked_years?.length > 0;

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden ${open ? 'border-primary-200' : 'border-slate-100'}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-4 hover:bg-slate-50 transition-colors">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-900 text-sm leading-snug"><MathText text={item.question} /></p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {isPYQ ? (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                  <Calendar size={9} /> Asked in {item.asked_years.join(', ')}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  <Sparkles size={9} /> High-Yield Concept
                </span>
              )}
              {item.marks != null && (
                <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {item.marks} mark{item.marks !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
          <ChevronRight size={16} className={`text-slate-300 shrink-0 mt-1 transition-transform ${open ? 'rotate-90' : ''}`} />
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100">
          <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line"><MathText text={item.answer} /></p>
        </div>
      )}
    </div>
  );
}

function ChapterRow({ name, onSelect }) {
  return (
    <button
      onClick={() => onSelect(name)}
      className="w-full flex items-center justify-between gap-3 p-4 bg-white rounded-2xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50/30 transition-colors text-left"
    >
      <span className="font-semibold text-slate-900 text-sm">{name}</span>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </button>
  );
}

/**
 * Chapters come from getStudyChapters() — merges Admin > Syllabus with
 * whatever's actually been uploaded to Study Notes/PYQs, since school boards
 * are often ahead of syllabus_nodes. Grouped by unit (mirrors NotesBrowser's
 * UnitGroup) when unit info exists; NEET/JEE (no unit tagging) render as a
 * single flat list instead.
 */
function ChapterList({ examType, subject, classLevel, onSelect }) {
  const [groups,   setGroups]   = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [openUnit, setOpenUnit] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!examType || !subject) { setGroups([]); setLoading(false); return undefined; }
    setLoading(true);
    getStudyChapters(examType, subject, classLevel).then((data) => {
      if (cancelled) return;
      setGroups(data);
      setOpenUnit(data[0]?.unit ?? null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [examType, subject, classLevel]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={24} className="animate-spin text-primary-500" />
      </div>
    );
  }
  if (!groups.length) {
    return <p className="text-sm text-slate-500 text-center py-10">No chapters found for this subject yet.</p>;
  }

  const allFlat = groups.length === 1 && groups[0].unit === null;
  if (allFlat) {
    return (
      <div className="space-y-2">
        {groups[0].chapters.map((name) => <ChapterRow key={name} name={name} onSelect={onSelect} />)}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map(({ unit, chapters }) => (
        <div key={unit ?? '__none__'} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <button
            onClick={() => setOpenUnit((u) => (u === unit ? null : unit))}
            className="w-full flex items-center justify-between gap-3 p-4 hover:bg-slate-50 transition-colors"
          >
            <span className="font-bold text-slate-900 text-sm truncate">{unit ?? 'Other Chapters'}</span>
            <ChevronDown size={15} className={`text-slate-400 shrink-0 transition-transform ${openUnit === unit ? 'rotate-180' : ''}`} />
          </button>
          {openUnit === unit && (
            <div className="p-3 pt-0 space-y-2">
              {chapters.map((name) => <ChapterRow key={name} name={name} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * "Important Q&A" content is IDENTICAL for every student in the same
 * exam_type+subject+chapter (see getCachedImportantQA/generateImportantQA in
 * lib/questionGen.js) — so only the first student to open a given chapter
 * triggers an AI generation + burns quota; everyone after gets it instantly
 * from the important_qa cache, free.
 */
export default function ImportantQAPage() {
  const { currentUser, userProfile, isPremium, subscription } = useAuth();
  // School context — chapter-level Q&A is board/class content, so a Class 12
  // NEET student should still get their board chapters here rather than 'NEET'.
  const examType   = getSchoolExamType(userProfile)
    ?? buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const classLevel = userProfile?.class_level;
  // Scoped to the student's OWN subjects, not the board catalogue — this screen
  // is where the leak was reported (a Class 12 Science student offered
  // Accountancy, Psychology, Political Science).
  const { subjects, needsSetup } = useStudentSubjects(examType, classLevel);

  const [subject,     setSubject]     = useState(null);
  const [chapter,     setChapter]     = useState(null);
  const [items,       setItems]       = useState(null);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState('');
  const [showPaywall, setShowPaywall] = useState(false);

  const activeSubject = subject || subjects[0] || null;

  const openChapter = async (chapterName) => {
    setChapter(chapterName);
    setItems(null);
    setError('');
    setLoading(true);
    try {
      const cached = await getCachedImportantQA({ subject: activeSubject, chapter: chapterName, examType });
      if (cached) { setItems(cached.questions); setLoading(false); return; }

      // Only a genuine cache miss reaches the quota gate + AI call.
      const quota = await checkQuota(currentUser?.uid, 'ai_questions_used', isPremium, subscription?.plan, 1);
      if (!quota.allowed) { setShowPaywall(true); setLoading(false); setChapter(null); return; }

      const generated = await generateImportantQA({ subject: activeSubject, chapter: chapterName, examType });
      incrementQuota(currentUser?.uid, 'ai_questions_used').catch(() => {});
      setItems(generated.questions);
    } catch (e) {
      setError(e.message || 'Could not load important questions. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!examType) {
    return (
      <div className="card p-10 text-center">
        <p className="font-bold text-slate-900">Complete your profile first</p>
        <p className="text-sm text-slate-500 mt-1">We need your board/class or target exam to know which chapters to show.</p>
      </div>
    );
  }

  // 11-12 with no stream selection. Shown INSTEAD of the picker, never above an
  // unscoped catalogue — see SubjectSetupPrompt for why.
  if (needsSetup) return <SubjectSetupPrompt toolName="Important Q&A" />;

  return (
    <div className="space-y-5">
      {showPaywall && (
        <PaywallModal
          onClose={() => setShowPaywall(false)}
          feature="Important Questions & Answers"
          firebaseUid={currentUser?.uid}
          email={currentUser?.email}
          name={userProfile?.display_name || currentUser?.displayName}
          onSuccess={() => setShowPaywall(false)}
        />
      )}

      <HubPageHeader
        icon={Star}
        title="Important Questions & Answers"
        subtitle={chapter || 'Pick a chapter to see its must-know Q&A, grounded in real past-year questions'}
        showBack={false}
      />

      {chapter && (
        <button
          onClick={() => { setChapter(null); setItems(null); setError(''); }}
          className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700"
        >
          <ChevronLeft size={14} /> Back to chapters
        </button>
      )}

      {!chapter && (
        <>
          {subjects.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {subjects.map((s) => (
                <button
                  key={s}
                  onClick={() => setSubject(s)}
                  className={[
                    'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
                    activeSubject === s
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300',
                  ].join(' ')}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <ChapterList examType={examType} subject={activeSubject} classLevel={classLevel} onSelect={openChapter} />
        </>
      )}

      {chapter && (
        loading ? (
          <div className="flex flex-col items-center gap-3 py-16">
            <Loader2 size={28} className="animate-spin text-primary-500" />
            <p className="text-sm text-slate-500">Finding the most important questions for this chapter…</p>
          </div>
        ) : error ? (
          <p className="text-sm text-red-500 text-center py-8">{error}</p>
        ) : (
          <div className="space-y-2">
            {items?.map((item, i) => <QACard key={i} item={item} />)}
          </div>
        )
      )}
    </div>
  );
}
