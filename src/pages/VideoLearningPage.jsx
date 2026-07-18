import { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, ChevronRight, Search, X, BookOpen, ExternalLink } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/* ── Curated playlist catalogue ─────────────────────────── */

const PLAYLISTS = {
  NEET: {
    Physics: [
      { id: 'PLqQyEfAF4KeBG7l1V6-XCe8BGXHSNpG2K', title: 'Laws of Motion', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Work, Energy & Power', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Waves & Oscillations', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Electrostatics', ch: 'Class 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Current Electricity', ch: 'Class 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Optics', ch: 'Class 12' },
    ],
    Chemistry: [
      { id: 'PLqQyEfAF4Ke...', title: 'Chemical Bonding', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Equilibrium', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Electrochemistry', ch: 'Class 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Organic Reactions', ch: 'Class 12' },
    ],
    Biology: [
      { id: 'PLqQyEfAF4Ke...', title: 'Cell Biology', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Human Physiology', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Genetics', ch: 'Class 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Ecology', ch: 'Class 12' },
    ],
  },
  'JEE Main': {
    Mathematics: [
      { id: 'PLqQyEfAF4Ke...', title: 'Calculus', ch: 'Class 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Coordinate Geometry', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Probability', ch: 'Class 12' },
    ],
    Physics: [
      { id: 'PLqQyEfAF4Ke...', title: 'Mechanics', ch: 'Class 11' },
      { id: 'PLqQyEfAF4Ke...', title: 'Modern Physics', ch: 'Class 12' },
    ],
    Chemistry: [
      { id: 'PLqQyEfAF4Ke...', title: 'Physical Chemistry', ch: 'Class 11-12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Organic Chemistry', ch: 'Class 12' },
    ],
  },
  'Class 10': {
    Mathematics: [
      { id: 'PLqQyEfAF4Ke...', title: 'Quadratic Equations', ch: 'Chapter 4' },
      { id: 'PLqQyEfAF4Ke...', title: 'Triangles', ch: 'Chapter 6' },
      { id: 'PLqQyEfAF4Ke...', title: 'Trigonometry', ch: 'Chapter 8' },
    ],
    Science: [
      { id: 'PLqQyEfAF4Ke...', title: 'Chemical Reactions', ch: 'Chapter 1' },
      { id: 'PLqQyEfAF4Ke...', title: 'Electricity', ch: 'Chapter 12' },
      { id: 'PLqQyEfAF4Ke...', title: 'Heredity', ch: 'Chapter 9' },
    ],
  },
  'Class 12': {
    Mathematics: [
      { id: 'PLqQyEfAF4Ke...', title: 'Integrals', ch: 'Chapter 7' },
      { id: 'PLqQyEfAF4Ke...', title: 'Matrices & Determinants', ch: 'Chapter 3-4' },
    ],
    Physics: [
      { id: 'PLqQyEfAF4Ke...', title: 'Electromagnetic Induction', ch: 'Chapter 6' },
      { id: 'PLqQyEfAF4Ke...', title: 'Semiconductor Devices', ch: 'Chapter 14' },
    ],
  },
};

/* YouTube search — always reliable, no embedding restrictions */
function makeYTSearchUrl(title, exam) {
  const query = encodeURIComponent(`${title} ${exam} NEET JEE NCERT explained`);
  return `https://www.youtube.com/results?search_query=${query}`;
}

function TopicCard({ topic, exam, onClick }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className="text-left p-4 rounded-2xl bg-white border-2 border-slate-100 hover:border-primary-200 hover:shadow-md transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-900 text-sm">{topic.title}</p>
          <p className="text-xs text-slate-400 mt-0.5">{topic.ch}</p>
        </div>
        <div className="h-9 w-9 rounded-xl bg-red-50 group-hover:bg-red-100 flex items-center justify-center shrink-0 transition-colors">
          <Play size={14} className="text-red-600 ml-0.5" />
        </div>
      </div>
    </motion.button>
  );
}

export default function VideoLearningPage() {
  const { userProfile } = useAuth();

  const examOptions = Object.keys(PLAYLISTS);
  const EXAM_ALIAS = {
    NEET: 'NEET', JEE_MAIN: 'JEE Main', JEE_ADVANCED: 'JEE Main', BOTH: 'NEET',
    CBSE: 'Class 12', ICSE: 'Class 12', 'Class 10': 'Class 10', 'Class 12': 'Class 12',
  };
  const defaultExam = EXAM_ALIAS[userProfile?.target_exam]
    ?? examOptions.find((e) => userProfile?.target_exam?.startsWith(e.split(' ')[0]))
    ?? examOptions[0];

  const [activeExam,    setActiveExam]    = useState(defaultExam);
  const [activeSubject, setActiveSubject] = useState(null);
  const [query,         setQuery]         = useState('');

  const subjects   = Object.keys(PLAYLISTS[activeExam] ?? {});
  const currentSub = activeSubject ?? subjects[0];
  const topics     = PLAYLISTS[activeExam]?.[currentSub] ?? [];

  const filtered = query.trim()
    ? topics.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : topics;

  // Always open YouTube search — embedding is unreliable due to playlist restrictions
  const handlePlay = (topic) => {
    window.open(makeYTSearchUrl(topic.title, activeExam), '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="space-y-5 p-4 lg:p-0">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Play size={18} className="text-red-500" /> Video Learning
        </h2>
        <p className="text-sm text-slate-500 mt-0.5">Curriculum-based lessons, chapter by chapter</p>
      </div>

      {/* Exam selector */}
      <div className="flex gap-2 flex-wrap">
        {examOptions.map((e) => (
          <button
            key={e}
            onClick={() => { setActiveExam(e); setActiveSubject(null); setQuery(''); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border-2 transition-colors ${
              activeExam === e
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
            }`}
          >
            {e}
          </button>
        ))}
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* Subject sidebar */}
        <div className="lg:w-44 shrink-0">
          <div className="card p-3 space-y-1">
            <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider px-2 mb-2">Subjects</p>
            {subjects.map((s) => (
              <button
                key={s}
                onClick={() => { setActiveSubject(s); setQuery(''); }}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium flex items-center justify-between transition-colors ${
                  currentSub === s
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {s}
                {currentSub === s && <ChevronRight size={14} className="text-primary-400" />}
              </button>
            ))}
          </div>
        </div>

        {/* Topics grid */}
        <div className="flex-1 space-y-4">
          {/* Search */}
          <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-3 py-2">
            <Search size={14} className="text-slate-400 shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search in ${currentSub}…`}
              className="flex-1 bg-transparent text-sm text-slate-700 placeholder:text-slate-400 outline-none"
            />
            {query && <button onClick={() => setQuery('')}><X size={13} className="text-slate-400" /></button>}
          </div>

          {/* Info banner */}
          <div className="flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5 text-xs text-blue-700">
            <BookOpen size={13} className="mt-0.5 shrink-0" />
            <span>
              Videos open curated YouTube playlists in-app. Click{' '}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${currentSub} ${activeExam} NCERT`)}`}
                target="_blank" rel="noreferrer"
                className="font-semibold underline flex-inline items-center gap-0.5"
              >
                View on YouTube <ExternalLink size={10} className="inline" />
              </a>{' '}
              for the full channel.
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-slate-500 text-sm">No topics match your search.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((t) => (
                <TopicCard
                  key={t.title}
                  topic={t}
                  exam={activeExam}
                  onClick={() => handlePlay(t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
