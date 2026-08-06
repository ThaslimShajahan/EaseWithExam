import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Users, BookOpen, Plus, X, ChevronRight,
  Search, CheckCircle2, Clock, AlertCircle, Trash2, Edit3,
  UserCog, ToggleLeft, ToggleRight, ShieldCheck, Link2,
  Copy, Check, Mail, MessageCircle, Settings2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { adminGetCentreInvites } from '../lib/invites';
import { createCoachingAdminInvite, coachingAdminInviteUrl } from '../lib/coachingAdminInvites';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { ROLE_KEY } from './AdminGuard';
import ConfirmDialog from '../components/ui/ConfirmDialog';

/* ── helpers ────────────────────────────────────────────────── */
const PLAN_LABELS = { free: 'Free', premium: 'Premium', enterprise: 'Enterprise' };

function StatusChip({ status }) {
  const map = {
    active:   'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    inactive: 'bg-slate-700 text-slate-400 border-slate-600',
    trial:    'bg-amber-500/10 text-amber-400 border-amber-500/20',
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide ${map[status] ?? map.inactive}`}>
      {status === 'active' ? <CheckCircle2 size={9} /> : status === 'trial' ? <Clock size={9} /> : <AlertCircle size={9} />}
      {status ?? 'inactive'}
    </span>
  );
}

/* ── Modal: Add / Edit Centre ──────────────────────────────── */
function CentreModal({ centre, callerUid, onClose, onSave }) {
  const isEdit = !!centre?.id;
  const [form, setForm] = useState({
    name: centre?.name ?? '',
    contact_email: centre?.contact_email ?? '',
    city: centre?.city ?? '',
    plan: centre?.plan ?? 'free',
    status: centre?.status ?? 'active',
    notes: centre?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    if (!form.name.trim()) { setErr('Centre name is required'); return; }
    setSaving(true); setErr('');
    try {
      const { data, error } = await supabase.rpc('admin_upsert_coaching_centre', {
        p_caller: callerUid, p_id: isEdit ? centre.id : null, p_fields: form,
      });
      if (error) throw error;
      logChange(ENTITY.COACHING_CENTRE, data?.id ?? centre?.id ?? 'unknown',
        isEdit ? ACTION.UPDATE : ACTION.CREATE,
        { name: form.name, city: form.city, plan: form.plan, status: form.status },
        isEdit ? 'Admin updated coaching centre' : 'Admin created coaching centre');
      onSave(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-bold text-white">{isEdit ? 'Edit Centre' : 'Add Coaching Centre'}</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <X size={13} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {[
            { key: 'name', label: 'Centre Name', placeholder: 'Sharma Classes, Kota' },
            { key: 'contact_email', label: 'Contact Email', placeholder: 'admin@centre.com', type: 'email' },
            { key: 'city', label: 'City', placeholder: 'Kota' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input
                value={form[key]}
                onChange={set(key)}
                type={type ?? 'text'}
                placeholder={placeholder}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Plan</label>
              <select value={form.plan} onChange={set('plan')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                <option value="free">Free</option>
                <option value="premium">Premium</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Status</label>
              <select value={form.status} onChange={set('status')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                <option value="active">Active</option>
                <option value="trial">Trial</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              placeholder="Internal notes…"
              className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none"
            />
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Centre'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Modal: Add Student ─────────────────────────────────────── */
function StudentModal({ centreId, callerUid, onClose, onSave }) {
  const [form, setForm] = useState({ student_uid: '', student_name: '', student_email: '', target_exam: 'NEET', batch: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    if (!form.student_uid.trim() || !form.student_name.trim()) {
      setErr('Student UID and student name are required');
      return;
    }
    setSaving(true); setErr('');
    try {
      // student_uid (form field) -> firebase_uid (real column, was previously
      // sent verbatim as a nonexistent column name, so this insert 400'd
      // every time — "Add Student" has likely never actually worked).
      const { data, error } = await supabase.rpc('admin_add_coaching_student', {
        p_caller: callerUid, p_centre_id: centreId,
        p_fields: {
          firebase_uid: form.student_uid.trim(),
          name: form.student_name.trim(), student_name: form.student_name.trim(),
          email: form.student_email.trim() || null, student_email: form.student_email.trim() || null,
          target_exam: form.target_exam, batch: form.batch,
        },
      });
      if (error) throw error;
      logChange(ENTITY.COACHING_CENTRE, centreId, ACTION.UPDATE,
        { action: 'add_student', student_name: form.student_name, target_exam: form.target_exam },
        'Admin added student to coaching centre');
      onSave(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-bold text-white">Add Student</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <X size={13} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {[
            { key: 'student_uid', label: 'Student UID (Firebase UID)', placeholder: 'abcXYZ123…' },
            { key: 'student_name', label: 'Student Name', placeholder: 'Rahul Sharma' },
            { key: 'student_email', label: 'Email (optional)', placeholder: 'rahul@email.com', type: 'email' },
            { key: 'batch', label: 'Batch / Section', placeholder: 'NEET 2026 A' },
          ].map(({ key, label, placeholder, type }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              <input
                value={form[key]}
                onChange={set(key)}
                type={type ?? 'text'}
                placeholder={placeholder}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs text-slate-400 mb-1">Target Exam</label>
            <select value={form.target_exam} onChange={set('target_exam')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
              <option value="NEET">NEET</option>
              <option value="JEE">JEE</option>
              <option value="MHT-CET">MHT-CET</option>
            </select>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Add Student'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Modal: Create Assignment ───────────────────────────────── */
function AssignmentModal({ centreId, callerUid, onClose, onSave }) {
  const [form, setForm] = useState({ title: '', description: '', due_date: '', subject: '', exam_type: 'NEET' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSave() {
    if (!form.title.trim()) { setErr('Title is required'); return; }
    setSaving(true); setErr('');
    try {
      const { data, error } = await supabase.rpc('admin_upsert_coaching_assignment', {
        p_caller: callerUid, p_centre_id: centreId, p_id: null,
        p_fields: { ...form, due_date: form.due_date || null },
      });
      if (error) throw error;
      logChange(ENTITY.COACHING_CENTRE, centreId, ACTION.UPDATE,
        { action: 'add_assignment', title: form.title, subject: form.subject },
        'Admin created assignment for coaching centre');
      onSave(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-bold text-white">Create Assignment</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
            <X size={13} className="text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {[
            { key: 'title', label: 'Assignment Title', placeholder: 'Chapter 5 — Laws of Motion' },
            { key: 'subject', label: 'Subject', placeholder: 'Physics' },
            { key: 'description', label: 'Description (optional)', placeholder: 'Solve Q1–Q20 from NCERT…' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="block text-xs text-slate-400 mb-1">{label}</label>
              {key === 'description' ? (
                <textarea
                  value={form[key]} onChange={set(key)} rows={2} placeholder={placeholder}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none"
                />
              ) : (
                <input
                  value={form[key]} onChange={set(key)} placeholder={placeholder}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500"
                />
              )}
            </div>
          ))}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Exam Type</label>
              <select value={form.exam_type} onChange={set('exam_type')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                <option value="NEET">NEET</option>
                <option value="JEE">JEE</option>
                <option value="MHT-CET">MHT-CET</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Due Date</label>
              <input
                type="date" value={form.due_date} onChange={set('due_date')}
                className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500"
              />
            </div>
          </div>

          {err && <p className="text-xs text-red-400">{err}</p>}
        </div>

        <div className="px-5 pb-5 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5 transition-colors">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Centre detail pane ─────────────────────────────────────── */
function CentreDetail({ centre, callerUid, onBack, onUpdate }) {
  const [students, setStudents]       = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [invites, setInvites]         = useState([]);
  const [tab, setTab]                 = useState('students');
  const [loadingStudents, setLS]      = useState(true);
  const [loadingAssign, setLA]        = useState(true);
  const [loadingInvites, setLI]       = useState(false);
  const [showAddStudent, setShowAS]   = useState(false);
  const [showAddAssign, setShowAA]    = useState(false);
  const [confirmStudent, setConfirmStudent]     = useState(null);
  const [confirmAssignment, setConfirmAssignment] = useState(null);

  useEffect(() => {
    setLS(true);
    supabase.rpc('admin_list_centre_students', { p_caller: callerUid, p_centre_id: centre.id })
      .then(({ data }) => { setStudents(data ?? []); setLS(false); });
  }, [centre.id]);

  useEffect(() => {
    setLA(true);
    supabase.rpc('admin_list_centre_assignments', { p_caller: callerUid, p_centre_id: centre.id })
      .then(({ data }) => { setAssignments(data ?? []); setLA(false); });
  }, [centre.id]);

  useEffect(() => {
    if (tab !== 'invites' || invites.length > 0) return;
    setLI(true);
    adminGetCentreInvites(centre.id)
      .then((res) => { setInvites(res.invites ?? []); })
      .catch(() => {})
      .finally(() => setLI(false));
  }, [tab, centre.id, invites.length]);

  async function deleteStudent(s) {
    await supabase.rpc('admin_delete_coaching_student', { p_caller: callerUid, p_id: s.id });
    logChange(ENTITY.COACHING_CENTRE, centre.id, ACTION.UPDATE,
      { action: 'remove_student', student_id: s.id }, 'Admin removed student from coaching centre');
    setStudents(prev => prev.filter(x => x.id !== s.id));
    setConfirmStudent(null);
  }

  async function deleteAssignment(a) {
    await supabase.rpc('admin_delete_coaching_assignment', { p_caller: callerUid, p_id: a.id });
    logChange(ENTITY.COACHING_CENTRE, centre.id, ACTION.DELETE_REQUEST,
      { action: 'delete_assignment', assignment_id: a.id }, 'Admin deleted coaching assignment');
    setAssignments(prev => prev.filter(x => x.id !== a.id));
    setConfirmAssignment(null);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="h-8 w-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors">
          <ChevronRight size={15} className="text-slate-400 rotate-180" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-white">{centre.name}</h2>
            <StatusChip status={centre.status} />
          </div>
          <p className="text-slate-500 text-sm mt-0.5">
            {[centre.city, PLAN_LABELS[centre.plan]].filter(Boolean).join(' · ')}
            {centre.contact_email && ` · ${centre.contact_email}`}
          </p>
        </div>
        <button onClick={onUpdate} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-medium transition-colors">
          <Edit3 size={12} /> Edit
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/5">
        {['students', 'assignments', 'invites'].map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${tab === t ? 'text-white border-b-2 border-primary-500' : 'text-slate-400 hover:text-slate-200'}`}
          >
            {t === 'students'    ? `Students (${students.length})`
             : t === 'assignments' ? `Assignments (${assignments.length})`
             : 'Invites'}
          </button>
        ))}
      </div>

      {/* Students tab */}
      {tab === 'students' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAS(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-colors">
              <Plus size={12} /> Add Student
            </button>
          </div>
          {loadingStudents ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" /></div>
          ) : students.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">No students enrolled yet.</div>
          ) : (
            <div className="space-y-2">
              {students.map(s => (
                <div key={s.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-white/5">
                  <div className="h-8 w-8 rounded-full bg-primary-600/20 border border-primary-500/20 flex items-center justify-center text-primary-400 text-xs font-bold shrink-0">
                    {s.student_name?.[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{s.student_name}</p>
                    <p className="text-slate-500 text-xs truncate">
                      {[s.student_email, s.batch, s.target_exam].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <button onClick={() => setConfirmStudent(s)} className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="Remove student">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Assignments tab */}
      {tab === 'assignments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => setShowAA(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-colors">
              <Plus size={12} /> New Assignment
            </button>
          </div>
          {loadingAssign ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" /></div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">No assignments created yet.</div>
          ) : (
            <div className="space-y-2">
              {assignments.map(a => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-white/5">
                  <div className="h-8 w-8 rounded-xl bg-violet-600/20 border border-violet-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <BookOpen size={13} className="text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{a.title}</p>
                    <p className="text-slate-500 text-xs">
                      {[a.subject, a.exam_type].filter(Boolean).join(' · ')}
                      {a.due_date && ` · Due ${new Date(a.due_date).toLocaleDateString('en-IN')}`}
                    </p>
                    {a.description && <p className="text-slate-400 text-xs mt-1 line-clamp-1">{a.description}</p>}
                  </div>
                  <button onClick={() => setConfirmAssignment(a)} className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors mt-0.5" title="Delete assignment">
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invites tab — read-only */}
      {tab === 'invites' && (
        <div className="space-y-3">
          {loadingInvites ? (
            <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" /></div>
          ) : invites.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">No invite links created yet.</div>
          ) : (
            <div className="space-y-2">
              {invites.map(inv => (
                <div key={inv.id} className="flex items-start gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-white/5">
                  <div className="h-8 w-8 rounded-xl bg-primary-600/20 border border-primary-500/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Link2 size={13} className="text-primary-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs font-mono text-primary-300 tracking-widest">{inv.invite_code}</code>
                      {inv.batch && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 border border-indigo-700/30">{inv.batch}</span>}
                      {!inv.is_active && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-700 text-slate-400">Deactivated</span>}
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">
                      {inv.used_count}{inv.max_uses ? `/${inv.max_uses}` : ''} used
                      {inv.expires_at ? ` · expires ${new Date(inv.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full ${inv.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-700 text-slate-500'}`}>
                    {inv.is_active ? 'Active' : 'Off'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirmStudent}
        onClose={() => setConfirmStudent(null)}
        onConfirm={() => deleteStudent(confirmStudent)}
        title={`Remove ${confirmStudent?.student_name ?? 'student'}?`}
        description="They will be unenrolled from this centre. Their account and progress data are not affected."
        confirmLabel="Remove"
      />
      <ConfirmDialog
        open={!!confirmAssignment}
        onClose={() => setConfirmAssignment(null)}
        onConfirm={() => deleteAssignment(confirmAssignment)}
        title={`Delete "${confirmAssignment?.title}"?`}
        description="This assignment will be permanently removed. Students won't be able to see it."
        confirmLabel="Delete"
      />

      <AnimatePresence>
        {showAddStudent && (
          <StudentModal
            centreId={centre.id}
            callerUid={callerUid}
            onClose={() => setShowAS(false)}
            onSave={(s) => { setStudents(prev => [s, ...prev]); setShowAS(false); }}
          />
        )}
        {showAddAssign && (
          <AssignmentModal
            centreId={centre.id}
            callerUid={callerUid}
            onClose={() => setShowAA(false)}
            onSave={(a) => { setAssignments(prev => [a, ...prev]); setShowAA(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Staff management panel ─────────────────────────────────── */
function InviteStaffModal({ centres, callerUid, onClose, onAdded }) {
  const [mode, setMode] = useState('invite'); // invite | manual

  // Invite-by-email mode
  const [email,    setEmail]    = useState('');
  const [name,     setName]     = useState('');
  const [centreId, setCentreId] = useState(centres[0]?.id ?? '');
  const [role,     setRole]     = useState('instructor');
  const [inviteLink, setInviteLink] = useState('');
  const [copied,     setCopied]     = useState(false);

  // Manual (advanced) mode — existing raw-UID flow, kept as a fallback
  const [manual, setManual] = useState({ uid: '', email: '', name: '', centre_id: centres[0]?.id ?? '', role: 'instructor' });
  const setManualField = (k) => (e) => setManual(f => ({ ...f, [k]: e.target.value }));

  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  async function handleInvite() {
    if (!email.trim() || !centreId) { setErr('Email and centre are required'); return; }
    setSaving(true); setErr('');
    try {
      const data = await createCoachingAdminInvite({ callerUid, centreId, email: email.trim(), name: name.trim(), role });
      setInviteLink(coachingAdminInviteUrl(data.invite_code));
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  function copyLink() {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function shareWhatsApp() {
    const text = encodeURIComponent(`You've been invited to join the coaching portal on EaseWithExam. Sign in with Google using ${email} here: ${inviteLink}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  }

  function shareEmail() {
    const subject = encodeURIComponent('Your EaseWithExam coaching portal invite');
    const body = encodeURIComponent(`You've been invited to join the coaching portal.\n\nSign in with Google using ${email} at this link:\n${inviteLink}`);
    window.open(`mailto:${email}?subject=${subject}&body=${body}`);
  }

  async function handleManualSave() {
    if (!manual.uid.trim() || !manual.name.trim() || !manual.centre_id) {
      setErr('Firebase UID, name, and centre are required'); return;
    }
    setSaving(true); setErr('');
    try {
      const { data, error } = await supabase.rpc('coaching_admin_upsert', {
        p_caller: callerUid,
        p_uid: manual.uid.trim(),
        p_email: manual.email.trim(),
        p_name: manual.name.trim(),
        p_centre_id: manual.centre_id,
        p_role: manual.role,
      });
      if (error) throw error;
      onAdded(data);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.95, y: 12 }} animate={{ scale: 1, y: 0 }}
        className="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-md shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h3 className="font-bold text-white flex items-center gap-2"><UserCog size={16} /> Invite Coaching Staff</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center"><X size={13} className="text-slate-400" /></button>
        </div>

        {!inviteLink && (
          <div className="px-5 pt-4 flex gap-2">
            <button onClick={() => setMode('invite')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${mode === 'invite' ? 'bg-primary-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
              <Mail size={12} /> Invite by Email
            </button>
            <button onClick={() => setMode('manual')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-colors ${mode === 'manual' ? 'bg-primary-600 text-white' : 'bg-white/5 text-slate-400 hover:text-white'}`}>
              <Settings2 size={12} /> Manual (advanced)
            </button>
          </div>
        )}

        {mode === 'invite' ? (
          inviteLink ? (
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                <p className="text-xs text-emerald-400">Invite created for <strong>{email}</strong>. Share this link — they'll get access once they sign in with that email.</p>
              </div>
              <div className="flex items-center gap-2 bg-slate-800 border border-white/10 rounded-xl px-3 py-2.5">
                <code className="text-xs text-primary-300 flex-1 truncate">{inviteLink}</code>
                <button onClick={copyLink} className="shrink-0 p-1.5 rounded-lg hover:bg-white/10 text-slate-300">
                  {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={shareWhatsApp} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-600/30 text-emerald-400 text-xs font-semibold hover:bg-emerald-600/30 transition-colors">
                  <MessageCircle size={13} /> WhatsApp
                </button>
                <button onClick={shareEmail} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-blue-600/20 border border-blue-600/30 text-blue-400 text-xs font-semibold hover:bg-blue-600/30 transition-colors">
                  <Mail size={13} /> Email
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Email *</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="coach@centre.com"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors" />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Name <span className="text-slate-600">(optional)</span></label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dr. Priya Sharma"
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Centre *</label>
                  <select value={centreId} onChange={(e) => setCentreId(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                    {centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Role</label>
                  <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                    <option value="instructor">Instructor</option>
                    <option value="centre_admin">Centre Admin</option>
                  </select>
                </div>
              </div>
              {err && <p className="text-xs text-red-400">{err}</p>}
            </div>
          )
        ) : (
          <div className="p-5 space-y-3">
            <p className="text-[11px] text-slate-500 -mt-1">Requires the person's Firebase UID (from Firebase Console) — use the email invite above unless you specifically need this.</p>
            {[
              { key: 'uid',   label: 'Firebase UID *', placeholder: 'abcXYZ123…' },
              { key: 'email', label: 'Email',           placeholder: 'coach@centre.com', type: 'email' },
              { key: 'name',  label: 'Full Name *',     placeholder: 'Dr. Priya Sharma' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <label className="block text-xs text-slate-400 mb-1">{label}</label>
                <input value={manual[key]} onChange={setManualField(key)} type={type ?? 'text'} placeholder={placeholder}
                  className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors" />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Centre *</label>
                <select value={manual.centre_id} onChange={setManualField('centre_id')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                  {centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Role</label>
                <select value={manual.role} onChange={setManualField('role')} className="w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary-500">
                  <option value="instructor">Instructor</option>
                  <option value="centre_admin">Centre Admin</option>
                </select>
              </div>
            </div>
            {err && <p className="text-xs text-red-400">{err}</p>}
          </div>
        )}

        <div className="px-5 pb-5 flex justify-end gap-2">
          {inviteLink ? (
            <button onClick={onClose} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700">Done</button>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 rounded-xl border border-white/10 text-slate-300 text-sm hover:bg-white/5">Cancel</button>
              <button onClick={mode === 'invite' ? handleInvite : handleManualSave} disabled={saving} className="px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 disabled:opacity-50">
                {saving ? 'Saving…' : mode === 'invite' ? 'Create Invite Link' : 'Add Staff'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function StaffPanel({ centres, callerUid }) {
  const [staff, setStaff]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);

  async function loadStaff() {
    setLoading(true);
    const { data } = await supabase.rpc('coaching_admin_list', { p_caller: callerUid });
    setStaff(Array.isArray(data) ? data : []);
    setLoading(false);
  }

  useEffect(() => { loadStaff(); }, []);

  async function toggleActive(member) {
    await supabase.rpc('coaching_admin_toggle_active', {
      p_caller: callerUid, p_target_uid: member.uid, p_active: !member.is_active,
    });
    setStaff(prev => prev.map(s => s.uid === member.uid ? { ...s, is_active: !s.is_active } : s));
  }

  async function deleteMember(uid) {
    if (!window.confirm('Remove this staff member?')) return;
    await supabase.rpc('coaching_admin_delete', { p_caller: callerUid, p_target_uid: uid });
    setStaff(prev => prev.filter(s => s.uid !== uid));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">{staff.length} staff member{staff.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 transition-colors">
          <Plus size={12} /> Invite Staff
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><div className="animate-spin h-6 w-6 border-2 border-primary-500 border-t-transparent rounded-full" /></div>
      ) : staff.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          <UserCog size={28} className="text-slate-600 mx-auto mb-2" />
          No coaching staff added yet.
        </div>
      ) : (
        <div className="space-y-2">
          {staff.map(s => (
            <div key={s.uid} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-white/5">
              <div className="h-9 w-9 rounded-full bg-primary-600/20 border border-primary-500/20 flex items-center justify-center text-primary-400 text-xs font-bold shrink-0">
                {s.name?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-medium">{s.name}</p>
                  {s.role === 'centre_admin' && <ShieldCheck size={12} className="text-amber-400" />}
                </div>
                <p className="text-slate-500 text-xs truncate">
                  {[s.email, s.centre_name, s.role?.replace('_', ' ')].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => toggleActive(s)} title={s.is_active ? 'Deactivate' : 'Activate'} className={`p-1.5 rounded-lg transition-colors ${s.is_active ? 'text-emerald-400 hover:bg-emerald-500/10' : 'text-slate-500 hover:bg-white/5'}`}>
                  {s.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                </button>
                <button onClick={() => deleteMember(s.uid)} className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <InviteStaffModal
            centres={centres}
            callerUid={callerUid}
            onClose={() => setShowAdd(false)}
            onAdded={(s) => { setStaff(prev => [s, ...prev]); setShowAdd(false); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────────── */
export default function AdminCoaching() {
  const [centres, setCentres]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [selected, setSelected]       = useState(null);
  const [showAdd, setShowAdd]         = useState(false);
  const [editTarget, setEditTarget]   = useState(null);
  const [mainTab, setMainTab]         = useState('centres'); // centres | staff
  const callerUid = (() => {
    try { return JSON.parse(sessionStorage.getItem(Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_')) || '') || '{}')?.uid; } catch { return ''; }
  })();

  useEffect(() => {
    supabase.rpc('admin_list_coaching_centres', { p_caller: callerUid })
      .then(({ data }) => { setCentres(data ?? []); setLoading(false); });
  }, []);

  const filtered = centres.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.city?.toLowerCase().includes(search.toLowerCase())
  );

  function handleSaved(centre) {
    setCentres(prev => {
      const idx = prev.findIndex(c => c.id === centre.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = centre; return next; }
      return [centre, ...prev];
    });
    setShowAdd(false);
    setEditTarget(null);
    setSelected(centre);
  }

  // Detail view
  if (selected) {
    return (
      <CentreDetail
        centre={selected}
        callerUid={callerUid}
        onBack={() => setSelected(null)}
        onUpdate={() => setEditTarget(selected)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Coaching Management</h1>
          <p className="text-slate-400 text-sm mt-1">B2B partner centres, staff, students & assignments</p>
        </div>
        {mainTab === 'centres' && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors"
          >
            <Plus size={15} /> Add Centre
          </button>
        )}
      </div>

      {/* Main tabs */}
      <div className="flex gap-1 border-b border-white/5 pb-0">
        {[['centres', Building2, 'Centres'], ['staff', UserCog, 'Staff']].map(([tab, Icon, label]) => (
          <button
            key={tab}
            onClick={() => setMainTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-colors border-b-2 -mb-px ${
              mainTab === tab ? 'text-white border-primary-500' : 'text-slate-400 border-transparent hover:text-slate-200'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {mainTab === 'staff' && <StaffPanel centres={centres} callerUid={callerUid} />}

      {mainTab === 'centres' && (<>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total Centres', value: centres.length, icon: Building2, color: 'text-primary-400 bg-primary-500/10 border-primary-500/20' },
          { label: 'Active', value: centres.filter(c => c.status === 'active').length, icon: CheckCircle2, color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
          { label: 'Enterprise', value: centres.filter(c => c.plan === 'enterprise').length, icon: Users, color: 'text-violet-400 bg-violet-500/10 border-violet-500/20' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-slate-800/50 border border-white/5 rounded-2xl p-5 flex items-center gap-4">
            <div className={`h-10 w-10 rounded-xl border flex items-center justify-center ${color}`}>
              <Icon size={18} />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{value}</p>
              <p className="text-slate-400 text-xs">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or city…"
          className="w-full bg-slate-800 border border-white/10 rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Centre list */}
      {loading ? (
        <div className="flex justify-center py-20"><div className="animate-spin h-8 w-8 border-2 border-primary-500 border-t-transparent rounded-full" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20">
          <Building2 size={36} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-sm">{search ? 'No centres match your search.' : 'No coaching centres yet. Add one to get started.'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((c, i) => (
            <motion.button
              key={c.id}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => setSelected(c)}
              className="w-full flex items-center gap-4 px-5 py-4 rounded-2xl bg-slate-800/50 border border-white/5 hover:border-primary-500/30 hover:bg-slate-800 transition-all text-left"
            >
              <div className="h-10 w-10 rounded-xl bg-primary-600/20 border border-primary-500/20 flex items-center justify-center shrink-0">
                <Building2 size={18} className="text-primary-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-white font-semibold text-sm">{c.name}</p>
                  <StatusChip status={c.status} />
                </div>
                <p className="text-slate-500 text-xs truncate">
                  {[c.city, PLAN_LABELS[c.plan], c.contact_email].filter(Boolean).join(' · ')}
                </p>
              </div>
              <ChevronRight size={16} className="text-slate-500 shrink-0" />
            </motion.button>
          ))}
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {(showAdd || editTarget) && (
          <CentreModal
            centre={editTarget}
            callerUid={callerUid}
            onClose={() => { setShowAdd(false); setEditTarget(null); }}
            onSave={handleSaved}
          />
        )}
      </AnimatePresence>
      </>)}
    </div>
  );
}
