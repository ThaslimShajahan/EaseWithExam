import { useEffect, useState } from 'react';
import {
  Ruler, Loader2, Plus, Trash2, Save, Check, AlertTriangle, ChevronDown, ChevronUp,
  Wand2, Upload, Sparkles, X,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { refreshPaperTemplateOverrides } from '../lib/examPattern';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { chatComplete } from '../lib/aiProxy';
import { extractPdfText, splitIntoBatches } from '../lib/pdfAnalyzer';
import { EXAM_TYPE_GROUPS, BOARDS, CLASS_LEVELS } from '../lib/categories';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// NEET/JEE use a different per-subject NTA structure that doesn't fit this
// section/marks shape — everything else in Competitive is a real board-exam-
// style paper (CUET, UPSC, SSC CGL, ...) and IS editable here.
const NON_EDITABLE_COMPETITIVE = new Set(['NEET', 'JEE Main', 'JEE Advanced']);

async function analyzePdfIntoTemplate(file) {
  const buffer = await file.arrayBuffer();
  const rawText = await extractPdfText(buffer);
  if (!rawText?.trim()) throw new Error('Could not read any text from this PDF.');

  // Long combined/compiled papers can have their structure info spread across
  // pages — a flat slice() would silently drop whatever fell past the cutoff.
  // Batch on page boundaries (same helper the study-notes/PYQ pipeline uses)
  // and merge results instead.
  const batches = splitIntoBatches(rawText);
  let total_questions = null, duration_minutes = null, total_marks = null;
  const sections = [];

  for (const batch of batches) {
    const resp = await chatComplete({
      model:           'gpt-4o',
      max_tokens:      1500,
      temperature:     0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an expert at reading exam question papers and extracting their exact structure. Return only valid JSON. This may be one part of a larger paper split across multiple calls — report only what appears in THIS excerpt; use null for fields not visible here.' },
        {
          role: 'user',
          content: `Read this question paper excerpt and report its EXACT structure: total number of questions, total duration in minutes, total marks, and the section breakdown (each section's name, how many questions it has, and marks per question in that section).

Return JSON exactly in this shape:
{
  "total_questions": 35,
  "duration_minutes": 180,
  "total_marks": 80,
  "sections": [
    { "name": "Section A", "count": 20, "marks": 1 },
    { "name": "Section B", "count": 6, "marks": 2 }
  ]
}

RAW TEXT:
${batch}`,
        },
      ],
    }, { feature: 'paper-template-gen' });

    const data = JSON.parse(resp.choices[0].message.content);
    total_questions   = total_questions   ?? data.total_questions   ?? null;
    duration_minutes  = duration_minutes  ?? data.duration_minutes  ?? null;
    total_marks       = total_marks       ?? data.total_marks       ?? null;
    for (const s of (data.sections ?? [])) {
      if (!sections.some((existing) => existing.name === s.name)) sections.push(s);
    }
  }

  if (!sections.length) throw new Error('Could not find a section structure in this PDF.');
  return { total_questions, duration_minutes, total_marks, sections };
}

function TemplateCard({ template, onSaved, onDiscard, onDeleted, defaultOpen = false }) {
  const callerUid = getCallerUid();
  const isNew = template.isNew === true;
  const [open,            setOpen]            = useState(defaultOpen);
  const [totalQuestions,  setTotalQuestions]  = useState(template.total_questions ?? 0);
  const [durationMinutes, setDurationMinutes] = useState(template.duration_minutes ?? 0);
  const [totalMarks,      setTotalMarks]      = useState(template.total_marks ?? 0);
  const [sections,        setSections]        = useState(template.sections ?? []);
  const [saving,          setSaving]          = useState(false);
  const [saved,           setSaved]           = useState(false);
  const [error,           setError]           = useState('');
  const [analyzing,       setAnalyzing]       = useState(false);
  const [deleting,        setDeleting]        = useState(false);
  const [confirmDelete,   setConfirmDelete]   = useState(false);

  const handleDelete = async () => {
    setDeleting(true); setError('');
    try {
      const { error: e } = await supabase.rpc('admin_delete_paper_template', {
        p_caller: callerUid, p_exam_type: template.exam_type,
      });
      if (e) throw e;
      await refreshPaperTemplateOverrides();
      logChange(ENTITY.SYSTEM, template.exam_type, ACTION.DELETE_REQUEST, null,
        `Paper template deleted: ${template.exam_type}`);
      onDeleted?.();
    } catch (e) {
      setError(e.message || 'Delete failed');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const sectionCountSum = sections.reduce((s, sec) => s + (Number(sec.count) || 0), 0);
  const sectionMarksSum = sections.reduce((s, sec) => s + (Number(sec.count) || 0) * (Number(sec.marks) || 0), 0);
  const mismatch = sectionCountSum !== Number(totalQuestions);
  const marksMismatch = sectionMarksSum !== Number(totalMarks);
  const syncTotalToSections = () => setTotalQuestions(sectionCountSum);

  const updateSection = (i, field, value) => {
    setSections((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)));
  };
  const addSection = () => setSections((prev) => [...prev, { name: `Section ${String.fromCharCode(65 + prev.length)}`, count: 1, marks: 1 }]);
  const removeSection = (i) => setSections((prev) => prev.filter((_, idx) => idx !== i));

  const handleAnalyzePdf = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAnalyzing(true); setError('');
    try {
      const parsed = await analyzePdfIntoTemplate(file);
      setTotalQuestions(parsed.total_questions ?? totalQuestions);
      setDurationMinutes(parsed.duration_minutes ?? durationMinutes);
      setTotalMarks(parsed.total_marks ?? totalMarks);
      setSections(parsed.sections.map((s) => ({ name: s.name, count: s.count, marks: s.marks })));
      setOpen(true);
    } catch (err) {
      setError(`PDF analysis failed: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      const cleanSections = sections.map((s) => ({ name: s.name, count: Number(s.count) || 0, marks: Number(s.marks) || 0 }));
      const { error: e } = await supabase.rpc('admin_upsert_paper_template', {
        p_caller:           callerUid,
        p_exam_type:        template.exam_type,
        p_total_questions:  Number(totalQuestions),
        p_duration_minutes: Number(durationMinutes),
        p_total_marks:      Number(totalMarks),
        p_sections:         cleanSections,
      });
      if (e) throw e;
      await refreshPaperTemplateOverrides();
      logChange(ENTITY.SYSTEM, template.exam_type, isNew ? ACTION.CREATE : ACTION.UPDATE,
        { after: { total_questions: totalQuestions, duration_minutes: durationMinutes, total_marks: totalMarks, sections: cleanSections } },
        `Paper template ${isNew ? 'created' : 'updated'}: ${template.exam_type}`);
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`bg-slate-800 border rounded-2xl overflow-hidden ${isNew ? 'border-primary-500/40' : 'border-white/5'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between p-5 hover:bg-white/5 transition-colors text-left"
      >
        <div>
          <h3 className="font-bold text-white flex items-center gap-2">
            {template.exam_type}
            {isNew && <span className="text-[9px] font-bold text-primary-400 bg-primary-900/30 border border-primary-700/30 px-1.5 py-0.5 rounded-full uppercase">New</span>}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {totalQuestions} questions · {totalMarks} marks · {durationMinutes} min
            {(mismatch || marksMismatch) && (
              <span className="text-amber-400 ml-1.5">· needs a fix</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {saved && <span className="flex items-center gap-1 text-xs text-emerald-400"><Check size={13} /> Saved</span>}
          {isNew && !saved && (
            <button onClick={(e) => { e.stopPropagation(); onDiscard?.(); }} className="text-slate-500 hover:text-red-400" title="Discard">
              <X size={14} />
            </button>
          )}
          {!isNew && (
            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }} className="text-slate-500 hover:text-red-400" title="Delete template">
              <Trash2 size={14} />
            </button>
          )}
          {open ? <ChevronUp size={16} className="text-slate-500" /> : <ChevronDown size={16} className="text-slate-500" />}
        </div>
      </button>

      {confirmDelete && (
        <div className="mx-5 mb-4 flex items-center gap-3 bg-red-900/20 border border-red-700/30 rounded-xl p-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-300 flex-1">Delete the "{template.exam_type}" template? This can't be undone.</p>
          <button onClick={() => setConfirmDelete(false)} className="text-xs text-slate-400 hover:text-white px-2 py-1">Cancel</button>
          <button onClick={handleDelete} disabled={deleting}
            className="text-xs font-bold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors">
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-white/5 pt-4">
          {/* Fetch from an uploaded PDF */}
          <div className="flex items-start gap-2 bg-violet-900/10 border border-violet-700/20 rounded-xl p-3">
            <Sparkles size={13} className="text-violet-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-violet-300">Fetch structure from an uploaded PDF</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                Upload a real question paper — AI reads its exact section, question-type, and marks structure and fills the fields below for you to review.
              </p>
              <label className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold cursor-pointer transition-colors ${
                analyzing ? 'bg-slate-700 text-slate-400' : 'bg-violet-700 hover:bg-violet-600 text-white'
              }`}>
                {analyzing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                {analyzing ? 'Reading paper…' : 'Upload PDF'}
                <input type="file" accept="application/pdf" className="hidden" disabled={analyzing} onChange={handleAnalyzePdf} />
              </label>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Total Questions</label>
              <input type="number" value={totalQuestions} onChange={(e) => setTotalQuestions(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Duration (min)</label>
              <input type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Total Marks</label>
              <input type="number" value={totalMarks} onChange={(e) => setTotalMarks(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-slate-500 uppercase font-bold">Sections (mark distribution)</label>
              <button onClick={addSection} className="flex items-center gap-1 text-[10px] font-semibold text-primary-400 hover:text-primary-300">
                <Plus size={11} /> Add section
              </button>
            </div>
            <p className="text-[10px] text-slate-500">Name · question count · marks per question, for each section of the paper.</p>

            {sections.length === 0 ? (
              <p className="text-xs text-slate-600 italic px-1">No sections yet — add one, or upload a PDF above.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 px-0.5 text-[9px] font-bold text-slate-600 uppercase">
                  <span className="flex-1">Section</span>
                  <span className="w-20">Questions</span>
                  <span className="w-20">Marks each</span>
                  <span className="w-5" />
                </div>
                {sections.map((s, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={s.name} onChange={(e) => updateSection(i, 'name', e.target.value)}
                      placeholder="Section name"
                      className="flex-1 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500" />
                    <input type="number" value={s.count} onChange={(e) => updateSection(i, 'count', e.target.value)}
                      title="Question count" placeholder="Count"
                      className="w-20 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500" />
                    <input type="number" value={s.marks} onChange={(e) => updateSection(i, 'marks', e.target.value)}
                      title="Marks per question" placeholder="Marks"
                      className="w-20 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500" />
                    <button onClick={() => removeSection(i)} className="p-1.5 text-slate-500 hover:text-red-400">
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                {/* Proportional preview bar — visualizes the mark distribution at a glance */}
                <div className="flex h-2 rounded-full overflow-hidden bg-slate-900">
                  {sections.map((s, i) => {
                    const secMarks = (Number(s.count) || 0) * (Number(s.marks) || 0);
                    const pct = sectionMarksSum ? (secMarks / sectionMarksSum) * 100 : 0;
                    const colors = ['bg-primary-500', 'bg-violet-500', 'bg-amber-500', 'bg-teal-500', 'bg-rose-500'];
                    return pct > 0 ? <div key={i} className={colors[i % colors.length]} style={{ width: `${pct}%` }} title={`${s.name}: ${secMarks} marks`} /> : null;
                  })}
                </div>
              </>
            )}

            {mismatch && (
              <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-900/10 border border-amber-700/20 rounded-lg px-3 py-2">
                <AlertTriangle size={11} className="shrink-0" />
                <span className="flex-1">Section counts sum to {sectionCountSum}, but Total Questions is {totalQuestions}.</span>
                <button onClick={syncTotalToSections} className="flex items-center gap-1 font-bold hover:text-amber-300 shrink-0">
                  <Wand2 size={11} /> Set to {sectionCountSum}
                </button>
              </div>
            )}
            {marksMismatch && (
              <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
                <AlertTriangle size={11} /> Sections add up to {sectionMarksSum} marks, but Total Marks is {totalMarks}.
              </p>
            )}
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save Template
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Add-template picker — pulls choices live from Admin > Categories ── */
function AddTemplatePicker({ existingKeys, onCreate, onClose }) {
  const competitiveChoices = (EXAM_TYPE_GROUPS.find((g) => g.label === 'Competitive')?.items ?? [])
    .filter((e) => !NON_EDITABLE_COMPETITIVE.has(e));
  const [mode,  setMode]  = useState(competitiveChoices.length ? 'competitive' : 'board');
  const [comp,  setComp]  = useState(competitiveChoices[0] ?? '');
  const [board, setBoard] = useState(BOARDS[0] ?? '');
  const [cls,   setCls]   = useState(CLASS_LEVELS[0] ?? '');

  const examType = mode === 'competitive' ? comp : `${board} Class ${cls}`;
  const alreadyExists = existingKeys.has(examType);

  return (
    <div className="bg-slate-800 border border-primary-500/30 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-white text-sm">Add a template</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-white"><X size={15} /></button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setMode('competitive')} disabled={!competitiveChoices.length}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors disabled:opacity-30 ${mode === 'competitive' ? 'bg-primary-600 text-white' : 'bg-slate-900 text-slate-400'}`}>
          Competitive exam
        </button>
        <button onClick={() => setMode('board')}
          className={`flex-1 py-2 rounded-xl text-xs font-bold transition-colors ${mode === 'board' ? 'bg-primary-600 text-white' : 'bg-slate-900 text-slate-400'}`}>
          Board + Class
        </button>
      </div>

      {mode === 'competitive' ? (
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1.5">Exam</label>
          <div className="flex flex-wrap gap-1.5">
            {competitiveChoices.map((e) => (
              <button key={e} onClick={() => setComp(e)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${comp === e ? 'bg-primary-600 text-white' : 'bg-slate-900 text-slate-300 hover:bg-slate-700'}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1.5">Board</label>
            <select value={board} onChange={(e) => setBoard(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
              {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-1.5">Class</label>
            <select value={cls} onChange={(e) => setCls(e.target.value)}
              className="w-full bg-slate-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
              {CLASS_LEVELS.map((c) => <option key={c} value={c}>Class {c}</option>)}
            </select>
          </div>
        </div>
      )}

      {alreadyExists && (
        <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
          <AlertTriangle size={11} /> A template for "{examType}" already exists below — this will open it instead of creating a duplicate.
        </p>
      )}

      <button
        onClick={() => onCreate(examType)}
        disabled={!examType.trim()}
        className="w-full py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-colors disabled:opacity-40"
      >
        {alreadyExists ? `Open "${examType}"` : `Create "${examType}"`}
      </button>
    </div>
  );
}

export default function AdminPaperTemplates() {
  const [templates,  setTemplates]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showAdd,    setShowAdd]    = useState(false);
  const [focusKey,   setFocusKey]   = useState(null);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const { data, error: e } = await supabase.from('paper_templates').select('*').order('exam_type');
      if (e) throw e;
      setTemplates(data ?? []);
    } catch (e) {
      setError(e.message || 'Failed to load paper templates.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const existingKeys = new Set(templates.map((t) => t.exam_type));

  const handleCreate = (examType) => {
    setShowAdd(false);
    if (existingKeys.has(examType)) { setFocusKey(examType); return; }
    setTemplates((prev) => [
      { exam_type: examType, total_questions: 0, duration_minutes: 0, total_marks: 0, sections: [], isNew: true },
      ...prev,
    ]);
    setFocusKey(examType);
  };

  const handleDiscardNew = (examType) => {
    setTemplates((prev) => prev.filter((t) => t.exam_type !== examType));
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Ruler size={22} className="text-primary-400" /> Paper Templates
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Question count, duration, total marks, and section mark distribution — used by both the
            student "Generate New Paper" flow and Admin Paper Gen. Changes take effect immediately, no deploy needed.
          </p>
          <p className="text-slate-500 text-xs mt-1">
            NEET, JEE Main, and JEE Advanced use a different per-subject NTA pattern and aren't editable here.
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-colors"
        >
          <Plus size={14} /> Add Template
        </button>
      </div>

      {showAdd && (
        <AddTemplatePicker
          existingKeys={existingKeys}
          onCreate={handleCreate}
          onClose={() => setShowAdd(false)}
        />
      )}

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 size={24} className="animate-spin text-primary-500" /></div>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-16">No templates yet — click "Add Template" to create one for a board + class or a competitive exam.</p>
      ) : (
        <div className="space-y-4">
          {templates.map((t) => (
            <TemplateCard
              key={t.exam_type}
              template={t}
              onSaved={load}
              onDiscard={() => handleDiscardNew(t.exam_type)}
              onDeleted={load}
              defaultOpen={t.isNew === true || focusKey === t.exam_type}
            />
          ))}
        </div>
      )}
    </div>
  );
}
