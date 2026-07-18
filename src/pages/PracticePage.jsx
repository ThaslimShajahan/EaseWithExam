import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FlaskConical, Clock, Target, ChevronRight, Sparkles, BookOpen, Trash2, Loader2, Zap, ClipboardList, Play, FileText } from 'lucide-react';
import { getPublishedTests, deletePublishedTest, supabase, publishPYQPaper } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const DIFF_COLORS = {
  Easy:   'bg-emerald-50 text-emerald-700',
  Medium: 'bg-amber-50   text-amber-700',
  Hard:   'bg-red-50     text-red-700',
  Mixed:  'bg-violet-50  text-violet-700',
};

const SUBJECT_COLORS = {
  Physics:     'text-blue-600   bg-blue-50',
  Chemistry:   'text-green-600  bg-green-50',
  Biology:     'text-rose-600   bg-rose-50',
  Mathematics: 'text-violet-600 bg-violet-50',
  Mixed:       'text-amber-600  bg-amber-50',
};

/* ── PYQ Bank section ──────────────────────────────────────── */
function PYQBankSection() {
  const navigate = useNavigate();
  const [groups,     setGroups]    = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [launching,  setLaunching] = useState(null); // group key being launched

  useEffect(() => {
    supabase
      .from('pyq_questions')
      .select('id, exam_type, subject, chapter, marks, section, question_type, question_text, options, correct_answer, explanation, year, image_url')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data?.length) { setLoading(false); return; }
        // Group by exam_type + subject
        const map = {};
        data.forEach((q) => {
          const key = `${q.exam_type || 'General'}||${q.subject || 'Mixed'}`;
          if (!map[key]) map[key] = { examType: q.exam_type, subject: q.subject, rows: [] };
          map[key].rows.push(q);
        });
        setGroups(Object.values(map));
        setLoading(false);
      });
  }, []);

  const handleLaunch = async (group) => {
    const key = `${group.examType}||${group.subject}`;
    setLaunching(key);
    try {
      const title = `${group.examType || 'PYQ'} · ${group.subject} · Question Bank`;
      const dur   = Math.max(10, Math.ceil(group.rows.length * 1.5));
      const pub   = await publishPYQPaper({
        title,
        examType: group.examType || 'CBSE',
        subject:  group.subject  || 'Mixed',
        durationMinutes: dur,
        pyqRows: group.rows,
      });
      navigate(`/test?id=${pub.id}`);
    } catch (e) {
      alert(`Launch failed: ${e.message}`);
    } finally {
      setLaunching(null);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-4">
      <Loader2 size={14} className="animate-spin" /> Loading PYQ bank…
    </div>
  );
  if (!groups.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-xs text-slate-400 font-medium">PYQ Question Bank</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>
      <p className="text-xs text-slate-500">Questions extracted from real uploaded papers</p>
      <div className="grid lg:grid-cols-2 gap-3">
        {groups.map((g) => {
          const key       = `${g.examType}||${g.subject}`;
          const isLaunch  = launching === key;
          const chapters  = [...new Set(g.rows.map((r) => r.chapter).filter(Boolean))];
          const totalMarks = g.rows.reduce((s, r) => s + (r.marks ?? 1), 0);
          return (
            <motion.div
              key={key}
              className="card hover:shadow-md transition-shadow"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge bg-violet-50 text-violet-700">{g.examType || 'General'}</span>
                    <span className="badge bg-slate-100 text-slate-600">{g.subject || 'Mixed'}</span>
                  </div>
                  <h3 className="font-semibold text-slate-900 text-sm">
                    {g.examType} {g.subject} PYQ Set
                  </h3>
                </div>
                <ClipboardList size={18} className="text-violet-400 shrink-0 mt-1" />
              </div>

              <div className="flex gap-3 text-xs text-slate-500 mb-3">
                <span className="flex items-center gap-1"><Target size={11} /> {g.rows.length} questions</span>
                <span className="flex items-center gap-1"><Clock size={11} /> ~{Math.ceil(g.rows.length * 1.5)} min</span>
                <span className="flex items-center gap-1">✦ {totalMarks} marks</span>
              </div>

              {chapters.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {chapters.slice(0, 4).map((ch) => (
                    <span key={ch} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 px-2 py-0.5 rounded-full">{ch}</span>
                  ))}
                  {chapters.length > 4 && (
                    <span className="text-[10px] text-slate-400">+{chapters.length - 4} more</span>
                  )}
                </div>
              )}

              <button
                onClick={() => handleLaunch(g)}
                disabled={!!launching}
                className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
              >
                {isLaunch
                  ? <><Loader2 size={13} className="animate-spin" /> Preparing test…</>
                  : <><Play size={13} /> Start PYQ Practice</>
                }
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default function PracticePage() {
  const navigate  = useNavigate();
  const { currentUser } = useAuth();
  const isAdmin = !!currentUser?.uid && !!sessionStorage.getItem(`edu_admin_rec_${currentUser.uid}`);
  const [tests,   setTests]   = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    getPublishedTests().then((data) => { setTests(data); setLoading(false); });
  };

  useEffect(load, []);

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    await deletePublishedTest(id);
    setTests((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="space-y-6 p-4 lg:p-0">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900">Practice</h2>
        <p className="text-sm text-slate-500 mt-0.5">Full tests & chapter-wise AI practice</p>
      </div>

      {/* AI Practice Generator card */}
      <button
        onClick={() => navigate('/practice/generate')}
        className="w-full flex items-center gap-4 bg-gradient-to-r from-primary-600 to-primary-500 text-white rounded-2xl p-4 hover:from-primary-700 hover:to-primary-600 transition-all shadow-md shadow-primary-200 text-left"
      >
        <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
          <Zap size={20} className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base">AI Chapter Practice</p>
          <p className="text-xs text-primary-100 mt-0.5">Pick a chapter → get instant AI questions with explanations</p>
        </div>
        <ChevronRight size={20} className="text-white/70 shrink-0" />
      </button>

      {/* PYQ Bank */}
      <PYQBankSection />

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-slate-100" />
        <span className="text-xs text-slate-400 font-medium">AI-Generated Tests</span>
        <div className="flex-1 h-px bg-slate-100" />
      </div>

      {/* Published tests */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-6">
          <Loader2 size={16} className="animate-spin" /> Loading tests…
        </div>
      ) : tests.length === 0 ? (
        <div className="card bg-primary-50 border-primary-100">
          <div className="flex items-center gap-3">
            <Sparkles size={20} className="text-primary-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-primary-900">No tests published yet</p>
              <p className="text-xs text-primary-600 mt-0.5">Try AI chapter practice while your teacher prepares full-length tests.</p>
            </div>
            <button
              onClick={() => navigate('/practice/generate')}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-primary-600 text-white text-xs font-bold hover:bg-primary-700 transition-colors"
            >
              <Zap size={11} /> Practice Now
            </button>
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {tests.map((test, i) => (
            <motion.div
              key={test.id}
              className="card hover:shadow-md transition-shadow group"
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`badge ${SUBJECT_COLORS[test.subject] || 'text-slate-600 bg-slate-100'}`}>
                      {test.subject}
                    </span>
                    <span className={`badge ${DIFF_COLORS[test.difficulty] || 'bg-slate-100 text-slate-600'}`}>
                      {test.difficulty}
                    </span>
                    {test.exam_type && (
                      <span className="badge bg-slate-100 text-slate-500">{test.exam_type}</span>
                    )}
                  </div>
                  <h3 className="font-semibold text-slate-900 leading-snug">{test.title}</h3>
                  <div className="flex gap-3 mt-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Target size={11}/> {test.questions?.length ?? '?'} questions</span>
                    <span className="flex items-center gap-1"><Clock  size={11}/> {test.duration_minutes} min</span>
                  </div>
                </div>
                {isAdmin && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(e, test.id); }}
                    className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                    title="Delete test"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {/* Action buttons */}
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => navigate(`/test?id=${test.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors"
                >
                  <Play size={12} /> Take Online
                </button>
                <button
                  onClick={() => navigate(`/paper-mode?id=${test.id}`)}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
                >
                  <FileText size={12} /> Paper Mode
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Divider + AI note */}
      <div className="pt-2 border-t border-slate-100">
        <div className="flex items-start gap-3 bg-slate-50 rounded-2xl p-4">
          <BookOpen size={18} className="text-slate-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-700">How it works</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              Admin crawls educational PDFs → extracts text into EWE's knowledge base → AI generates original NEET/JEE questions using that content as style reference → tests are published here for students.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
