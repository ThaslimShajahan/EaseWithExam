import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2, XCircle, Eye, Loader2, AlertTriangle,
  Filter, BookOpen, X, Sparkles, Brain,
} from 'lucide-react';
import { supabase, adminSaveKnowledgeChunks } from '../lib/supabase';
import { chatComplete } from '../lib/aiProxy';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { examTypeToTag } from '../lib/categories';

const STATUS_COLORS = {
  in_review: 'bg-amber-900/20 text-amber-400 border-amber-700/30',
  published:  'bg-emerald-900/20 text-emerald-400 border-emerald-700/30',
  archived:   'bg-slate-700 text-slate-400 border-slate-600',
};

async function loadReviewQueue({ subject } = {}) {
  let q = supabase
    .from('pyq_questions')
    .select('id, question_text, subject, exam_type, chapter, question_type, marks, year, options, correct_answer, status, source, created_at')
    .eq('status', 'in_review')
    .order('created_at', { ascending: true })
    .limit(100);
  if (subject) q = q.eq('subject', subject);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

async function setStatus(ids, status) {
  const { error } = await supabase.rpc('admin_update_pyq_status', {
    p_caller: getCallerUid(), p_ids: ids, p_status: status,
  });
  if (error) throw error;
}

async function moveKBNotesToKB(kbNoteItems) {
  if (!kbNoteItems.length) return;
  const rows = kbNoteItems.map((item) => ({
    content:     item.question_text,
    subject:     item.subject,
    // exam_type must go through examTypeToTag() ("CBSE Class 8" -> "cbse_class_8")
    // to match the snake_case tag format every reader (EXAM_TAG_RE) expects —
    // saving the raw display string here made approved notes invisible to any
    // class-scoped filter/search from that point on.
    tags:        [item.chapter, item.subject, examTypeToTag(item.exam_type)].filter(Boolean),
  }));
  // adminSaveKnowledgeChunks adds embeddings before inserting
  await adminSaveKnowledgeChunks(rows, getCallerUid());
}

export default function AdminContentReview() {
  const [items,       setItems]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [selected,    setSelected]    = useState(new Set());
  const [acting,      setActing]      = useState(false);
  const [subjectF,    setSubjectF]    = useState('');
  const [typeF,       setTypeF]       = useState('');
  const [expanded,    setExpanded]    = useState(null);
  const [aiRunning,   setAiRunning]   = useState(false);
  const [aiProgress,  setAiProgress]  = useState('');
  const [aiSummary,   setAiSummary]   = useState(null);
  const [aiScores,    setAiScores]    = useState({});  // id → { score, reason }

  const [subjectOptions, setSubjectOptions] = useState([]);
  const [typeOptions,    setTypeOptions]    = useState([]);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await loadReviewQueue({ subject: subjectF || null });
      setItems(typeF ? data.filter(i => i.question_type === typeF) : data);
      setSelected(new Set());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [subjectF, typeF]);

  // Filter pill options must come from the FULL in-review queue, not the
  // currently-filtered `items` — otherwise picking one subject/type hides every
  // other pill, making it impossible to switch filters without a reload.
  useEffect(() => {
    loadReviewQueue().then((data) => {
      setSubjectOptions([...new Set(data.map((i) => i.subject).filter(Boolean))]);
      setTypeOptions([...new Set(data.map((i) => i.question_type).filter(Boolean))]);
    }).catch(() => {});
  }, []);

  const toggle    = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSelected(selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)));

  const act = async (status, ids) => {
    if (!ids.length) return;
    setActing(true);
    try {
      const targetItems = items.filter(i => ids.includes(i.id));
      await setStatus(ids, status);

      if (status === 'published') {
        // KB_NOTE items approved → also copy to knowledge_base with embeddings
        const kbNotes = targetItems.filter(i => i.question_type === 'KB_NOTE');
        if (kbNotes.length) {
          try { await moveKBNotesToKB(kbNotes); } catch { /* non-fatal */ }
        }

        logChange(ENTITY.PYQ_QUESTION, 'bulk', ACTION.APPROVE,
          { ids, count: ids.length }, `Approved ${ids.length} items from review queue`);
      } else {
        logChange(ENTITY.PYQ_QUESTION, 'bulk', ACTION.ARCHIVE,
          { ids, count: ids.length }, `Rejected ${ids.length} items from review queue`);
      }
      await load();
    } catch (e) { setError(e.message); }
    finally { setActing(false); }
  };

  const runAIReview = async () => {
    const targets = selected.size > 0
      ? items.filter(i => selected.has(i.id))
      : items;
    if (!targets.length) return;

    setAiRunning(true); setAiProgress(''); setAiSummary(null); setAiScores({});
    const newScores = {};
    const toApprove = [];
    const toFlag    = [];

    try {
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        setAiProgress(`AI reviewing ${i + 1} of ${targets.length}…`);
        const isKB = item.question_type === 'KB_NOTE';

        try {
          const resp = await chatComplete({
            model:           'gpt-4o-mini',
            max_tokens:      200,
            temperature:     0,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You review educational content quality. Return JSON only.' },
              {
                role: 'user',
                content: isKB
                  ? `Review this educational knowledge chunk for quality.
Subject: ${item.subject} | Exam: ${item.exam_type || 'General'}

Content:
${(item.question_text || '').slice(0, 800)}

Score 1–10 (7+ = approve, <7 = manual review).
Return: { "score": 8, "verdict": "approve" | "review", "reason": "one line" }`
                  : `Review this exam question for quality.
Subject: ${item.subject} | Exam: ${item.exam_type} | Type: ${item.question_type}

Question: ${(item.question_text || '').slice(0, 600)}
${item.options?.length ? `\nOptions:\n${item.options.join('\n')}` : ''}
${item.correct_answer ? `\nAnswer: ${item.correct_answer}` : ''}

Check: clear text, valid options, correct answer present, appropriate difficulty.
Score 1–10 (7+ = approve, <7 = manual review).
Return: { "score": 8, "verdict": "approve" | "review", "reason": "one line" }`,
              },
            ],
          });

          const r = JSON.parse(resp.choices[0].message.content);
          newScores[item.id] = { score: r.score, reason: r.reason };
          if (r.verdict === 'approve' && r.score >= 7) toApprove.push(item.id);
          else toFlag.push(item.id);
        } catch {
          newScores[item.id] = { score: 5, reason: 'AI check failed' };
          toFlag.push(item.id);
        }
      }

      setAiScores(newScores);

      if (toApprove.length) {
        await act('published', toApprove);
      }
      setAiSummary({ approved: toApprove.length, flagged: toFlag.length });
    } catch (e) { setError(e.message); }
    finally { setAiRunning(false); setAiProgress(''); }
  };

  const subjects = subjectOptions;
  const types    = typeOptions;
  const selArr   = [...selected];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Content Review Queue</h1>
          <p className="text-slate-400 text-sm mt-1">
            Items arrive here when <code className="bg-slate-800 px-1 rounded text-slate-300">content_review_queue_enabled</code> is on.
            KB_NOTE items approved here are also copied to the Knowledge Base.
          </p>
        </div>
        <button
          onClick={runAIReview}
          disabled={aiRunning || acting || items.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-violet-700 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-white text-sm font-semibold transition-colors shrink-0"
        >
          {aiRunning
            ? <><Loader2 size={14} className="animate-spin" /> Reviewing…</>
            : <><Sparkles size={14} /> AI Auto-Review {selected.size > 0 ? `(${selected.size})` : 'All'}</>
          }
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Pending',  value: items.length,                                         color: 'text-amber-400'   },
          { label: 'Selected', value: selected.size,                                         color: 'text-primary-400' },
          { label: 'PyQ',      value: items.filter(i => i.question_type !== 'KB_NOTE').length, color: 'text-blue-400'  },
          { label: 'KB Notes', value: items.filter(i => i.question_type === 'KB_NOTE').length, color: 'text-teal-400'  },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-slate-800 border border-white/5 rounded-2xl p-4 text-center">
            <p className={`text-3xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* AI progress */}
      {aiRunning && aiProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-violet-900/20 border border-violet-700/30 rounded-xl text-xs text-violet-300">
          <Brain size={13} className="text-violet-400 shrink-0 animate-pulse" />
          {aiProgress}
        </div>
      )}

      {/* AI summary chip */}
      {aiSummary && !aiRunning && (
        <div className="flex items-center gap-3 px-4 py-3 bg-violet-900/20 border border-violet-700/30 rounded-xl text-xs">
          <Sparkles size={13} className="text-violet-400 shrink-0" />
          <span className="text-violet-300 flex-1">
            AI auto-approved <strong className="text-emerald-400">{aiSummary.approved}</strong> items,
            flagged <strong className="text-amber-400">{aiSummary.flagged}</strong> for manual review.
          </span>
          <button onClick={() => setAiSummary(null)} className="text-violet-500 hover:text-violet-300">
            <X size={13} />
          </button>
        </div>
      )}

      {/* Filters + bulk actions */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={13} className="text-slate-500" />
          <span className="text-xs text-slate-500">Subject:</span>
          <div className="flex flex-wrap gap-1">
            {['', ...subjects].map((s) => (
              <button key={s || 'all'} onClick={() => setSubjectF(s)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  subjectF === s ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                {s || 'All'}
              </button>
            ))}
          </div>
        </div>

        {types.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Type:</span>
            <div className="flex gap-1">
              {['', ...types].map((t) => (
                <button key={t || 'all'} onClick={() => setTypeF(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    typeF === t ? 'bg-teal-700 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}>
                  {t || 'All'}
                </button>
              ))}
            </div>
          </div>
        )}

        {selArr.length > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-400">{selArr.length} selected</span>
            <button onClick={() => act('published', selArr)} disabled={acting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors">
              <CheckCircle2 size={12} /> Approve
            </button>
            <button onClick={() => act('archived', selArr)} disabled={acting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors">
              <XCircle size={12} /> Reject
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 bg-red-900/20 border border-red-700/30 rounded-xl p-3 text-xs text-red-400">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-20 text-center">
          <CheckCircle2 size={40} className="text-emerald-600" />
          <p className="text-slate-400 font-medium">Review queue is empty</p>
          <p className="text-slate-600 text-sm">All content is published, or the review flag is off.</p>
        </div>
      ) : (
        <div className="bg-slate-800 border border-white/5 rounded-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-3 border-b border-white/5 bg-slate-900/40 text-xs text-slate-500 font-semibold">
            <input type="checkbox"
              checked={selected.size === items.length && items.length > 0}
              onChange={toggleAll}
              className="accent-primary-600" />
            <span className="flex-1">Content</span>
            <span className="w-20 text-center">Type</span>
            <span className="w-16 text-center">AI Score</span>
            <span className="w-24 text-right">Actions</span>
          </div>

          {items.map((item) => {
            const isKB    = item.question_type === 'KB_NOTE';
            const score   = aiScores[item.id];
            return (
              <div key={item.id} className="border-b border-white/5 last:border-0">
                <div className={`flex items-center gap-3 px-5 py-3 hover:bg-white/5 transition-colors ${isKB ? 'bg-teal-900/5' : ''}`}>
                  <input type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="accent-primary-600 shrink-0" />

                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      {isKB && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-teal-900/40 text-teal-400 border border-teal-700/30 shrink-0">
                          KB
                        </span>
                      )}
                      <p className="text-sm text-white line-clamp-2 leading-snug">{item.question_text}</p>
                    </div>
                    <p className="text-[10px] text-slate-500">
                      {item.subject} · {item.exam_type}
                      {item.chapter ? ` · ${item.chapter}` : ''}
                      {item.year ? ` · ${item.year}` : ''}
                    </p>
                  </div>

                  <span className="w-20 text-center text-xs text-slate-400">{item.question_type ?? 'MCQ'}</span>

                  <div className="w-16 flex justify-center">
                    {score ? (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                        score.score >= 7
                          ? 'bg-emerald-900/20 text-emerald-400 border-emerald-700/30'
                          : 'bg-red-900/20 text-red-400 border-red-700/30'
                      }`} title={score.reason}>
                        {score.score}/10
                      </span>
                    ) : <span className="text-slate-700 text-xs">—</span>}
                  </div>

                  <div className="w-24 flex items-center justify-end gap-1.5">
                    <button onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                      title="Preview"
                      className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors">
                      <Eye size={11} />
                    </button>
                    <button onClick={() => act('published', [item.id])} disabled={acting} title="Approve"
                      className="p-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white transition-colors">
                      <CheckCircle2 size={11} />
                    </button>
                    <button onClick={() => act('archived', [item.id])} disabled={acting} title="Reject"
                      className="p-1.5 rounded-lg bg-red-800 hover:bg-red-700 disabled:opacity-40 text-white transition-colors">
                      <XCircle size={11} />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {expanded === item.id && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-12 pb-4 space-y-2 border-t border-white/5 pt-3 bg-slate-900/30">
                        {score && (
                          <p className={`text-xs font-semibold ${score.score >= 7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            AI: {score.score}/10 — {score.reason}
                          </p>
                        )}
                        <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{item.question_text}</p>
                        {item.options?.length > 0 && (
                          <div className="grid grid-cols-2 gap-1.5 mt-2">
                            {item.options.map((opt, i) => (
                              <p key={i} className={`text-xs px-3 py-1.5 rounded-lg border ${
                                opt.startsWith(item.correct_answer)
                                  ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300'
                                  : 'border-white/5 text-slate-400'}`}>
                                {opt}
                              </p>
                            ))}
                          </div>
                        )}
                        {item.correct_answer && !item.options?.length && (
                          <p className="text-xs text-emerald-400 font-semibold">Answer: {item.correct_answer}</p>
                        )}
                        {item.source && <p className="text-[10px] text-slate-600">Source: {item.source}</p>}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
