import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers, ArrowLeft, RefreshCw, CheckCircle2, XCircle,
  Zap, BookOpen, RotateCcw, Loader2, Search, ChevronDown, Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getAllChapters } from '../lib/syllabus';
import { buildExamType } from '../lib/categories';
import { generateFlashcards, getFlashcards, getFlashcardSummary, markFlashcard } from '../lib/flashcards';
import { checkQuota, incrementQuota } from '../lib/quota';
import { createNotification } from '../lib/notifications';
import RingChart from '../components/ui/RingChart';
import PaywallModal from '../components/ui/PaywallModal';

// generateFlashcards() always produces a fixed-size batch (see FLASHCARDS_PER_CHAPTER
// in lib/flashcards.js) — checkQuota needs to know this upfront to block BEFORE a
// generation would push usage over the limit, not just after.
const FLASHCARDS_PER_BATCH = 12;

const SUBJECT_COLORS = {
  Biology:     { chip: 'bg-violet-100 text-violet-700 border-violet-200',   ring: '#7c3aed' },
  Physics:     { chip: 'bg-blue-100 text-blue-700 border-blue-200',        ring: '#2563eb' },
  Chemistry:   { chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', ring: '#059669' },
  Mathematics: { chip: 'bg-orange-100 text-orange-700 border-orange-200',   ring: '#ea580c' },
};
const FALLBACK_COLOR = { chip: 'bg-slate-100 text-slate-600 border-slate-200', ring: '#64748b' };
const colorsFor = (subject) => SUBJECT_COLORS[subject] || FALLBACK_COLOR;

/* ── Flip card — real 3D flip with a peek of the next card behind it ── */
function FlipCard({ card, onKnow, onDontKnow, index, total }) {
  const [flipped, setFlipped] = useState(false);
  const hasNext = index + 1 < total;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-slate-400">
        <span className="font-medium">{index + 1} / {total}</span>
        <span className={`font-semibold px-2 py-0.5 rounded-full border ${colorsFor(card.subject).chip}`}>
          {card.subject}
        </span>
      </div>

      <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${((index + 1) / total) * 100}%` }} />
      </div>

      <div className="relative" style={{ perspective: 1200 }}>
        {hasNext && (
          <div className="absolute inset-x-3 -bottom-2 h-full rounded-2xl bg-slate-100 border border-slate-200" aria-hidden />
        )}
        <motion.div
          key={card.id}
          className="relative min-h-[240px] cursor-pointer select-none"
          style={{ transformStyle: 'preserve-3d' }}
          animate={{ rotateY: flipped ? 180 : 0 }}
          transition={{ duration: 0.45, ease: [0.34, 1.4, 0.64, 1] }}
          onClick={() => setFlipped((f) => !f)}
        >
          {/* Front — question */}
          <div
            className="absolute inset-0 rounded-2xl border-2 border-slate-200 bg-white shadow-sm flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-slate-400 bg-slate-100">
              Question — tap to reveal
            </div>
            <p className="leading-relaxed font-medium text-slate-800 text-base">{card.front}</p>
          </div>

          {/* Back — answer */}
          <div
            className="absolute inset-0 rounded-2xl border-2 border-primary-200 bg-primary-50 flex flex-col items-center justify-center p-6 text-center gap-3"
            style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          >
            <div className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full text-primary-500 bg-primary-100">
              Answer
            </div>
            <p className="leading-relaxed font-medium text-primary-900 text-sm">{card.back}</p>
          </div>
        </motion.div>
      </div>

      <AnimatePresence>
        {flipped && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="grid grid-cols-2 gap-3"
          >
            <button onClick={() => { setFlipped(false); onDontKnow(card.id); }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-red-50 border border-red-200 text-red-700 font-semibold text-sm hover:bg-red-100 transition-colors">
              <XCircle size={16} /> Again
            </button>
            <button onClick={() => { setFlipped(false); onKnow(card.id); }}
              className="flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold text-sm hover:bg-emerald-100 transition-colors">
              <CheckCircle2 size={16} /> Got it
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {!flipped && (
        <p className="text-center text-xs text-slate-400">Tap the card to reveal the answer</p>
      )}
    </div>
  );
}

/* ── Study session view ─────────────────────────────────────── */
function StudySession({ cards, chapterName, onFinish }) {
  const [idx,     setIdx]     = useState(0);
  const [known,   setKnown]   = useState(new Set());
  const [unknown, setUnknown] = useState(new Set());
  const qc = useQueryClient();
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  const mutKnow = useMutation({
    mutationFn: (id) => markFlashcard(uid, id, true),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flashcard-summary'] }),
  });
  const mutUnknown = useMutation({
    mutationFn: (id) => markFlashcard(uid, id, false),
  });

  const advance = (knownCount, unknownCount) => {
    if (idx + 1 >= cards.length) onFinish({ known: knownCount, total: cards.length });
    else setIdx((i) => i + 1);
  };
  const handleKnow = (id) => {
    mutKnow.mutate(id);
    const nextKnown = new Set(known); nextKnown.add(id);
    setKnown(nextKnown);
    advance(nextKnown.size, unknown.size);
  };
  const handleDontKnow = (id) => {
    mutUnknown.mutate(id);
    const nextUnknown = new Set(unknown); nextUnknown.add(id);
    setUnknown(nextUnknown);
    advance(known.size, nextUnknown.size);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold text-slate-500 text-center">{chapterName}</p>
      <div className="flex items-center justify-center gap-4 text-xs">
        <span className="flex items-center gap-1 text-emerald-600 font-semibold">
          <CheckCircle2 size={13} /> {known.size} got it
        </span>
        <span className="flex items-center gap-1 text-red-500 font-semibold">
          <XCircle size={13} /> {unknown.size} again
        </span>
      </div>
      <FlipCard
        card={cards[idx]}
        onKnow={handleKnow}
        onDontKnow={handleDontKnow}
        index={idx}
        total={cards.length}
      />
    </div>
  );
}

/* ── Chapter list view ─────────────────────────────────────── */
function ChapterList({ uid, examType, classLevel, onSelectChapter }) {
  const [syllabus,   setSyllabus]   = useState({});
  const [loadingSyl, setLoadingSyl] = useState(true);
  const [search,     setSearch]     = useState('');
  const [collapsed,  setCollapsed]  = useState(new Set());

  useEffect(() => {
    setLoadingSyl(true);
    // Class 11 students only see their year; Class 12 (or unset) see both years.
    const clFilter = classLevel === '11' ? '11' : null;
    getAllChapters(examType, clFilter)
      .then((data) => { setSyllabus(data ?? {}); })
      .catch(() => setSyllabus({}))
      .finally(() => setLoadingSyl(false));
  }, [examType, classLevel]);

  const subjects = Object.keys(syllabus);

  const { data: summary = [] } = useQuery({
    queryKey: ['flashcard-summary', uid],
    queryFn:  () => getFlashcardSummary(uid),
    enabled:  !!uid,
  });

  const summaryMap = useMemo(() => Object.fromEntries(summary.map((s) => [s.chapter_key, s])), [summary]);

  const q = search.trim().toLowerCase();
  const filteredSyllabus = useMemo(() => {
    if (!q) return syllabus;
    const out = {};
    for (const subject of subjects) {
      const matches = (syllabus[subject] || []).filter((ch) => ch.name.toLowerCase().includes(q));
      if (matches.length) out[subject] = matches;
    }
    return out;
  }, [syllabus, subjects, q]);
  const visibleSubjects = Object.keys(filteredSyllabus);

  const toggleCollapsed = (subject) => {
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(subject)) next.delete(subject); else next.add(subject);
      return next;
    });
  };

  if (loadingSyl) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 size={22} className="animate-spin text-primary-400" />
      </div>
    );
  }

  if (subjects.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <BookOpen size={28} className="mx-auto mb-2 text-slate-300" />
        <p className="text-sm font-medium">No chapters found for your profile.</p>
        <p className="text-xs mt-1">Ask your teacher to add syllabus chapters in the admin panel.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search chapters…"
          className="w-full pl-9 pr-3 py-2.5 text-sm rounded-xl border border-slate-200 bg-white placeholder-slate-400 focus:outline-none focus:border-primary-400"
        />
      </div>

      {visibleSubjects.length === 0 && (
        <p className="text-center text-sm text-slate-400 py-8">No chapters match "{search}".</p>
      )}

      {visibleSubjects.map((subject) => {
        const chapters = filteredSyllabus[subject] || [];
        const withProgress = chapters.filter((ch) => summaryMap[ch.key]);
        const knownTotal = withProgress.reduce((a, ch) => a + summaryMap[ch.key].known, 0);
        const cardTotal  = withProgress.reduce((a, ch) => a + summaryMap[ch.key].total, 0);
        const subjectPct = cardTotal > 0 ? Math.round((knownTotal / cardTotal) * 100) : 0;
        const isOpen = !collapsed.has(subject);
        const c = colorsFor(subject);

        return (
          <div key={subject} className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
            <button
              onClick={() => toggleCollapsed(subject)}
              className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 transition-colors text-left"
            >
              {cardTotal > 0 ? (
                <div className="relative shrink-0 h-9 w-9 flex items-center justify-center">
                  <RingChart pct={subjectPct} color={c.ring} size={36} stroke={4} />
                  <span className="absolute text-[9px] font-bold text-slate-600">{subjectPct}%</span>
                </div>
              ) : (
                <div className={`h-9 w-9 rounded-full flex items-center justify-center border ${c.chip}`}>
                  <Layers size={14} />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-slate-800">{subject}</h3>
                <p className="text-[10px] text-slate-400">{chapters.length} chapter{chapters.length === 1 ? '' : 's'}</p>
              </div>
              <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-3 pb-3 space-y-1.5">
                    {chapters.map((ch) => {
                      const s = summaryMap[ch.key];
                      const pct = s ? Math.round((s.known / s.total) * 100) : null;
                      const classLabel = ch.class_level ?? ch.class;
                      return (
                        <button key={ch.key} onClick={() => onSelectChapter({ ...ch, subject })}
                          className="w-full flex items-center gap-3 p-2.5 rounded-xl border border-slate-100 hover:border-primary-200 hover:bg-primary-50 transition-all text-left group">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">{ch.name}</p>
                            {classLabel && <p className="text-[10px] text-slate-400">Class {classLabel}</p>}
                          </div>
                          {s ? (
                            <div className="shrink-0 text-right">
                              <p className={`text-xs font-bold ${pct === 100 ? 'text-emerald-600' : 'text-primary-600'}`}>{pct}%</p>
                              <p className="text-[9px] text-slate-400">{s.known}/{s.total}</p>
                            </div>
                          ) : (
                            <span className="text-[10px] text-slate-400 shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Sparkles size={11} /> Generate
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function FlashcardsPage() {
  useParams();
  const navigate                = useNavigate();
  const { currentUser, userProfile, isPremium } = useAuth();
  const qc                      = useQueryClient();

  // userProfile.target_exam is the raw onboarding enum (e.g. 'CLASS_10', 'JEE_MAIN') —
  // must be normalized to the key syllabus_nodes actually uses (e.g. 'CBSE Class 10').
  const examType   = buildExamType(userProfile?.target_exam, userProfile?.syllabus, userProfile?.class_level);
  const classLevel = userProfile?.class_level ? String(userProfile.class_level) : null;
  const uid        = currentUser?.uid;

  const [selectedChapter, setSelectedChapter] = useState(null);
  const [mode, setMode]                       = useState('list'); // list | chapter | study | done
  const [doneStats, setDoneStats]             = useState(null);

  const activeChapter = selectedChapter;

  const { data: cards = [], isLoading: cardsLoading } = useQuery({
    queryKey: ['flashcards', uid, activeChapter?.key],
    queryFn:  () => getFlashcards(uid, activeChapter.key),
    enabled:  !!uid && !!activeChapter,
  });

  const [showPaywall, setShowPaywall] = useState(false);

  const genMutation = useMutation({
    mutationFn: () => generateFlashcards(uid, activeChapter, examType, 12),
    onSuccess: (newCards) => {
      qc.setQueryData(['flashcards', uid, activeChapter.key], newCards);
      qc.invalidateQueries({ queryKey: ['flashcard-summary'] });
      incrementQuota(uid, 'ai_questions_used', FLASHCARDS_PER_BATCH).catch(() => {});
      if (uid) localStorage.setItem(`edu_flashcard_used_${uid}`, '1');
      setMode('study');
    },
  });

  const handleSelectChapter = (ch) => {
    setSelectedChapter(ch);
    setMode('chapter');
    setDoneStats(null);
  };

  const handleGenerate = async () => {
    const quota = await checkQuota(uid, 'ai_questions_used', isPremium, undefined, FLASHCARDS_PER_BATCH);
    if (!quota.allowed) { setShowPaywall(true); return; }
    genMutation.mutate();
  };

  const handleStartStudy = () => {
    if (cards.length > 0) setMode('study');
    else handleGenerate();
  };

  if (mode === 'done' && doneStats) {
    const pct = Math.round((doneStats.known / doneStats.total) * 100);
    return (
      <div className="max-w-lg mx-auto p-4 flex flex-col items-center justify-center min-h-[65vh] text-center gap-5">
        <div className="relative h-24 w-24 flex items-center justify-center">
          <RingChart pct={pct} color={pct === 100 ? '#10b981' : '#6366f1'} size={96} stroke={8} />
          <span className="absolute text-lg font-extrabold text-slate-800">{pct}%</span>
        </div>
        <div>
          <h2 className="text-xl font-bold text-slate-900">Session Complete!</h2>
          <p className="text-slate-500 text-sm mt-2">
            You knew <strong>{doneStats.known}</strong> of <strong>{doneStats.total}</strong> cards.
            {doneStats.known === doneStats.total ? ' Perfect run!' : ' Keep reviewing the ones you missed.'}
          </p>
        </div>
        <div className="flex gap-3 w-full">
          <button onClick={() => { setMode('study'); }}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-semibold text-sm flex items-center justify-center gap-1.5 hover:bg-slate-50">
            <RotateCcw size={14} /> Study Again
          </button>
          <button onClick={() => { setMode('list'); setSelectedChapter(null); }}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-semibold text-sm hover:bg-primary-700 transition-colors">
            All Chapters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 p-4 lg:p-0 max-w-lg">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => {
          if (mode !== 'list') { setMode(mode === 'study' ? 'chapter' : 'list'); }
          else navigate('/syllabus');
        }} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Layers size={20} className="text-primary-500" />
            {mode === 'list' ? 'Flashcards' : activeChapter?.name}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">{examType} · AI-generated from NCERT</p>
        </div>
        {!isPremium && (
          <Link to="/pricing"
            className="flex items-center gap-1 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full hover:bg-amber-100 transition-colors">
            <Zap size={11} /> Premium
          </Link>
        )}
      </div>

      {/* Chapter list */}
      {mode === 'list' && (
        <ChapterList uid={uid} examType={examType} classLevel={classLevel} onSelectChapter={handleSelectChapter} />
      )}

      {/* Chapter detail — before starting study */}
      {mode === 'chapter' && activeChapter && (
        <div className="space-y-4">
          <div className="card text-center py-8 space-y-4">
            <div className="h-14 w-14 rounded-2xl bg-primary-50 flex items-center justify-center mx-auto">
              <BookOpen size={24} className="text-primary-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">{activeChapter.name}</h2>
              <p className="text-sm text-slate-500">
                {activeChapter.subject}
                {(activeChapter.class_level ?? activeChapter.class) && ` · Class ${activeChapter.class_level ?? activeChapter.class}`}
              </p>
            </div>
            {cards.length > 0 ? (
              <p className="text-sm text-slate-500">{cards.length} flashcards ready</p>
            ) : (
              <p className="text-sm text-slate-400">No flashcards yet — AI will generate 12 key concepts</p>
            )}
            <button
              onClick={handleStartStudy}
              disabled={genMutation.isPending}
              className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
            >
              {genMutation.isPending ? (
                <><Loader2 size={15} className="animate-spin" /> Generating cards…</>
              ) : cards.length > 0 ? (
                <><Layers size={15} /> Start Study Session</>
              ) : (
                <><Zap size={15} /> Generate &amp; Study</>
              )}
            </button>
            {cards.length > 0 && (
              <button onClick={handleGenerate} disabled={genMutation.isPending}
                className="text-xs text-slate-400 hover:text-primary-600 flex items-center gap-1 mx-auto transition-colors">
                <RefreshCw size={11} /> Regenerate cards
              </button>
            )}
            {genMutation.isError && (
              <p className="text-xs text-red-500">Generation failed. Try again.</p>
            )}
          </div>

          {showPaywall && (
            <PaywallModal
              onClose={() => setShowPaywall(false)}
              feature="AI flashcard generation"
              firebaseUid={currentUser?.uid}
              email={currentUser?.email}
              name={userProfile?.display_name}
            />
          )}
        </div>
      )}

      {/* Study session */}
      {mode === 'study' && activeChapter && (
        cardsLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-primary-400" />
          </div>
        ) : cards.length === 0 ? (
          <div className="card text-center py-8 space-y-3">
            <p className="text-sm text-slate-500">No flashcards for this chapter yet.</p>
            <button
              onClick={handleGenerate}
              disabled={genMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-control bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-60 transition-colors"
            >
              {genMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              Generate Cards
            </button>
          </div>
        ) : (
          <StudySession
            cards={cards}
            chapterName={activeChapter.name}
            onFinish={(stats) => {
              setDoneStats(stats);
              setMode('done');
              if (uid) {
                createNotification(
                  uid,
                  'flashcard_complete',
                  `Flashcards done: ${activeChapter.name}`,
                  `${stats.known}/${stats.total} cards known. Keep reviewing to master this chapter!`,
                  '/flashcards',
                ).catch(() => {});
              }
            }}
          />
        )
      )}
    </div>
  );
}
