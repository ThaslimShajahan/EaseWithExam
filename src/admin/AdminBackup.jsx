/**
 * Backup all data — export every row of chapter_manifests, study_notes,
 * knowledge_base, pyq_questions and content_figures to a browser-downloaded
 * zip: one JSON file per table plus a manifest.json with row counts and the
 * export timestamp.
 *
 * Superadmin-only, stricter than every other admin_* RPC tonight (those all
 * allow role in ('superadmin','admin')) — the DB gate is
 * assert_verified_superadmin (20260904020000), not assert_verified_admin.
 * The route to this screen (/admin/people) is only hidden from non-superadmin
 * navs, not actually blocked for direct navigation (AdminGuard checks "is an
 * active admin", not role), so the check below is a real gate, not decoration
 * — the RPC call is still the one that can't be bypassed.
 *
 * Client-side zip, not a server export: total data is ~11k rows / ~159MB
 * (knowledge_base's embedding vectors dominate that), measured live before
 * building this — well within what a browser can hold and zip. content_figures
 * rows carry `image_url` as a plain string field like every other column; the
 * actual image bytes are never fetched or zipped, only the URL reference, so
 * images stay servable from Supabase storage.
 */
import { useState } from 'react';
import { Download, Loader2, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react';
import { zip } from 'fflate';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { ROLE_KEY } from './AdminGuard';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// Direct-select tables: RLS already allows a plain anon-key select on all of
// these (`using (true)`), same as the rest of the app reads them for display
// — no RPC needed, gating a read behind an RPC when the data is already
// openly selectable would be theatre, not security. study_notes is the one
// exception (see fetchStudyNotes below) because its RLS hides unpublished rows.
const DIRECT_TABLES = [
  { table: 'chapter_manifests', pageSize: 1000 },
  { table: 'knowledge_base',    pageSize: 300 },   // embedding vectors make rows large
  { table: 'pyq_questions',     pageSize: 1000 },
  { table: 'content_figures',   pageSize: 1000 },
];

async function fetchAllPaged(table, pageSize, onProgress) {
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.from(table).select('*')
      .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    onProgress(rows.length);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

// study_notes_read is `using (is_published = true)` — a plain select silently
// drops every draft/unpublished row. "Backup ALL data" has to mean all of
// them, so this one table goes through the SECURITY DEFINER RPC instead.
async function fetchStudyNotes(callerUid, onProgress) {
  const pageSize = 500;
  const rows = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.rpc('admin_export_study_notes', {
      p_caller: callerUid, p_offset: offset, p_limit: pageSize,
    });
    if (error) throw new Error(`study_notes: ${error.message}`);
    rows.push(...(data ?? []));
    onProgress(rows.length);
    if (!data || data.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

const isSuperAdmin = () => sessionStorage.getItem(ROLE_KEY) === 'superadmin';

export default function AdminBackup() {
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState(null); // { table, fetched, total }
  const [msg,      setMsg]      = useState(null);  // { kind: 'ok'|'err', text }

  if (!isSuperAdmin()) {
    return (
      <div className="flex items-start gap-2 bg-amber-900/20 border border-amber-700/25 rounded-xl p-4">
        <ShieldAlert size={16} className="text-amber-400 mt-0.5 shrink-0" />
        <p className="text-sm text-amber-300">Superadmin only. Ask a superadmin to run this export.</p>
      </div>
    );
  }

  async function handleExport() {
    setRunning(true); setMsg(null); setProgress(null);
    const callerUid = getCallerUid();
    try {
      const { data: counts, error: gateErr } = await supabase.rpc('admin_start_data_export', { p_caller: callerUid });
      if (gateErr) throw new Error(`Not authorized: ${gateErr.message}`);

      const files = {};
      const tableCounts = {};

      for (const { table, pageSize } of DIRECT_TABLES) {
        setProgress({ table, fetched: 0, total: counts?.[table] ?? null });
        const rows = await fetchAllPaged(table, pageSize, (fetched) =>
          setProgress({ table, fetched, total: counts?.[table] ?? null }));
        files[`${table}.json`] = new TextEncoder().encode(JSON.stringify(rows, null, 2));
        tableCounts[table] = rows.length;
      }

      setProgress({ table: 'study_notes', fetched: 0, total: counts?.study_notes ?? null });
      const studyNotes = await fetchStudyNotes(callerUid, (fetched) =>
        setProgress({ table: 'study_notes', fetched, total: counts?.study_notes ?? null }));
      files['study_notes.json'] = new TextEncoder().encode(JSON.stringify(studyNotes, null, 2));
      tableCounts.study_notes = studyNotes.length;

      const exportedAt = new Date().toISOString();
      files['manifest.json'] = new TextEncoder().encode(JSON.stringify({
        exported_at: exportedAt,
        row_counts: tableCounts,
        note: 'content_figures rows include image_url references only — image files themselves are not included; they remain servable from Supabase storage.',
      }, null, 2));

      setProgress({ table: 'zipping', fetched: 0, total: null });
      const zipped = await new Promise((resolve, reject) => {
        zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data)));
      });

      const blob = new Blob([zipped], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `edutech-backup-${exportedAt.slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);

      const totalRows = Object.values(tableCounts).reduce((s, n) => s + n, 0);
      logChange(ENTITY.SYSTEM, 'data_export', ACTION.EXPORT, tableCounts,
        `Full data backup exported (${totalRows} rows across ${Object.keys(tableCounts).length} tables)`);
      setMsg({ kind: 'ok', text: `Downloaded backup with ${totalRows} rows.` });
    } catch (e) {
      setMsg({ kind: 'err', text: e.message });
    } finally {
      setRunning(false); setProgress(null);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div className="bg-slate-900/40 rounded-2xl border border-white/8 p-4 space-y-3">
        <p className="text-sm text-slate-300">
          Exports every row of <code className="text-slate-400">chapter_manifests</code>, <code className="text-slate-400">study_notes</code> (including
          unpublished drafts), <code className="text-slate-400">knowledge_base</code>, <code className="text-slate-400">pyq_questions</code> and{' '}
          <code className="text-slate-400">content_figures</code> into a zip — one JSON file per table, plus a manifest listing row counts and the
          export time. <code className="text-slate-400">content_figures</code> includes each row's <code className="text-slate-400">image_url</code>, not
          the image itself.
        </p>
        <p className="text-xs text-slate-500">
          Roughly 11,000 rows, ~160MB before compression — this runs entirely in your browser and can take a minute or two, mostly fetching{' '}
          <code className="text-slate-500">knowledge_base</code>'s embedding vectors. Don't close this tab while it's running.
        </p>

        <button onClick={handleExport} disabled={running}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-500 text-white disabled:opacity-50 disabled:cursor-not-allowed">
          {running ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {running ? 'Exporting…' : 'Export all data (zip)'}
        </button>

        {progress && (
          <p className="text-xs text-slate-500">
            {progress.table === 'zipping'
              ? 'Compressing…'
              : `Fetching ${progress.table}… ${progress.fetched}${progress.total ? ` / ${progress.total}` : ''}`}
          </p>
        )}

        {msg && (
          <div className={`flex items-start gap-2 rounded-xl p-3 border text-xs ${
            msg.kind === 'ok' ? 'bg-emerald-900/20 border-emerald-700/25 text-emerald-300' : 'bg-red-900/20 border-red-700/25 text-red-300'}`}>
            {msg.kind === 'ok' ? <CheckCircle2 size={14} className="mt-0.5 shrink-0" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
            <p>{msg.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
