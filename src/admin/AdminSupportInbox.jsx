import { useEffect, useState } from 'react';
import { Inbox, Mail, MailOpen, Archive, Loader2, Paperclip } from 'lucide-react';
import { supabase } from '../lib/supabase';

/**
 * Resend inbound email (Step 6, destination confirmed 2026-08-14) — replies
 * to receipts/notifications, or mail sent to a support@ address once DNS on
 * easewithexam.com points at Resend, land here via the resend-inbound edge
 * function instead of a separate mailbox an admin has to remember to check.
 *
 * Inert screen until the owner finishes two things outside this repo (see
 * that function's own header comment and the migration's): the MX record,
 * and a Resend-dashboard webhook + RESEND_WEBHOOK_SECRET. Shows an empty
 * state, not an error, until then — an unconfigured integration is not a
 * bug.
 */

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const STATUS_TABS = [
  { id: null,        label: 'All' },
  { id: 'unread',    label: 'Unread' },
  { id: 'read',      label: 'Read' },
  { id: 'archived',  label: 'Archived' },
];

const STATUS_BADGE = {
  unread:   'bg-primary-900/30 text-primary-300 border-primary-700/30',
  read:     'bg-slate-800 text-slate-400 border-white/10',
  archived: 'bg-slate-800/60 text-slate-500 border-white/5',
};

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AdminSupportInbox() {
  const callerUid = getCallerUid();
  const [statusFilter, setStatusFilter] = useState(null);
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [selected, setSelected] = useState(null);
  const [busy,     setBusy]     = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('admin_list_inbound_emails', { p_caller: callerUid, p_status: statusFilter });
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { if (callerUid) load(); }, [callerUid, statusFilter]);

  async function setStatus(row, status) {
    setBusy(true);
    try {
      await supabase.rpc('admin_set_inbound_email_status', { p_caller: callerUid, p_id: row.id, p_status: status });
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status } : r)));
      setSelected((s) => (s?.id === row.id ? { ...s, status } : s));
    } finally {
      setBusy(false);
    }
  }

  function open(row) {
    setSelected(row);
    if (row.status === 'unread') setStatus(row, 'read');
  }

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2"><Inbox size={20} /> Support Inbox</h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Inbound email to easewithexam.com — filed here automatically by the resend-inbound edge function once
          the owner's DNS/webhook setup is live. Nothing arrives here until then.
        </p>
      </div>

      <div className="flex gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.label}
            onClick={() => setStatusFilter(t.id)}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
              statusFilter === t.id
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-slate-800/60 text-slate-400 border-white/10 hover:text-slate-200',
            ].join(' ')}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-16 space-y-3">
          <Loader2 size={24} className="animate-spin mx-auto text-slate-600" />
          <p className="text-sm text-slate-500">Loading inbox…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 px-6 rounded-2xl bg-slate-800/40 border border-white/5">
          <Inbox size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-sm font-medium text-slate-300">Nothing here yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {statusFilter
              ? `No ${statusFilter} messages.`
              : 'Either no inbound email has arrived, or the DNS/webhook setup on the Resend side is not live yet.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <button
              key={row.id}
              onClick={() => open(row)}
              className={[
                'w-full text-left flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors',
                row.status === 'unread' ? 'bg-slate-800/80 border-white/10' : 'bg-slate-800/40 border-white/5',
                'hover:border-primary-500/30',
              ].join(' ')}
            >
              <div className="h-9 w-9 rounded-lg bg-primary-900/30 flex items-center justify-center shrink-0">
                {row.status === 'unread' ? <Mail size={15} className="text-primary-400" /> : <MailOpen size={15} className="text-slate-500" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm truncate ${row.status === 'unread' ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
                    {row.subject || '(no subject)'}
                  </p>
                  {Array.isArray(row.attachments) && row.attachments.length > 0 && (
                    <Paperclip size={12} className="text-slate-500 shrink-0" />
                  )}
                </div>
                <p className="text-[11px] text-slate-500 truncate">{row.from_address}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-1 rounded-lg border shrink-0 ${STATUS_BADGE[row.status]}`}>
                {row.status}
              </span>
              <span className="text-[11px] text-slate-500 shrink-0 w-24 text-right">{formatDate(row.created_at)}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}>
          <div
            className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-white/10 shrink-0">
              <h3 className="font-bold text-white">{selected.subject || '(no subject)'}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                From {selected.from_address} · to {(selected.to_addresses || []).join(', ')} · {formatDate(selected.created_at)}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {selected.body_html ? (
                <iframe title="Inbound email" srcDoc={selected.body_html} className="w-full h-96 border-0 bg-white rounded-xl" />
              ) : selected.body_text ? (
                <p className="text-sm text-slate-300 whitespace-pre-wrap">{selected.body_text}</p>
              ) : (
                <p className="text-sm text-slate-500">No body content was retrieved for this message.</p>
              )}
              {Array.isArray(selected.attachments) && selected.attachments.length > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Attachments</p>
                  <div className="flex flex-wrap gap-2">
                    {selected.attachments.map((a) => (
                      <span key={a.id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-xs text-slate-300">
                        <Paperclip size={11} /> {a.filename}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="p-4 border-t border-white/10 flex gap-2 shrink-0">
              {selected.status !== 'archived' ? (
                <button disabled={busy} onClick={() => setStatus(selected, 'archived')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors disabled:opacity-50">
                  <Archive size={13} /> Archive
                </button>
              ) : (
                <button disabled={busy} onClick={() => setStatus(selected, 'read')}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm font-medium transition-colors disabled:opacity-50">
                  Unarchive
                </button>
              )}
              <div className="flex-1" />
              <button onClick={() => setSelected(null)}
                className="px-5 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
