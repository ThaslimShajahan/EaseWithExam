import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserCog, Plus, Trash2, ToggleLeft, ToggleRight,
  Shield, ShieldCheck, Save, X, Loader2, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ROLE_KEY } from './AdminGuard';
import StudentPicker from '../components/admin/StudentPicker';

const isSuperAdmin = () => sessionStorage.getItem(ROLE_KEY) === 'superadmin';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* All reads/writes go through SECURITY DEFINER RPCs — the anon
   key cannot touch the admins table directly. */

function Badge({ role }) {
  return role === 'superadmin'
    ? <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 border border-violet-500/30"><ShieldCheck size={10} /> Superadmin</span>
    : <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30"><Shield size={10} /> Admin</span>;
}

function AddModal({ callerUid, onClose, onSaved }) {
  const [form, setForm] = useState({ uid: '', email: '', name: '', passcode: '', role: 'admin' });
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');
  const [showPc, setShowPc] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);

  const save = async () => {
    if (!form.uid || !form.email || !form.passcode) { setErr('UID, email and passcode are required.'); return; }
    if (form.passcode.length !== 6 || !/^\d+$/.test(form.passcode)) { setErr('Passcode must be exactly 6 digits.'); return; }
    setSaving(true);
    setErr('');
    const { data, error } = await supabase.rpc('admin_upsert', {
      p_caller:   callerUid,
      p_uid:      form.uid.trim(),
      p_email:    form.email.trim(),
      p_name:     form.name.trim() || null,
      p_role:     form.role,
      p_passcode: form.passcode,
    });
    setSaving(false);
    if (error || data?.error) { setErr((error?.message || data?.error)); return; }
    onSaved();
  };

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        className="bg-slate-800 rounded-2xl w-full max-w-md p-6 border border-white/10 space-y-4"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold text-lg">Add Admin</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>

        <div className="space-y-1.5">
          <label className="text-slate-400 text-xs block">Quick-fill from an existing student <span className="text-slate-600">(optional)</span></label>
          <StudentPicker
            value={selectedStudent}
            onSelect={(u) => {
              setSelectedStudent(u);
              if (u) setForm(p => ({ ...p, uid: u.firebase_uid, email: u.email || p.email, name: u.display_name || p.name }));
            }}
            placeholder="Search if they already have a student account…"
          />
          <p className="text-[10px] text-slate-600">If they've never used the app, enter the Firebase UID manually below (found in Firebase Console → Authentication → Users).</p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Firebase UID *</label>
            <input value={form.uid} onChange={f('uid')} placeholder="e.g. xYz1234AbCd…"
              className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 font-mono" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Email *</label>
            <input value={form.email} onChange={f('email')} type="email" placeholder="admin@example.com"
              className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Display Name</label>
            <input value={form.name} onChange={f('name')} placeholder="e.g. Riya (Content Admin)"
              className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">6-Digit Passcode *</label>
            <div className="relative">
              <input
                value={form.passcode}
                onChange={e => setForm(p => ({ ...p, passcode: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                type={showPc ? 'text' : 'password'}
                maxLength={6} placeholder="••••••"
                className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500 font-mono tracking-widest pr-10"
              />
              <button type="button" onClick={() => setShowPc(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {showPc ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-slate-600 text-[10px] mt-1">Stored as SHA-256 hash — never saved in plaintext</p>
          </div>
          <div>
            <label className="text-slate-400 text-xs mb-1 block">Role</label>
            <select value={form.role} onChange={f('role')}
              className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-primary-500">
              <option value="admin">Admin</option>
              <option value="superadmin">Superadmin</option>
            </select>
          </div>
        </div>

        {err && <p className="text-red-400 text-xs">{err}</p>}

        <div className="flex gap-2 pt-2">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save Admin
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function EditPasscodeModal({ admin, callerUid, onClose, onSaved }) {
  const [pc,     setPc]     = useState('');
  const [showPc, setShowPc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState('');

  const save = async () => {
    if (pc.length !== 6 || !/^\d+$/.test(pc)) { setErr('Passcode must be exactly 6 digits.'); return; }
    setSaving(true);
    const { data, error } = await supabase.rpc('admin_change_passcode', {
      p_caller:     callerUid,
      p_target_uid: admin.uid,
      p_passcode:   pc,
    });
    setSaving(false);
    if (error || data?.error) { setErr(error?.message || data?.error); return; }
    onSaved();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div
        className="bg-slate-800 rounded-2xl w-full max-w-sm p-6 border border-white/10 space-y-4"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-white font-bold">Change Passcode</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        <p className="text-slate-400 text-sm">Changing passcode for <strong className="text-white">{admin.name || admin.email}</strong></p>
        <div className="relative">
          <input
            value={pc}
            onChange={e => setPc(e.target.value.replace(/\D/g, '').slice(0, 6))}
            type={showPc ? 'text' : 'password'}
            placeholder="New 6-digit passcode"
            className="w-full bg-slate-700 border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono tracking-widest text-lg focus:outline-none focus:border-primary-500 pr-10"
          />
          <button type="button" onClick={() => setShowPc(p => !p)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
            {showPc ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {err && <p className="text-red-400 text-xs">{err}</p>}
        <p className="text-slate-600 text-[10px]">Stored as SHA-256 hash — never saved in plaintext</p>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm">Cancel</button>
          <button onClick={save} disabled={saving}
            className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Update
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminAdmins() {
  const [admins,  setAdmins]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editPc,  setEditPc]  = useState(null);

  const superadmin = isSuperAdmin();
  const callerUid  = getCallerUid();

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list', { p_caller: callerUid });
    if (!error && Array.isArray(data)) setAdmins(data);
    else setAdmins([]);
    setLoading(false);
  };

  useEffect(() => { if (callerUid) load(); }, [callerUid]);

  if (!superadmin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-500 gap-3">
        <ShieldCheck size={40} />
        <p className="text-sm">Only superadmins can manage admin accounts.</p>
      </div>
    );
  }

  const toggleActive = async (admin) => {
    const { data } = await supabase.rpc('admin_toggle_active', {
      p_caller:     callerUid,
      p_target_uid: admin.uid,
      p_active:     !admin.is_active,
    });
    if (data?.error) { alert(data.error); return; }
    load();
  };

  const deleteAdmin = async (admin) => {
    if (!window.confirm(`Remove ${admin.name || admin.email} from admins?`)) return;
    const { data } = await supabase.rpc('admin_delete', { p_caller: callerUid, p_target_uid: admin.uid });
    if (data?.error) { alert(data.error); return; }
    load();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <UserCog size={22} className="text-primary-400" /> Admin Accounts
          </h1>
          <p className="text-slate-400 text-sm mt-1">Manage who can access the admin portal</p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-xl text-sm font-semibold transition-colors">
          <Plus size={15} /> Add Admin
        </button>
      </div>

      {/* Security note */}
      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-4 py-3 text-xs text-emerald-300 flex items-start gap-2">
        <ShieldCheck size={13} className="shrink-0 mt-0.5" />
        Passcodes are stored as SHA-256 hashes. The anon key cannot read this table directly — all access goes through server-side RPCs.
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-slate-500 text-sm py-8">
          <Loader2 size={16} className="animate-spin" /> Loading admins…
        </div>
      ) : (
        <div className="space-y-2">
          {admins.map((a) => (
            <motion.div
              key={a.uid}
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              className={`bg-slate-800 rounded-2xl p-4 border flex items-center gap-4 ${a.is_active ? 'border-white/5' : 'border-red-500/20 opacity-60'}`}
            >
              <div className="h-10 w-10 rounded-xl bg-slate-700 flex items-center justify-center shrink-0">
                {a.role === 'superadmin'
                  ? <ShieldCheck size={18} className="text-violet-400" />
                  : <Shield size={18} className="text-primary-400" />
                }
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-semibold text-sm">{a.name || '(no name)'}</span>
                  <Badge role={a.role} />
                  {!a.is_active && <span className="text-[10px] text-red-400 font-bold bg-red-400/10 px-2 py-0.5 rounded-full">Disabled</span>}
                </div>
                <p className="text-slate-400 text-xs mt-0.5 truncate">{a.email}</p>
                <p className="text-slate-600 text-[10px] font-mono mt-0.5 truncate">{a.uid}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => setEditPc(a)}
                  className="text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors">
                  Change Code
                </button>
                {a.role !== 'superadmin' && (
                  <>
                    <button onClick={() => toggleActive(a)}
                      className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/5 transition-colors"
                      title={a.is_active ? 'Disable' : 'Enable'}>
                      {a.is_active
                        ? <ToggleRight size={20} className="text-emerald-400" />
                        : <ToggleLeft size={20} />
                      }
                    </button>
                    <button onClick={() => deleteAdmin(a)}
                      className="text-slate-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-red-400/10 transition-colors">
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <AddModal
            callerUid={callerUid}
            onClose={() => setShowAdd(false)}
            onSaved={() => { setShowAdd(false); load(); }}
          />
        )}
        {editPc && (
          <EditPasscodeModal
            admin={editPc}
            callerUid={callerUid}
            onClose={() => setEditPc(null)}
            onSaved={() => { setEditPc(null); load(); }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
