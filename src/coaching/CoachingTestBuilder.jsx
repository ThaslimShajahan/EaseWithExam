import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Trash2, Save, Loader2, AlertTriangle, ClipboardList, ChevronDown, ChevronUp, Eye, EyeOff, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { getFeatureFlag, FLAGS } from '../lib/featureFlags';
import { useCoaching } from './CoachingPortalGuard';
import { logChange, ENTITY, ACTION } from '../lib/changelog';

const EXAM_TYPES   = ['NEET', 'JEE Main', 'JEE Advanced', 'Board'];
const SUBJECTS     = ['Physics', 'Chemistry', 'Biology', 'Mathematics'];
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Mixed'];

const BLANK_Q = () => ({
  _id:            Math.random().toString(36).slice(2),
  question_text:  '',
  options:        ['', '', '', ''],
  correct_answer: '',
  marks:          4,
  negative_marks: 1,
  chapter:        '',
});

function QuestionEditor({ q, idx, onChange, onRemove }) {
  const [open, setOpen] = useState(idx === 0);

  return (
    <div className="border border-slate-200 rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="flex-1 text-sm font-semibold text-slate-700 truncate">
          Q{idx + 1}. {q.question_text || <span className="text-slate-400 font-normal italic">empty question</span>}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 text-red-400 hover:text-red-600 transition-colors"
        >
          <Trash2 size={13} />
        </button>
        {open ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="p-4 space-y-3">
              <textarea
                value={q.question_text}
                onChange={(e) => onChange({ ...q, question_text: e.target.value })}
                placeholder="Enter question text…"
                rows={3}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400 resize-none"
              />

              <div className="grid grid-cols-2 gap-2">
                {q.options.map((opt, oi) => (
                  <div key={oi} className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 w-5">{String.fromCharCode(65 + oi)}.</span>
                    <input
                      value={opt}
                      onChange={(e) => {
                        const opts = [...q.options]; opts[oi] = e.target.value;
                        onChange({ ...q, options: opts });
                      }}
                      placeholder={`Option ${String.fromCharCode(65 + oi)}`}
                      className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-primary-400"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-3">
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">Correct Answer</label>
                  <select
                    value={q.correct_answer}
                    onChange={(e) => onChange({ ...q, correct_answer: e.target.value })}
                    className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-primary-400 bg-white"
                  >
                    <option value="">Select</option>
                    {q.options.map((opt, oi) => (
                      <option key={oi} value={String.fromCharCode(65 + oi)}>
                        {String.fromCharCode(65 + oi)}{opt ? `: ${opt.slice(0, 20)}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">Marks</label>
                  <input type="number" min={0} max={20} value={q.marks}
                    onChange={(e) => onChange({ ...q, marks: +e.target.value })}
                    className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-primary-400 text-center" />
                </div>
                <div>
                  <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">Negative</label>
                  <input type="number" min={0} max={10} value={q.negative_marks}
                    onChange={(e) => onChange({ ...q, negative_marks: +e.target.value })}
                    className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-primary-400 text-center" />
                </div>
                <div className="flex-1 min-w-[120px]">
                  <label className="text-[10px] text-slate-500 font-semibold uppercase tracking-wide block mb-1">Chapter / Topic</label>
                  <input value={q.chapter}
                    onChange={(e) => onChange({ ...q, chapter: e.target.value })}
                    placeholder="optional"
                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-none focus:border-primary-400" />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function CoachingTestBuilder() {
  const { record }      = useCoaching();
  const centreId        = record?.centre_id;

  const [enabled,  setEnabled]  = useState(null);
  const [tests,    setTests]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [mode,     setMode]     = useState('list'); // 'list' | 'build'

  // form state
  const [title,    setTitle]    = useState('');
  const [subject,  setSubject]  = useState('');
  const [examType, setExamType] = useState('');
  const [difficulty, setDiff]   = useState('Mixed');
  const [duration, setDuration] = useState(60);
  const [questions, setQs]      = useState([BLANK_Q()]);

  useEffect(() => {
    (async () => {
      const on = await getFeatureFlag(FLAGS.CENTRE_TEST_BUILDER);
      setEnabled(on);
      if (on && centreId) await loadTests();
      setLoading(false);
    })();
  }, [centreId]);

  const loadTests = async () => {
    const { data, error } = await supabase
      .from('centre_published_tests')
      .select('id, title, subject, exam_type, difficulty, duration_minutes, total_marks, is_active, created_at')
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false });
    if (!error) setTests(data ?? []);
  };

  const handleSave = async () => {
    if (!title.trim()) { setError('Test title is required'); return; }
    if (questions.length === 0) { setError('Add at least one question'); return; }
    setSaving(true); setError('');
    try {
      const cleanQs = questions.map(({ _id, ...rest }) => rest);
      const totalMarks = cleanQs.reduce((s, q) => s + (q.marks || 0), 0);
      const { data, error: err } = await supabase
        .from('centre_published_tests')
        .insert({
          centre_id: centreId,
          title: title.trim(),
          subject, exam_type: examType, difficulty,
          duration_minutes: duration,
          total_marks: totalMarks,
          questions: cleanQs,
          created_by: record?.uid ?? null,
        })
        .select('id')
        .single();
      if (err) throw err;
      logChange(ENTITY.PUBLISHED_TEST, data.id, ACTION.PUBLISH,
        { title, subject, examType, difficulty, questionCount: cleanQs.length, totalMarks },
        `CoachingTestBuilder: centre ${centreId} published test`);
      await loadTests();
      setMode('list');
      setTitle(''); setSubject(''); setExamType(''); setDiff('Mixed'); setDuration(60);
      setQs([BLANK_Q()]);
    } catch (e) { setError(e.message); }
    finally { setSaving(false); }
  };

  const toggleActive = async (test) => {
    await supabase.from('centre_published_tests').update({ is_active: !test.is_active }).eq('id', test.id);
    await loadTests();
  };

  const deleteTest = async (id) => {
    await supabase.from('centre_published_tests').delete().eq('id', id);
    await loadTests();
  };

  const updateQ = (idx, val) => setQs(prev => prev.map((q, i) => i === idx ? val : q));
  const removeQ = (idx)      => setQs(prev => prev.filter((_, i) => i !== idx));

  if (loading) return (
    <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-primary-500" /></div>
  );

  if (!enabled) return (
    <div className="flex flex-col items-center gap-4 py-20 text-center">
      <div className="h-14 w-14 bg-slate-100 rounded-2xl flex items-center justify-center">
        <Lock size={24} className="text-slate-400" />
      </div>
      <div>
        <p className="font-semibold text-slate-700">Test Builder is not enabled</p>
        <p className="text-sm text-slate-500 mt-1">Contact your platform admin to activate <code className="bg-slate-100 px-1 rounded">centre_test_builder_enabled</code>.</p>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Test Builder</h1>
          <p className="text-sm text-slate-500">Create custom tests for your students</p>
        </div>
        {mode === 'list' ? (
          <button onClick={() => setMode('build')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors">
            <Plus size={15} /> New Test
          </button>
        ) : (
          <button onClick={() => setMode('list')}
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors">
            ← Back to Tests
          </button>
        )}
      </div>

      {mode === 'list' && (
        <div className="space-y-3">
          {tests.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              <ClipboardList size={32} className="text-slate-300" />
              <p className="text-slate-500 font-medium">No tests yet</p>
              <button onClick={() => setMode('build')}
                className="text-sm text-primary-600 hover:underline font-semibold">Create your first test →</button>
            </div>
          ) : tests.map((t) => (
            <div key={t.id} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-4 shadow-sm">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-900 truncate">{t.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {t.exam_type || '—'} · {t.subject || '—'} · {t.difficulty || '—'} · {t.duration_minutes}min · {t.total_marks}mk
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => toggleActive(t)} title={t.is_active ? 'Hide from students' : 'Show to students'}
                  className={`p-2 rounded-lg transition-colors ${t.is_active ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 bg-slate-50 hover:bg-slate-100'}`}>
                  {t.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                </button>
                <button onClick={() => deleteTest(t.id)}
                  className="p-2 rounded-lg text-red-400 bg-red-50 hover:bg-red-100 transition-colors">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {mode === 'build' && (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-5 shadow-sm">
          <h2 className="font-bold text-slate-800">New Test</h2>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-xs text-red-600">
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Test Title *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. NEET Physics Mock 1"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Exam Type</label>
              <select value={examType} onChange={(e) => setExamType(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400 bg-white">
                <option value="">Select</option>
                {EXAM_TYPES.map(e => <option key={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Subject</label>
              <select value={subject} onChange={(e) => setSubject(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400 bg-white">
                <option value="">Select</option>
                {SUBJECTS.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Difficulty</label>
              <select value={difficulty} onChange={(e) => setDiff(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400 bg-white">
                {DIFFICULTIES.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1">Duration (min)</label>
              <input type="number" min={5} max={360} value={duration}
                onChange={(e) => setDuration(+e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-primary-400 text-center" />
            </div>
          </div>

          {/* Questions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm">Questions ({questions.length})</h3>
              <button type="button" onClick={() => setQs(p => [...p, BLANK_Q()])}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-primary-200 text-primary-700 text-xs font-semibold hover:bg-primary-50 transition-colors">
                <Plus size={12} /> Add Question
              </button>
            </div>
            {questions.map((q, idx) => (
              <QuestionEditor
                key={q._id}
                q={q}
                idx={idx}
                onChange={(val) => updateQ(idx, val)}
                onRemove={() => removeQ(idx)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <p className="text-xs text-slate-500">
              Total marks: <span className="font-bold text-slate-700">{questions.reduce((s, q) => s + (q.marks || 0), 0)}</span>
            </p>
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              {saving ? 'Saving…' : 'Publish Test'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
