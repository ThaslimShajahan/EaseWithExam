import { useEffect, useRef, useState } from 'react';
import {
  Users, Search, Loader2, Trophy, Flame, ArrowUpDown,
  Link2, Plus, Copy, CheckCheck, X, QrCode, Download,
  Share2, ChevronDown, ChevronUp, Slash,
} from 'lucide-react';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useCoaching } from './CoachingPortalGuard';
import { useFeatureFlag, FLAGS } from '../lib/featureFlags';
import {
  getCentreInvites, createCentreInvite, deactivateCentreInvite, inviteUrl,
} from '../lib/invites';
import EmptyState from '../components/ui/EmptyState';
import { examBadge } from '../lib/badgeStyles';

/* ─── QR canvas helper ─────────────────────────────────────── */
function useQR(url) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !url) return;
    QRCode.toCanvas(canvasRef.current, url, { width: 200, margin: 2 });
  }, [url]);
  return canvasRef;
}

/* ─── Copy button with tick feedback ──────────────────────── */
function CopyBtn({ text, label = 'Copy' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-primary-50 hover:text-primary-700 text-slate-600 transition-colors"
    >
      {copied ? <CheckCheck size={11} className="text-green-500" /> : <Copy size={11} />}
      {copied ? 'Copied!' : label}
    </button>
  );
}

/* ─── Single invite row ────────────────────────────────────── */
function InviteRow({ invite, onDeactivate }) {
  const [showQR, setShowQR] = useState(false);
  const url = inviteUrl(invite.invite_code);
  const qrRef = useQR(showQR ? url : null);

  const waText = encodeURIComponent(
    `Join our coaching centre on EaseWithExam!\nUse this link to sign up: ${url}`
  );

  function downloadQR() {
    const canvas = qrRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `invite-${invite.invite_code}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <div className={`rounded-xl border p-3 space-y-2 transition-colors ${invite.is_active ? 'bg-white border-slate-200' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-xs font-mono font-bold tracking-widest text-primary-700 bg-primary-50 px-2 py-0.5 rounded-lg">
              {invite.invite_code}
            </code>
            {invite.batch && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                {invite.batch}
              </span>
            )}
            {!invite.is_active && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-400">
                Deactivated
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {invite.used_count}{invite.max_uses ? `/${invite.max_uses}` : ''} used
            {invite.expires_at ? ` · expires ${new Date(invite.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
          </p>
        </div>

        {invite.is_active && (
          <button
            onClick={() => onDeactivate(invite.id)}
            title="Deactivate this link"
            className="shrink-0 text-[10px] font-semibold text-slate-400 hover:text-red-500 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1"
          >
            <Slash size={10} /> Deactivate
          </button>
        )}
      </div>

      {invite.is_active && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <CopyBtn text={url} label="Copy link" />
          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
          >
            <Share2 size={11} /> WhatsApp
          </a>
          <button
            onClick={() => setShowQR((v) => !v)}
            className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-primary-50 hover:text-primary-700 text-slate-600 transition-colors"
          >
            <QrCode size={11} /> {showQR ? 'Hide QR' : 'QR Code'}
          </button>
        </div>
      )}

      {showQR && (
        <div className="flex flex-col items-start gap-2 pt-1">
          <canvas ref={qrRef} className="rounded-lg border border-slate-200" />
          <button
            onClick={downloadQR}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-primary-600 hover:underline"
          >
            <Download size={11} /> Download PNG
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── Create invite modal ──────────────────────────────────── */
function CreateInviteModal({ centreId, callerUid, onCreated, onClose }) {
  const [batch,    setBatch]   = useState('');
  const [maxUses,  setMaxUses] = useState('');
  const [expDays,  setExpDays] = useState('');
  const [saving,   setSaving]  = useState(false);
  const [err,      setErr]     = useState('');

  async function handleCreate() {
    setSaving(true); setErr('');
    try {
      const expiresAt = expDays
        ? new Date(Date.now() + parseInt(expDays, 10) * 86400000).toISOString()
        : null;
      const res = await createCentreInvite({
        callerUid,
        centreId,
        batch: batch.trim() || null,
        maxUses: maxUses ? parseInt(maxUses, 10) : null,
        expiresAt,
      });
      if (!res.ok) throw new Error(res.message || 'Failed to create invite');
      onCreated(res.invite);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900">Create invite link</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">Batch name (optional)</label>
            <input
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="e.g. 2025 NEET Batch A"
              className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Max uses (blank = unlimited)</label>
              <input
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 30"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 block mb-1">Expires after (days)</label>
              <input
                value={expDays}
                onChange={(e) => setExpDays(e.target.value.replace(/\D/g, ''))}
                placeholder="e.g. 7"
                className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400"
              />
            </div>
          </div>
        </div>

        {err && <p className="text-xs text-red-500">{err}</p>}

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-bold hover:bg-primary-700 disabled:opacity-60 flex items-center justify-center gap-1.5 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
            Create link
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Invite Students card ─────────────────────────────────── */
function InviteStudentsCard({ callerUid, centreId }) {
  const [open,    setOpen]    = useState(false);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [modal,   setModal]   = useState(false);

  async function loadInvites() {
    setLoading(true); setError('');
    try {
      const res = await getCentreInvites(callerUid);
      if (!res.ok) throw new Error(res.error || 'Failed to load invites');
      setInvites(res.invites || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    if (!open) loadInvites();
    setOpen((v) => !v);
  }

  async function handleDeactivate(id) {
    try {
      await deactivateCentreInvite(id, callerUid);
      setInvites((prev) => prev.map((inv) => inv.id === id ? { ...inv, is_active: false } : inv));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleCreated(newInvite) {
    setInvites((prev) => [newInvite, ...prev]);
    setModal(false);
    if (!open) setOpen(true);
  }

  return (
    <>
      <div className="rounded-card border border-slate-200 bg-white overflow-hidden">
        <button
          onClick={toggle}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary-50 flex items-center justify-center">
              <Link2 size={14} className="text-primary-600" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-slate-900">Invite students</p>
              <p className="text-[10px] text-slate-400">Share a link or QR code</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); setModal(true); }}
              className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-xl bg-primary-600 text-white hover:bg-primary-700 transition-colors"
            >
              <Plus size={12} /> New link
            </button>
            {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </div>
        </button>

        {open && (
          <div className="border-t border-slate-100 p-4 space-y-3">
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 size={18} className="animate-spin text-primary-400" />
              </div>
            ) : error ? (
              <div className="rounded-xl bg-danger-light border border-danger/20 p-3 text-center">
                <p className="text-xs font-semibold text-danger">{error}</p>
                <button onClick={loadInvites} className="mt-1 text-[11px] text-primary-600 hover:underline font-semibold">Retry</button>
              </div>
            ) : invites.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-xs text-slate-400">No invite links yet.</p>
                <button
                  onClick={() => setModal(true)}
                  className="mt-2 text-xs font-semibold text-primary-600 hover:underline"
                >
                  Create your first link →
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {invites.map((inv) => (
                  <InviteRow key={inv.id} invite={inv} onDeactivate={handleDeactivate} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {modal && (
        <CreateInviteModal
          centreId={centreId}
          callerUid={callerUid}
          onCreated={handleCreated}
          onClose={() => setModal(false)}
        />
      )}
    </>
  );
}

/* ─── Main page ────────────────────────────────────────────── */
export default function CoachingStudentsPage() {
  const { currentUser }   = useAuth();
  const { record }        = useCoaching();
  const invitesEnabled    = useFeatureFlag(FLAGS.CENTRE_INVITES);

  const [students, setStudents] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [search,   setSearch]   = useState('');
  const [batchFilter, setBatch] = useState('All');
  const [sortKey, setSortKey]   = useState('name');
  const [sortAsc, setSortAsc]   = useState(true);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc((a) => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      try {
        const { data, error: err } = await supabase.rpc('get_coaching_centre_students', {
          p_uid: currentUser.uid,
        });
        if (err) throw err;
        setStudents(Array.isArray(data) ? data : []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [currentUser]);

  const batches = ['All', ...new Set(students.map(s => s.batch).filter(Boolean))];

  const filtered = students
    .filter((s) => {
      const q = search.toLowerCase();
      const matchSearch = !search ||
        (s.display_name || s.student_name || '').toLowerCase().includes(q) ||
        (s.email || s.student_email || '').toLowerCase().includes(q);
      const matchBatch = batchFilter === 'All' || s.batch === batchFilter;
      return matchSearch && matchBatch;
    })
    .sort((a, b) => {
      let va, vb;
      if (sortKey === 'name') {
        va = (a.display_name || a.student_name || '').toLowerCase();
        vb = (b.display_name || b.student_name || '').toLowerCase();
      } else if (sortKey === 'xp') {
        va = a.xp ?? 0; vb = b.xp ?? 0;
      } else if (sortKey === 'streak') {
        va = a.streak_days ?? 0; vb = b.streak_days ?? 0;
      } else {
        va = ''; vb = '';
      }
      return sortAsc ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-extrabold text-slate-900 flex items-center gap-2">
          <Users size={20} className="text-primary-600" /> Students
        </h1>
        <span className="text-xs text-slate-400">{students.length} total</span>
      </div>

      {/* Invite card — feature-flagged */}
      {invitesEnabled.value && record?.centre_id && (
        <InviteStudentsCard callerUid={currentUser.uid} centreId={record.centre_id} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search students…"
            className="pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-primary-400 w-52"
          />
        </div>
        {batches.map((b) => (
          <button
            key={b}
            onClick={() => setBatch(b)}
            className={[
              'px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
              batchFilter === b
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-slate-600 border-slate-200 hover:border-primary-300',
            ].join(' ')}
          >
            {b}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={24} className="animate-spin text-primary-500" />
        </div>
      ) : error ? (
        <div className="bg-danger-light border border-danger/20 rounded-card p-6 text-center">
          <p className="text-sm font-semibold text-danger">Failed to load students</p>
          <p className="text-xs text-slate-500 mt-1">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No students found"
          body={search ? 'Try a different name or email.' : 'No students enrolled yet.'}
          size="sm"
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-slate-100 bg-white">
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('name')}
                    className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    Student <ArrowUpDown size={10} className={sortKey === 'name' ? 'text-primary-500' : ''} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">Exam</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-400">Batch</th>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('xp')}
                    className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    XP <ArrowUpDown size={10} className={sortKey === 'xp' ? 'text-primary-500' : ''} />
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button
                    onClick={() => toggleSort('streak')}
                    className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors"
                  >
                    Streak <ArrowUpDown size={10} className={sortKey === 'streak' ? 'text-primary-500' : ''} />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((s) => {
                const name  = s.display_name || s.student_name || 'Unknown';
                const email = s.email || s.student_email || '';
                const exam  = s.target_exam || s.exam_type || '';
                return (
                  <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center font-bold text-primary-700 text-xs shrink-0">
                          {name[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 text-sm truncate">{name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {exam && (
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-lg border ${examBadge(exam.replace('_', ' '))}`}>
                          {exam.replace('_', ' ')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{s.batch || '—'}</td>
                    <td className="px-4 py-3">
                      {(s.xp ?? 0) > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-amber-600 font-semibold">
                          <Trophy size={11} /> {s.xp}
                        </span>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {(s.streak_days ?? 0) > 0 ? (
                        <span className="flex items-center gap-1 text-xs text-orange-500 font-semibold">
                          <Flame size={11} /> {s.streak_days}d
                        </span>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
