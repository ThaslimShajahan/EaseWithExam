import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Globe, Play, Square, CheckCircle2, XCircle,
  Loader2, FileText, ChevronDown, ChevronUp,
  SkipForward, Zap, RefreshCw, Upload, RotateCcw,
} from 'lucide-react';
import { crawlSite } from '../lib/crawler';
import { preFilterUrl, fetchPdfBuffer, extractPdfText, analyzeText, chunkText, processLocalFile } from '../lib/pdfAnalyzer';
import {
  supabase, adminSavePaper, adminSaveKnowledgeChunks,
  adminCreateCrawlJob, adminUpdateCrawlJob,
  adminBulkInsertCrawlPdfs, adminUpdateCrawlPdf,
  adminGetLatestCrawlJob,
} from '../lib/supabase';

/* ── Status meta ────────────────────────────────────────── */
const SM = {
  'idle':        { color: 'text-slate-400',   border: 'border-white/5',        label: 'Pending'          },
  'url-skipped': { color: 'text-orange-400',  border: 'border-orange-500/20',  label: 'URL filtered'     },
  'downloading': { color: 'text-blue-400',    border: 'border-blue-500/20',    label: 'Downloading…'     },
  'analyzing':   { color: 'text-violet-400',  border: 'border-violet-500/20',  label: 'GPT analysing…'   },
  'ai-skipped':  { color: 'text-amber-400',   border: 'border-amber-500/20',   label: 'Not educational'  },
  'done':        { color: 'text-emerald-400', border: 'border-emerald-500/20', label: 'Saved ✓'          },
  'failed':      { color: 'text-red-400',     border: 'border-red-500/20',     label: 'Failed'           },
};

const TABS = [
  { key: 'all',     label: 'All'       },
  { key: 'idle',    label: 'Pending'   },
  { key: 'done',    label: 'Saved'     },
  { key: 'skipped', label: 'Skipped'   },
  { key: 'failed',  label: 'Failed'    },
];

const tabMatch = {
  all:     () => true,
  idle:    (s) => s === 'idle',
  done:    (s) => s === 'done',
  skipped: (s) => ['url-skipped','ai-skipped'].includes(s),
  failed:  (s) => s === 'failed',
};

/* ── Sub-components ─────────────────────────────────────── */

function LogLine({ line }) {
  const col =
    line.type === 'error'   ? 'text-red-400'     :
    line.type === 'success' ? 'text-emerald-400' :
    line.type === 'skip'    ? 'text-orange-400'  :
    line.type === 'ai-skip' ? 'text-amber-400'   : 'text-slate-400';
  return (
    <p className={`text-xs font-mono leading-5 ${col}`}>
      <span className="text-slate-600 mr-1">[{line.time}]</span>{line.msg}
    </p>
  );
}

function PdfRow({ entry, onRetry }) {
  const { url, status, subject, year, skipReason } = entry;
  const meta     = SM[status] || SM.idle;
  const filename = decodeURIComponent(url.split('/').pop().split('?')[0] || 'paper.pdf');

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${meta.border} bg-transparent`}>
      <FileText size={13} className="text-slate-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate">{filename}</p>
        {skipReason ? (
          <p className="text-[10px] text-slate-500 truncate italic">{skipReason}</p>
        ) : (
          <p className="text-[10px] text-slate-600 truncate">{url}</p>
        )}
      </div>
      {subject && (
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 shrink-0 whitespace-nowrap">
          {subject} {year || ''}
        </span>
      )}
      <span className={`text-[10px] font-semibold shrink-0 whitespace-nowrap ${meta.color}`}>
        {meta.label}
      </span>
      {status === 'downloading' && <Loader2    size={13} className="text-blue-400   animate-spin shrink-0" />}
      {status === 'analyzing'   && <Loader2    size={13} className="text-violet-400 animate-spin shrink-0" />}
      {status === 'done'        && <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />}
      {status === 'ai-skipped'  && <XCircle    size={13} className="text-amber-400 shrink-0" />}
      {status === 'url-skipped' && <SkipForward size={13} className="text-orange-400 shrink-0" />}
      {status === 'failed' && onRetry && (
        <button
          onClick={() => onRetry(entry)}
          title="Retry download"
          className="p-1 rounded-lg hover:bg-slate-700 transition-colors shrink-0"
        >
          <RotateCcw size={12} className="text-red-400 hover:text-red-300" />
        </button>
      )}
    </div>
  );
}

function StatPill({ label, value, color }) {
  return (
    <span className="text-xs">
      <span className="text-slate-500">{label}: </span>
      <span className={color || 'text-white'}>{value}</span>
    </span>
  );
}

/* ── Storage constants ──────────────────────────────────── */
const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/pdf-proxy`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

async function uploadManualToStorage(buffer, filename) {
  const safeName    = filename.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/__+/g, '_');
  const storagePath = `pdfs/${Date.now()}_${safeName}`;
  const blob        = new Blob([buffer], { type: 'application/pdf' });

  const { error } = await supabase.storage
    .from('question-papers')
    .upload(storagePath, blob, { contentType: 'application/pdf', upsert: true });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

async function savePdfToVeda({ buffer, text, analysis, sourceUrl, filename }) {
  const isLocal = sourceUrl.startsWith('local:');

  // Crawled PDFs → don't store; "View PDF" proxies via Edge Function GET on demand.
  // Manual uploads → store in Supabase Storage (needs anon-upload SQL policy).
  let storagePath = null;
  if (isLocal && buffer) {
    try {
      storagePath = await uploadManualToStorage(buffer, filename);
    } catch (e) {
      console.warn('[storage] Manual upload failed:', e.message);
    }
  }

  const paper = await adminSavePaper({
    source_url:   sourceUrl,
    filename,
    storage_path: storagePath,
    subject:      analysis.subject,
    year:         analysis.year,
    board:        analysis.board,
    paper_type:   analysis.paperType,
    topics:       analysis.topics,
    summary:      analysis.summary,
    analysis,
    status:       'done',
  });

  if (text && paper?.id) {
    const chunks = chunkText(text, analysis.subject).map((c) => ({ ...c, paper_id: paper.id }));
    await adminSaveKnowledgeChunks(chunks);
  }
  return paper;
}

/* ── Main component ─────────────────────────────────────── */

export default function AdminCrawler() {
  const [url,            setUrl]            = useState('');
  const [jobId,          setJobId]          = useState(null);
  const [crawling,       setCrawling]       = useState(false);
  const [autoRun,        setAutoRun]        = useState(true);
  const [running,        setRunning]        = useState(false);
  const [logs,           setLogs]           = useState([]);
  const [entries,        setEntries]        = useState([]);
  const [stats,          setStats]          = useState(null);
  const [tab,            setTab]            = useState('all');
  const [showLog,        setShowLog]        = useState(true);
  const [restored,       setRestored]       = useState(false);
  const [uploadDragging, setUploadDragging] = useState(false);
  const [uploading,      setUploading]      = useState(false);
  const stopRef       = useRef(false);
  const manualInputRef = useRef(null);

  const now = () => new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const log = useCallback((msg, type = 'info') => {
    setLogs((l) => [...l.slice(-400), { msg, type, time: now() }]);
  }, []);

  const patchEntry = (url, patch) => {
    setEntries((prev) => prev.map((e) => e.url === url ? { ...e, ...patch } : e));
  };

  /* ── Restore last crawl on mount ─────────────────────── */
  useEffect(() => {
    adminGetLatestCrawlJob().then((job) => {
      if (!job) return;
      setUrl(job.url);
      setJobId(job.id);
      const restored = (job.crawl_pdfs || []).map((p) => ({
        url:        p.source_url,
        dbId:       p.id,
        status:     p.status,
        subject:    p.subject,
        year:       p.year,
        skipReason: p.skip_reason,
      }));
      setEntries(restored);
      const total   = restored.length;
      const urlSkip = restored.filter((e) => e.status === 'url-skipped').length;
      const saved   = restored.filter((e) => e.status === 'done').length;
      const aiSkip  = restored.filter((e) => e.status === 'ai-skipped').length;
      const pending = restored.filter((e) => e.status === 'idle').length;
      setStats({ pages: job.pages_scanned, total, urlSkip, saved, aiSkip });
      setRestored(true);
      if (pending > 0) log(`Restored previous crawl: ${pending} PDFs still pending`, 'success');
      else log(`Restored completed crawl: ${saved} saved, ${aiSkip + urlSkip} filtered`);
    }).catch(() => log('Could not load previous crawl — run SQL schema if this is first use.', 'error'));
  }, []);

  /* ── Core download+analyse loop ───────────────────────── */
  const processEntries = useCallback(async (targets) => {
    setRunning(true);
    log(`Auto-downloading ${targets.length} educational PDFs…`);

    for (const entry of targets) {
      if (stopRef.current) break;

      const fname = decodeURIComponent(entry.url.split('/').pop().split('?')[0]);
      log(`↓ ${fname}`);
      patchEntry(entry.url, { status: 'downloading' });
      if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'downloading' });

      let buffer;
      try {
        buffer = await fetchPdfBuffer(entry.url);
      } catch (err) {
        patchEntry(entry.url, { status: 'failed', skipReason: err.message });
        if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'failed', skip_reason: err.message });
        log(`✗ Download failed: ${err.message}`, 'error');
        continue;
      }

      let text = '';
      try { text = await extractPdfText(buffer); } catch {}

      log(`GPT analysing…`);
      patchEntry(entry.url, { status: 'analyzing' });
      if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'analyzing' });

      const analysis = await analyzeText(text, fname);

      if (!analysis.isEducational) {
        const reason = analysis.skipReason || 'Not educational';
        patchEntry(entry.url, { status: 'ai-skipped', skipReason: reason });
        if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'ai-skipped', skip_reason: reason });
        log(`⊘ GPT skipped: ${reason}`, 'ai-skip');
        continue;
      }

      try {
        await savePdfToVeda({ buffer, text, analysis, sourceUrl: entry.url, filename: fname });
        patchEntry(entry.url, { status: 'done', subject: analysis.subject, year: analysis.year });
        if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'done', subject: analysis.subject, year: analysis.year });
        log(`✓ ${analysis.subject} ${analysis.year || ''} — saved to EWE`, 'success');
      } catch (err) {
        patchEntry(entry.url, { status: 'failed', skipReason: err.message });
        if (entry.dbId) await adminUpdateCrawlPdf(entry.dbId, { status: 'failed', skip_reason: err.message });
        log(`✗ Save error: ${err.message}`, 'error');
      }
    }

    setRunning(false);
    log('Done. Check Papers tab for saved documents.', 'success');
  }, [log]);

  /* ── Manual PDF upload (bypasses all download issues) ── */
  const handleManualUpload = async (files) => {
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));
    if (!pdfs.length) return;
    setUploading(true);
    log(`Manually uploading ${pdfs.length} PDF(s)…`);

    for (const file of pdfs) {
      log(`📄 ${file.name}…`);
      try {
        const { buffer, text, analysis, filename } = await processLocalFile(file);
        if (!analysis.isEducational) {
          log(`⊘ GPT skipped: ${analysis.skipReason || 'Not educational'}`, 'ai-skip');
          continue;
        }
        await savePdfToVeda({ buffer, text, analysis, sourceUrl: `local:${filename}`, filename });
        log(`✓ ${filename} — ${analysis.subject} saved to EWE`, 'success');
      } catch (err) {
        log(`✗ ${file.name}: ${err.message}`, 'error');
      }
    }

    setUploading(false);
    log('Manual upload complete.', 'success');
  };

  /* ── Crawl ──────────────────────────────────────────── */
  const handleCrawl = async () => {
    if (!url.trim()) return;
    stopRef.current = false;
    setCrawling(true);
    setLogs([]);
    setEntries([]);
    setStats(null);
    setTab('all');
    setRestored(false);

    log(`Starting crawl: ${url}`);

    let job = null;
    try {
      job = await adminCreateCrawlJob(url.trim());
    } catch (dbErr) {
      log(`DB error creating crawl job: ${dbErr.message}`, 'error');
    }
    setJobId(job?.id || null);

    try {
      const result = await crawlSite(url.trim(), {
        maxPages: 40,
        onProgress: ({ pagesScanned, pdfsFound, currentUrl }) => {
          if (stopRef.current) return;
          log(`[${pagesScanned} pages] ${pdfsFound} PDFs — ${currentUrl.slice(0, 55)}…`);
        },
      });

      const dbPdfs    = [];
      const newEntries = [];
      let urlSkipCt   = 0;

      result.pdfs.forEach((u) => {
        const { likely, reason } = preFilterUrl(u);
        const fname = decodeURIComponent(u.split('/').pop().split('?')[0] || 'paper.pdf');
        if (!likely) {
          urlSkipCt++;
          dbPdfs.push({ source_url: u, filename: fname, status: 'url-skipped', skip_reason: reason });
          newEntries.push({ url: u, dbId: null, status: 'url-skipped', skipReason: reason });
          log(`⊘ URL filtered: ${fname} — ${reason}`, 'skip');
        } else {
          dbPdfs.push({ source_url: u, filename: fname, status: 'idle' });
          newEntries.push({ url: u, dbId: null, status: 'idle' });
        }
      });

      let savedRows = [];
      if (job?.id && dbPdfs.length) {
        savedRows = await adminBulkInsertCrawlPdfs(job.id, dbPdfs) || [];
      }

      const withIds = newEntries.map((e, i) => ({ ...e, dbId: savedRows[i]?.id || null }));
      setEntries(withIds);

      if (job?.id) {
        await adminUpdateCrawlJob(job.id, {
          status:        'completed',
          pages_scanned: result.pagesScanned,
          total_pdfs:    result.pdfs.length,
          completed_at:  new Date().toISOString(),
        });
      }

      const educationalCt = result.pdfs.length - urlSkipCt;
      setStats({ pages: result.pagesScanned, total: result.pdfs.length, urlSkip: urlSkipCt, saved: 0, aiSkip: 0 });
      log(`Crawl complete: ${result.pagesScanned} pages · ${educationalCt} educational PDFs found`, 'success');

      const toProcess = withIds.filter((e) => e.status === 'idle');
      if (autoRun && toProcess.length) {
        log(`Auto-downloading all ${toProcess.length} educational PDFs…`);
        setCrawling(false);
        await processEntries(toProcess);
      }
    } catch (err) {
      log(`Crawl error: ${err.message}`, 'error');
    } finally {
      setCrawling(false);
    }
  };

  const handleStop = () => {
    stopRef.current = true;
    setCrawling(false);
    setRunning(false);
    log('Stopped.');
  };

  const handleRetryPending = async () => {
    const pending = entries.filter((e) => e.status === 'idle');
    if (!pending.length) return;
    await processEntries(pending);
  };

  const handleRetryFailed = async () => {
    const failed = entries.filter((e) => e.status === 'failed');
    if (!failed.length) return;
    /* Reset to idle so the process loop picks them up */
    failed.forEach((e) => patchEntry(e.url, { status: 'idle', skipReason: null }));
    await processEntries(failed.map((e) => ({ ...e, status: 'idle' })));
  };

  const handleRetrySingle = async (entry) => {
    patchEntry(entry.url, { status: 'idle', skipReason: null });
    await processEntries([{ ...entry, status: 'idle' }]);
  };

  /* ── Derived counts ──────────────────────────────────── */
  const savedCt   = entries.filter((e) => e.status === 'done').length;
  const aiSkipCt  = entries.filter((e) => e.status === 'ai-skipped').length;
  const urlSkipCt = entries.filter((e) => e.status === 'url-skipped').length;
  const pendingCt = entries.filter((e) => e.status === 'idle').length;
  const failedCt  = entries.filter((e) => e.status === 'failed').length;

  const displayed = entries.filter((e) => (tabMatch[tab] || tabMatch.all)(e.status));
  const busy = crawling || running || uploading;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Web Crawler</h1>
        <p className="text-slate-400 text-sm mt-1">
          Paste a URL — the crawler finds all PDF links, auto-filters for educational content, and trains EWE.
        </p>
      </div>

      {/* ── Step 1: Crawl URL ────────────────────────────── */}
      <div className="bg-slate-800 rounded-2xl p-5 border border-white/5 space-y-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Step 1 — Crawl a website</p>
        <div className="flex gap-3">
          <div className="flex-1 flex items-center gap-2 bg-slate-900 rounded-xl px-4 border border-white/10">
            <Globe size={16} className="text-slate-500 shrink-0" />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && handleCrawl()}
              placeholder="https://efastforward.in/neet-past-year-question-papers"
              disabled={busy}
              className="flex-1 bg-transparent py-3 text-sm text-white placeholder:text-slate-600 outline-none disabled:opacity-50"
            />
          </div>
          {busy && (crawling || running) ? (
            <button onClick={handleStop} className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 rounded-xl text-white text-sm font-semibold transition-colors shrink-0">
              <Square size={14} /> Stop
            </button>
          ) : (
            <button onClick={handleCrawl} disabled={!url.trim() || busy} className="flex items-center gap-2 px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-40 rounded-xl text-white text-sm font-semibold transition-colors shrink-0">
              <Play size={14} /> Crawl
            </button>
          )}
        </div>

        {/* Auto-download toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setAutoRun((v) => !v)}
              className={[
                'relative h-5 w-9 rounded-full transition-colors shrink-0',
                autoRun ? 'bg-primary-600' : 'bg-slate-600',
              ].join(' ')}
            >
              <span className={[
                'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
                autoRun ? 'translate-x-4' : 'translate-x-0.5',
              ].join(' ')} />
            </button>
            <div>
              <p className="text-sm text-slate-200 font-medium">Auto-download after crawl</p>
              <p className="text-[10px] text-slate-500">Automatically download &amp; train EWE — no manual selection needed</p>
            </div>
          </div>

          <div className="flex gap-2">
            {pendingCt > 0 && !busy && (
              <button
                onClick={handleRetryPending}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-700 hover:bg-emerald-600 rounded-xl text-white text-xs font-semibold transition-colors shrink-0"
              >
                <Zap size={13} /> Process {pendingCt} pending
              </button>
            )}
            {failedCt > 0 && !busy && (
              <button
                onClick={handleRetryFailed}
                className="flex items-center gap-2 px-3 py-2 bg-red-800 hover:bg-red-700 rounded-xl text-white text-xs font-semibold transition-colors shrink-0"
              >
                <RotateCcw size={13} /> Retry {failedCt} failed
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-white/5">
            <StatPill label="Pages"       value={stats?.pages  ?? '—'} />
            <StatPill label="Total PDFs"  value={entries.length} />
            <StatPill label="Pending"     value={pendingCt}  color="text-slate-300" />
            <StatPill label="Saved"       value={savedCt}    color="text-emerald-400" />
            <StatPill label="GPT-rejected" value={aiSkipCt}  color="text-amber-400" />
            <StatPill label="URL-filtered" value={urlSkipCt} color="text-orange-400" />
            {failedCt > 0 && <StatPill label="Failed" value={failedCt} color="text-red-400" />}
          </div>
        )}

        {restored && (
          <div className="flex items-center gap-2 text-xs text-primary-400 bg-primary-900/20 border border-primary-500/20 rounded-xl px-3 py-2">
            <RefreshCw size={12} /> Previous crawl restored — data was saved and persisted.
          </div>
        )}
      </div>

      {/* ── Step 2: Manual upload fallback ──────────────── */}
      <div className="bg-slate-800 rounded-2xl p-5 border border-white/5 space-y-3">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Step 2 — Or upload PDFs manually</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Use this when a site blocks auto-download. Download the PDF in your browser, then drop it here.</p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setUploadDragging(true); }}
          onDragLeave={() => setUploadDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setUploadDragging(false);
            handleManualUpload(e.dataTransfer.files);
          }}
          onClick={() => manualInputRef.current?.click()}
          className={[
            'flex flex-col items-center justify-center gap-2 py-8 px-4 rounded-xl border-2 border-dashed cursor-pointer transition-all select-none',
            uploadDragging
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-slate-600 hover:border-slate-500 hover:bg-slate-700/30',
            uploading ? 'pointer-events-none opacity-50' : '',
          ].join(' ')}
        >
          <input
            ref={manualInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            hidden
            onChange={(e) => handleManualUpload(e.target.files)}
          />
          {uploading ? (
            <Loader2 size={20} className="text-primary-400 animate-spin" />
          ) : (
            <Upload size={20} className={uploadDragging ? 'text-primary-400' : 'text-slate-500'} />
          )}
          <p className="text-sm text-slate-300 font-medium">
            {uploading ? 'Processing…' : 'Drop PDFs here or click to browse'}
          </p>
          <p className="text-[10px] text-slate-500">
            GPT classifies each file — only educational content gets added to EWE
          </p>
        </div>
      </div>

      {/* ── PDF list ─────────────────────────────────────── */}
      <AnimatePresence>
        {entries.length > 0 && (
          <motion.div
            className="bg-slate-800 rounded-2xl border border-white/5 overflow-hidden"
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          >
            {/* Tabs */}
            <div className="flex border-b border-white/5 px-3 overflow-x-auto">
              {TABS.map((t) => {
                const count = entries.filter((e) => (tabMatch[t.key] || tabMatch.all)(e.status)).length;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={[
                      'px-3 py-3 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors',
                      tab === t.key
                        ? 'border-primary-500 text-primary-400'
                        : 'border-transparent text-slate-500 hover:text-slate-300',
                    ].join(' ')}
                  >
                    {t.label} <span className="opacity-60 ml-0.5">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Rows */}
            <div className="p-4 space-y-2 max-h-80 overflow-y-auto scrollbar-hide">
              {displayed.length === 0 ? (
                <p className="text-slate-600 text-sm text-center py-8">No PDFs in this category</p>
              ) : (
                displayed.map((e) => (
                  <PdfRow key={e.url} entry={e} onRetry={!busy ? handleRetrySingle : null} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Activity log ─────────────────────────────────── */}
      <div className="bg-slate-900 rounded-2xl border border-white/5 overflow-hidden">
        <button
          onClick={() => setShowLog((v) => !v)}
          className="flex items-center justify-between w-full px-5 py-3 border-b border-white/5 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Activity Log</p>
            {busy && <Loader2 size={12} className="text-primary-400 animate-spin" />}
          </div>
          {showLog ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </button>
        {showLog && (
          <div className="p-4 h-52 overflow-y-auto space-y-0.5 scrollbar-hide">
            {logs.length === 0 ? (
              <p className="text-slate-600 text-xs font-mono">Waiting for crawl…</p>
            ) : (
              logs.map((l, i) => <LogLine key={i} line={l} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
