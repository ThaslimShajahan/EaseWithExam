import { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen, Plus, X, Loader2, Edit3, Trash2, Eye, EyeOff,
  Search, Tag, Globe, Building2, Upload, Sparkles, FileText, Check,
  List, Layers, ChevronDown,
} from 'lucide-react';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { chatComplete } from '../lib/aiProxy';
import { extractPdfText } from '../lib/pdfAnalyzer';
import { getAllExamTypes, getSubjectsForExam, BOARDS, CLASS_LEVELS } from '../lib/categories';
const SUBJ_COLORS = {
  Biology:     'bg-violet-900/30 text-violet-300 border border-violet-700/30',
  Physics:     'bg-blue-900/30 text-blue-300 border border-blue-700/30',
  Chemistry:   'bg-emerald-900/30 text-emerald-300 border border-emerald-700/30',
  Mathematics: 'bg-orange-900/30 text-orange-300 border border-orange-700/30',
  Mixed:       'bg-slate-800 text-slate-400 border border-white/10',
};

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── PDF upload + AI analysis section ── */
function PdfUploadSection({ onAnalyzed, analysisResult, setAnalysisResult }) {
  const [uploading,  setUploading]  = useState(false);
  const [analyzing,  setAnalyzing]  = useState(false);
  const [pdfText,    setPdfText]    = useState('');
  const [pdfFile,    setPdfFile]    = useState(null);
  const [pdfUrl,     setPdfUrl]     = useState('');
  const [err,        setErr]        = useState('');
  const fileRef = useRef();

  async function analyzeWithAI(text, url) {
    setAnalyzing(true); setErr('');
    try {
      const res = await chatComplete({
        model: 'gpt-4o-mini',
        messages: [{
          role: 'user',
          content: `You are an expert NEET/JEE study material analyst. Analyze this study note content and provide:
1. A concise summary (2-3 sentences)
2. 5-8 key points as a JSON array of strings
3. Suggested title
4. Suggested subject (Biology/Physics/Chemistry/Mathematics/Mixed)
5. Suggested tags as a comma-separated list

Content:
${text || 'No text extracted — please describe the document'}

Respond ONLY with this JSON format:
{"summary":"...","key_points":["..."],"title":"...","subject":"...","tags":"..."}`,
        }],
        temperature: 0.3,
        max_tokens: 800,
      });
      const raw = res.choices[0].message.content.trim();
      const parsed = JSON.parse(raw.replace(/```json\n?|\n?```/g, ''));
      setAnalysisResult({ ...parsed, pdf_url: url });
      onAnalyzed({ ...parsed, pdf_url: url });
    } catch (e) {
      setErr('AI analysis failed: ' + e.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
      setErr('Only PDF files are supported'); return;
    }
    if (file.size > 10 * 1024 * 1024) { setErr('File too large (max 10 MB)'); return; }
    setErr('');
    setPdfFile(file);
    setPdfText('');
    setAnalysisResult(null);

    // Upload to Supabase Storage
    setUploading(true);
    let uploadedUrl = '';
    try {
      const path = `study-notes/${Date.now()}_${file.name.replace(/\s/g, '_')}`;
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path);
      uploadedUrl = urlData.publicUrl;
      setPdfUrl(uploadedUrl);
    } catch (e) {
      setErr('Upload failed: ' + e.message);
      setUploading(false);
      return;
    }
    setUploading(false);

    // Extract the real text layer (was previously read as plain text, which
    // produces binary garbage for a PDF and silently broke AI auto-fill).
    let text = '';
    try {
      text = (await extractPdfText(await file.arrayBuffer())).slice(0, 12000);
      setPdfText(text);
    } catch {
      setErr('Could not read text from this PDF — it may be scanned/image-only. Fill the form in manually below.');
      return;
    }

    if (text) analyzeWithAI(text, uploadedUrl);
    else setErr('No readable text found in this PDF — it may be scanned/image-only. Fill the form in manually below.');
  }

  return (
    <div className="bg-gradient-to-br from-violet-900/20 to-primary-900/20 rounded-2xl border border-primary-700/30 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-primary-400" />
        <p className="text-sm font-bold text-white">AI-Powered Note Analysis</p>
        <span className="text-[10px] bg-primary-900/50 text-primary-300 px-2 py-0.5 rounded-full font-semibold">OPTIONAL</span>
      </div>
      <p className="text-xs text-slate-400">Upload a PDF and it's analyzed automatically — title, subject, and key points fill in below. Skip this and type your note manually if you'd rather.</p>

      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-primary-700/40 rounded-xl p-6 text-center cursor-pointer hover:border-primary-500 hover:bg-primary-900/10 transition-colors"
      >
        <Upload size={20} className="text-primary-400 mx-auto mb-2" />
        <p className="text-xs font-semibold text-primary-300">{pdfFile ? pdfFile.name : 'Click to upload PDF'}</p>
        <p className="text-[10px] text-slate-500 mt-1">PDF · max 10 MB</p>
        <input ref={fileRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={handleFile} />
      </div>

      {uploading && <p className="text-xs text-primary-400 text-center flex items-center justify-center gap-1"><Loader2 size={12} className="animate-spin" /> Uploading…</p>}
      {analyzing && <p className="text-xs text-primary-400 text-center flex items-center justify-center gap-1"><Loader2 size={12} className="animate-spin" /> Analyzing with AI…</p>}

      {pdfFile && !uploading && !analyzing && pdfText && (
        <button
          onClick={() => analyzeWithAI(pdfText, pdfUrl)}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-slate-800 border border-primary-700/40 text-primary-300 text-xs font-bold hover:bg-slate-700 transition-colors"
        >
          <Sparkles size={13} /> {analysisResult ? 'Re-analyze' : 'Analyze again'}
        </button>
      )}

      {analysisResult && (
        <div className="bg-slate-900/60 rounded-xl border border-emerald-700/30 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
            <Check size={13} /> AI Analysis Complete — form auto-filled below
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{analysisResult.summary}</p>
          {analysisResult.key_points?.length > 0 && (
            <ul className="text-xs text-slate-300 space-y-0.5 list-disc list-inside">
              {analysisResult.key_points.slice(0, 4).map((pt, i) => <li key={i}>{pt}</li>)}
            </ul>
          )}
        </div>
      )}

      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  );
}

/* ── Note form modal ── */
function NoteModal({ note, centres, examTypes, onClose, onSaved }) {
  const isEdit = !!note?.id;
  const callerUid = getCallerUid();
  const [form, setForm] = useState({
    title:        note?.title        ?? '',
    subject:      note?.subject      ?? 'Biology',
    exam_type:    note?.exam_type    ?? examTypes[0],
    chapter:      note?.chapter      ?? '',
    content:      note?.content      ?? '',
    pdf_url:      note?.pdf_url      ?? '',
    ai_summary:   note?.ai_summary   ?? '',
    centre_id:    note?.centre_id    ?? '',
    is_published: note?.is_published ?? false,
    tags:         note?.tags?.join(', ') ?? '',
    unit:         note?.unit         ?? '',
    page_start:   note?.page_start   ?? '',
    page_end:     note?.page_end     ?? '',
    sort_order:   note?.sort_order   ?? 0,
  });
  const [saving,          setSaving]         = useState(false);
  const [err,             setErr]            = useState('');
  const [analysisResult,  setAnalysisResult] = useState(null);

  const set    = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => setForm(f => ({ ...f, [k]: !f[k] }));
  const inputCls = 'w-full px-3 py-2.5 rounded-xl bg-slate-800 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm';
  const labelCls = 'text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-1';

  function handleAIResult(result) {
    setForm(f => ({
      ...f,
      title:      result.title      || f.title,
      subject:    result.subject    || f.subject,
      tags:       result.tags       || f.tags,
      pdf_url:    result.pdf_url    || f.pdf_url,
      ai_summary: result.summary    || f.ai_summary,
      content:    result.key_points?.join('\n• ') ? `• ${result.key_points.join('\n• ')}` : f.content,
    }));
  }

  async function handleSave() {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    try {
      const { data, error } = await supabase.rpc('admin_upsert_study_note', {
        p_caller:       callerUid,
        p_id:           isEdit ? note.id : null,
        p_title:        form.title.trim(),
        p_subject:      form.subject || null,
        p_exam_type:    form.exam_type || null,
        p_chapter:      form.chapter.trim() || null,
        p_content:      form.content.trim() || null,
        p_pdf_url:      form.pdf_url || null,
        p_centre_id:    form.centre_id || null,
        p_is_published: form.is_published,
        p_tags:         form.tags.split(',').map(t => t.trim()).filter(Boolean),
        p_unit:         form.unit.trim() || null,
        p_page_start:   form.page_start === '' ? null : Number(form.page_start),
        p_page_end:     form.page_end === '' ? null : Number(form.page_end),
        p_sort_order:   Number(form.sort_order) || 0,
      });
      if (error) throw error;
      logChange(ENTITY.STUDY_NOTE, data?.id ?? 'unknown', isEdit ? ACTION.UPDATE : ACTION.CREATE,
        { title: form.title.trim(), subject: form.subject, is_published: form.is_published },
        isEdit ? 'Admin updated study note' : 'Admin created study note');
      onSaved(data, isEdit);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <motion.div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto"
        initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
      >
        <div className="flex items-center justify-between p-5 border-b border-white/10 sticky top-0 bg-slate-900 z-10">
          <h3 className="font-bold text-white text-lg flex items-center gap-2">
            <BookOpen size={18} className="text-primary-400" />
            {isEdit ? 'Edit Note' : 'Add Study Note'}
          </h3>
          {!saving && (
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white"><X size={18} /></button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* PDF AI Analysis */}
          {!isEdit && (
            <PdfUploadSection
              onAnalyzed={handleAIResult}
              analysisResult={analysisResult}
              setAnalysisResult={setAnalysisResult}
            />
          )}

          {/* Title */}
          <div>
            <label className={labelCls}>Title *</label>
            <input value={form.title} onChange={set('title')} placeholder="e.g. Meiosis vs Mitosis — Key Differences" className={inputCls} />
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Subject</label>
              <select value={form.subject} onChange={set('subject')} className={inputCls}>
                {[...new Set([...getSubjectsForExam(form.exam_type), 'Mixed'])].map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Exam Type</label>
              <select value={form.exam_type} onChange={set('exam_type')} className={inputCls}>
                {examTypes.map(e => <option key={e}>{e}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Chapter / Topic</label>
            <input value={form.chapter} onChange={set('chapter')} placeholder="e.g. Cell Division" className={inputCls} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className={labelCls}>Unit <span className="font-normal text-slate-500">(for Contents view)</span></label>
              <input value={form.unit} onChange={set('unit')} placeholder="e.g. Unit 1: Wit and Wisdom" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Page start</label>
              <input type="number" min="1" value={form.page_start} onChange={set('page_start')} placeholder="e.g. 1" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Page end</label>
              <input type="number" min="1" value={form.page_end} onChange={set('page_end')} placeholder="e.g. 14" className={inputCls} />
            </div>
          </div>

          {form.pdf_url && (
            <div className="flex items-center gap-2 p-2.5 bg-emerald-900/20 rounded-xl border border-emerald-700/30">
              <FileText size={14} className="text-emerald-400 shrink-0" />
              <p className="text-xs text-emerald-300 font-medium truncate">PDF attached</p>
              <a href={form.pdf_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-400 hover:underline ml-auto shrink-0">View</a>
            </div>
          )}

          <div>
            <label className={labelCls}>
              Content / Key Points
              {analysisResult && <span className="text-primary-400 ml-1">(AI auto-filled)</span>}
            </label>
            <textarea value={form.content} onChange={set('content')} rows={7}
              placeholder="Write key points, explanations, or paste extracted text…"
              className={`${inputCls} resize-none font-mono leading-relaxed`} />
          </div>

          <div>
            <label className={labelCls}>Tags <span className="font-normal text-slate-500">(comma separated)</span></label>
            <input value={form.tags} onChange={set('tags')} placeholder="e.g. NEET PYQ, important, short notes" className={inputCls} />
          </div>

          <div>
            <label className={labelCls}>Restrict to Coaching Centre <span className="font-normal text-slate-500">(optional)</span></label>
            <select value={form.centre_id} onChange={set('centre_id')} className={inputCls}>
              <option value="">— Global (all students) —</option>
              {centres.map(c => <option key={c.id} value={c.id}>{c.name} {c.city ? `(${c.city})` : ''}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <div onClick={() => toggle('is_published')} className={`relative w-10 h-6 rounded-full transition-colors ${form.is_published ? 'bg-emerald-500' : 'bg-slate-700'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${form.is_published ? 'left-5' : 'left-1'}`} />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-200">{form.is_published ? 'Published' : 'Draft'}</p>
              <p className="text-[10px] text-slate-500">{form.is_published ? 'Visible to students' : 'Only admins can see this'}</p>
            </div>
          </label>

          {err && <p className="text-xs text-red-300 bg-red-900/20 border border-red-700/20 rounded-lg px-3 py-2">{err}</p>}

          <button onClick={handleSave} disabled={saving}
            className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : (isEdit ? 'Save Changes' : 'Add Note')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ── Single note row — shared by List view and Contents (Table of Contents) view ── */
function NoteRow({ note, centres, showPages, onTogglePublish, onEdit, onDelete }) {
  const subjCls = SUBJ_COLORS[note.subject] || 'bg-slate-800 text-slate-400 border border-white/10';
  return (
    <motion.div className="bg-slate-900/60 rounded-xl border border-white/8 p-4" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {showPages && (note.page_start || note.page_end) && (
              <span className="text-[10px] font-mono bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full border border-white/10 shrink-0">
                pg {note.page_start ?? '?'}{note.page_end && note.page_end !== note.page_start ? `–${note.page_end}` : ''}
              </span>
            )}
            <p className="font-semibold text-white text-sm">{note.title}</p>
            {!note.is_published && <span className="text-[10px] bg-amber-900/30 text-amber-400 font-bold px-2 py-0.5 rounded-full">DRAFT</span>}
            {note.pdf_url && <span className="flex items-center gap-1 text-[10px] bg-primary-900/30 text-primary-300 font-bold px-2 py-0.5 rounded-full"><FileText size={8} />PDF</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {note.subject && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${subjCls}`}>{note.subject}</span>}
            {note.chapter && <span className="text-[10px] text-slate-500">{note.chapter}</span>}
            {note.exam_type && <span className="text-[10px] text-slate-500">{note.exam_type.replace('_', ' ')}</span>}
            {note.centre_id
              ? <span className="flex items-center gap-1 text-[10px] text-violet-300 bg-violet-900/30 px-2 py-0.5 rounded-full"><Building2 size={9} />{centres.find(c => c.id === note.centre_id)?.name ?? 'Specific centre'}</span>
              : <span className="flex items-center gap-1 text-[10px] text-emerald-300 bg-emerald-900/30 px-2 py-0.5 rounded-full"><Globe size={9} />Global</span>}
          </div>
          {note.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {[...new Set(note.tags)].map(t => <span key={t} className="flex items-center gap-1 text-[9px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded-full border border-white/5"><Tag size={7} />{t}</span>)}
            </div>
          )}
          {note.content && <p className="mt-1 px-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">{note.content}</p>}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onTogglePublish(note)} title={note.is_published ? 'Unpublish' : 'Publish'}
            className={`p-2 rounded-lg transition-colors ${note.is_published ? 'text-emerald-400 hover:bg-emerald-900/20' : 'text-slate-500 hover:bg-white/5'}`}>
            {note.is_published ? <Eye size={15} /> : <EyeOff size={15} />}
          </button>
          <button onClick={() => onEdit(note)} className="p-2 rounded-lg text-slate-500 hover:text-primary-400 hover:bg-primary-900/20 transition-colors">
            <Edit3 size={15} />
          </button>
          <button onClick={() => onDelete(note)} title="Delete note"
            className="p-2 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Table of Contents view — groups notes by `unit` (e.g. "Unit 1: Wit and
 * Wisdom"), ordered by sort_order/page_start, mirroring the source book's
 * real contents page. Notes without a unit (older/manually-added notes)
 * fall into an "Other Notes" bucket at the end so nothing is hidden. ── */
function ContentsView({ notes, centres, onTogglePublish, onEdit, onDelete }) {
  const [collapsed, setCollapsed] = useState({});

  const groups = new Map();
  for (const n of notes) {
    const key = n.unit?.trim() || '__ungrouped__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }
  const ordered = [...groups.entries()]
    .sort(([a], [b]) => {
      if (a === '__ungrouped__') return 1;
      if (b === '__ungrouped__') return -1;
      return a.localeCompare(b, undefined, { numeric: true });
    })
    .map(([unit, list]) => [
      unit,
      [...list].sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0) || (x.page_start ?? 0) - (y.page_start ?? 0)),
    ]);

  if (notes.length === 0) return null;

  return (
    <div className="space-y-3">
      {ordered.map(([unit, list]) => {
        const isUngrouped = unit === '__ungrouped__';
        const pages = list.filter(n => n.page_start != null).flatMap(n => [n.page_start, n.page_end ?? n.page_start]);
        const range = pages.length ? `pg ${Math.min(...pages)}–${Math.max(...pages)}` : null;
        const isOpen = !collapsed[unit];
        return (
          <div key={unit} className="bg-slate-900/40 rounded-2xl border border-white/8 overflow-hidden">
            <button
              onClick={() => setCollapsed(c => ({ ...c, [unit]: !c[unit] }))}
              className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/5 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Layers size={15} className={isUngrouped ? 'text-slate-500' : 'text-primary-400'} />
                <p className="font-bold text-white text-sm truncate">{isUngrouped ? 'Other Notes' : unit}</p>
                <span className="text-[10px] text-slate-500 shrink-0">({list.length})</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {range && <span className="text-[10px] font-mono text-slate-500">{range}</span>}
                <ChevronDown size={15} className={`text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {isOpen && (
              <div className="p-3 pt-0 space-y-2">
                {list.map(note => (
                  <NoteRow key={note.id} note={note} centres={centres} showPages
                    onTogglePublish={onTogglePublish} onEdit={onEdit} onDelete={onDelete} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function AdminStudyNotes() {
  const [notes,      setNotes]     = useState([]);
  const [centres,    setCentres]   = useState([]);
  const [loading,    setLoading]   = useState(true);
  const [search,     setSearch]    = useState('');
  const [subjectF,   setSubjectF]  = useState('All');
  // Board/Class filters — with 668 notes spanning CBSE Class 8-12 across many
  // subjects, the subject-only filter left "Mathematics" mixing every class's
  // notes together with no way to narrow to just one board/class combo.
  const [boardF,     setBoardF]    = useState(null);
  const [classF,     setClassF]    = useState(null);
  const [modal,      setModal]     = useState(null);
  const [deleting,   setDeleting]  = useState(false);
  const [confirmNote, setConfirmNote] = useState(null); // note to delete
  const [viewMode,   setViewMode]  = useState('list'); // 'list' | 'contents'
  const callerUid = getCallerUid();
  const examTypes = getAllExamTypes();

  async function loadAll() {
    setLoading(true);
    const [notesRes, centresRes] = await Promise.all([
      supabase.rpc('admin_list_study_notes', { p_caller: callerUid }),
      supabase.rpc('admin_list_active_centres_lite', { p_caller: callerUid }),
    ]);
    setNotes(Array.isArray(notesRes.data) ? notesRes.data : []);
    setCentres(centresRes.data ?? []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  async function togglePublish(note) {
    await supabase.rpc('admin_toggle_study_note_publish', {
      p_caller: callerUid, p_id: note.id, p_published: !note.is_published,
    });
    logChange(ENTITY.STUDY_NOTE, note.id, ACTION.UPDATE,
      { after: { is_published: !note.is_published } },
      note.is_published ? 'Admin unpublished study note' : 'Admin published study note');
    setNotes(ns => ns.map(n => n.id === note.id ? { ...n, is_published: !n.is_published } : n));
  }

  async function handleDelete(note) {
    setDeleting(true);
    setConfirmNote(null);
    await supabase.rpc('admin_delete_study_note', { p_caller: callerUid, p_id: note.id });
    logChange(ENTITY.STUDY_NOTE, note.id, ACTION.DELETE_REQUEST,
      { title: note.title }, 'Admin deleted study note');
    setNotes(ns => ns.filter(n => n.id !== note.id));
    setDeleting(false);
  }

  function handleSaved(saved, isEdit) {
    if (isEdit) { setNotes(ns => ns.map(n => n.id === saved.id ? saved : n)); }
    else        { setNotes(ns => [saved, ...ns]); }
    setModal(null);
  }

  // Derived from the actual notes loaded (all of them, not filtered — `notes`
  // is fetched once up-front, not re-queried per filter), so a CBSE Class 8
  // Social Studies/Hindi note has a real filter option instead of only the
  // NEET/JEE subject set.
  const subjects = ['All', ...new Set(notes.map(n => n.subject).filter(Boolean))];

  // exam_type is stored as "Board Class N" (e.g. "CBSE Class 10") — board and
  // class filters are independent (picking a board alone should show every
  // class of that board), same matching rule used everywhere else content is
  // scoped to a board+class combo (see isRelevantToStudent in categories.js).
  function matchesBoardClass(examType) {
    if (!boardF && !classF) return true;
    const m = (examType || '').match(/^(.+?)\s+Class\s+(\d+)$/);
    if (!m) return false;
    const [, board, cls] = m;
    if (boardF && board !== boardF) return false;
    if (classF && cls !== classF) return false;
    return true;
  }

  const filtered = notes.filter(n => {
    const q = search.toLowerCase();
    const matchSearch = !search || n.title.toLowerCase().includes(q) || (n.chapter || '').toLowerCase().includes(q);
    const matchSubj   = subjectF === 'All' || n.subject === subjectF;
    return matchSearch && matchSubj && matchesBoardClass(n.exam_type);
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><BookOpen size={20} className="text-primary-400" /> Study Notes</h2>
          <p className="text-xs text-slate-400 mt-0.5">Create notes with AI analysis from PDFs — publish to students & coaching centres</p>
        </div>
        <button onClick={() => setModal('new')} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 transition-colors shadow-sm">
          <Plus size={15} /> Add Note
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Total Notes',  value: notes.length },
          { label: 'Published',    value: notes.filter(n => n.is_published).length },
          { label: 'With PDF',     value: notes.filter(n => n.pdf_url).length },
        ].map(({ label, value }) => (
          <div key={label} className="bg-slate-900/60 rounded-xl border border-white/8 p-3 text-center">
            <p className="text-2xl font-extrabold text-white">{value}</p>
            <p className="text-[10px] text-slate-500">{label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes…"
            className="pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-800 border border-white/10 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500 w-52" />
        </div>
        <div className="flex items-center gap-0.5 bg-slate-800 rounded-xl border border-white/10 p-0.5">
          <button onClick={() => setViewMode('list')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <List size={13} /> List
          </button>
          <button onClick={() => setViewMode('contents')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors ${viewMode === 'contents' ? 'bg-primary-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            <Layers size={13} /> Contents
          </button>
        </div>
        {(boardF || classF) && (
          <button onClick={() => { setBoardF(null); setClassF(null); }}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
            Clear board/class ✕
          </button>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase">Board</p>
        <div className="flex flex-wrap gap-1.5">
          {BOARDS.map(b => (
            <button key={b} onClick={() => setBoardF(prev => prev === b ? null : b)}
              className={['px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors', boardF === b ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-800 text-slate-400 border-white/10 hover:border-primary-500/50 hover:text-primary-300'].join(' ')}>
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase">Class</p>
        <div className="flex flex-wrap gap-1.5">
          {CLASS_LEVELS.map(cl => (
            <button key={cl} onClick={() => setClassF(prev => prev === cl ? null : cl)}
              className={['px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors', classF === cl ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-800 text-slate-400 border-white/10 hover:border-primary-500/50 hover:text-primary-300'].join(' ')}>
              Class {cl}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-bold text-slate-500 uppercase">Subject</p>
        <div className="flex flex-wrap gap-1.5">
          {subjects.map(s => (
            <button key={s} onClick={() => setSubjectF(s)}
              className={['px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors', subjectF === s ? 'bg-primary-600 text-white border-primary-600' : 'bg-slate-800 text-slate-400 border-white/10 hover:border-primary-500/50 hover:text-primary-300'].join(' ')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900/60 rounded-2xl border border-white/8 p-8 flex justify-center"><Loader2 size={20} className="animate-spin text-primary-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900/60 rounded-2xl border border-white/8 p-10 text-center">
          <BookOpen size={28} className="text-slate-700 mx-auto mb-2" />
          <p className="text-sm text-slate-400">
            {notes.length === 0 ? 'No study notes yet. Add your first one!' : 'No notes match this filter combination.'}
          </p>
          {notes.length > 0 && (
            <button onClick={() => { setBoardF(null); setClassF(null); setSubjectF('All'); setSearch(''); }}
              className="mt-2 text-xs text-primary-400 hover:underline">
              Clear filters
            </button>
          )}
        </div>
      ) : viewMode === 'contents' ? (
        <ContentsView notes={filtered} centres={centres}
          onTogglePublish={togglePublish} onEdit={(n) => setModal(n)} onDelete={(n) => setConfirmNote(n)} />
      ) : (
        <div className="space-y-2">
          {filtered.map(note => (
            <NoteRow key={note.id} note={note} centres={centres}
              onTogglePublish={togglePublish} onEdit={(n) => setModal(n)} onDelete={(n) => setConfirmNote(n)} />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmNote}
        onClose={() => setConfirmNote(null)}
        onConfirm={() => handleDelete(confirmNote)}
        title={`Delete "${confirmNote?.title}"?`}
        description="This note will be permanently removed. Students who have it saved will lose access."
        confirmLabel="Delete"
        loading={deleting}
      />

      <AnimatePresence>
        {modal && (
          <NoteModal
            note={modal === 'new' ? null : modal}
            centres={centres}
            examTypes={examTypes}
            onClose={() => setModal(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
