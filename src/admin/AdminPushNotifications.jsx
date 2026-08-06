import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, Send, Users, User, CheckCircle2, Loader2, X, AlertTriangle, MessageCircle, Smartphone } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { createNotification, broadcastNotification } from '../lib/notifications';
import StudentPicker from '../components/admin/StudentPicker';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const TYPES = [
  { value: 'info',        label: 'Info',        color: 'bg-blue-100 text-blue-700' },
  { value: 'success',     label: 'Success',     color: 'bg-emerald-100 text-emerald-700' },
  { value: 'warning',     label: 'Warning',     color: 'bg-amber-100 text-amber-700' },
  { value: 'achievement', label: 'Achievement', color: 'bg-violet-100 text-violet-700' },
  { value: 'assignment',  label: 'Assignment',  color: 'bg-orange-100 text-orange-700' },
];

function NotifCard({ notif }) {
  const type = TYPES.find(t => t.value === notif.type) || TYPES[0];
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-slate-800/50 border border-white/5">
      <div className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 ${type.color}`}>{type.label}</div>
      <div className="flex-1 min-w-0">
        <p className="text-white text-sm font-semibold truncate">{notif.title}</p>
        <p className="text-slate-400 text-xs mt-0.5 line-clamp-1">{notif.body}</p>
        <p className="text-slate-600 text-[10px] mt-1">
          {notif.user_id ? `→ User: ${notif.user_id}` : '→ Broadcast (all users)'}
          {' · '}
          {new Date(notif.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
    </div>
  );
}

export default function AdminPushNotifications() {
  const callerUid = getCallerUid();
  const [form, setForm] = useState({
    title:      '',
    body:       '',
    type:       'info',
    target:     'all',   // all | user
    user_id:    '',
    url:        '',
    expires_in_days: '',
  });
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [channels, setChannels] = useState({ inapp: true, push: true, whatsapp: false });
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const [pushResult, setPushResult] = useState(null);
  const [waResult,   setWaResult]   = useState(null);
  const [err,       setErr]       = useState('');
  const [history,   setHistory]   = useState([]);
  const [loadingH,  setLoadingH]  = useState(true);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    // in_app_notifications has RLS enabled with zero direct policies by design
    // (same admin-only lockdown as the `admins` table) — a direct .from(...)
    // query always silently returned 0 rows, so this history panel was
    // permanently empty even though sends themselves worked fine.
    supabase.rpc('admin_get_notification_history', { p_caller: callerUid, p_limit: 30 })
      .then(({ data }) => { setHistory(data ?? []); setLoadingH(false); });
  }, [callerUid]);

  async function handleSend() {
    if (!form.title.trim() || !form.body.trim()) { setErr('Title and message are required'); return; }
    if (form.target === 'user' && !form.user_id.trim()) { setErr('Firebase UID is required for targeted send'); return; }
    setSending(true); setErr(''); setSent(false); setWaResult(null);
    try {
      const { error } = await supabase.rpc('admin_send_notification', {
        p_caller:          callerUid,
        p_title:           form.title.trim(),
        p_body:            form.body.trim(),
        p_type:            form.type,
        p_user_id:         form.target === 'user' ? form.user_id.trim() : null,
        p_url:             form.url.trim() || null,
        p_expires_in_days: form.expires_in_days ? parseInt(form.expires_in_days) : null,
      });
      if (error) throw error;

      // Also write into user_notifications so it shows up in the student header bell
      // (in_app_notifications only feeds the admin history panel + Notifications page "In-App" tab)
      if (form.target === 'user') {
        await createNotification(form.user_id.trim(), form.type, form.title.trim(), form.body.trim(), form.url.trim() || null);
      } else {
        await broadcastNotification(callerUid, form.type, form.title.trim(), form.body.trim(), form.url.trim() || null);
      }

      const newNotif = {
        id:         Date.now(),
        title:      form.title,
        body:       form.body,
        type:       form.type,
        user_id:    form.target === 'user' ? form.user_id : null,
        created_at: new Date().toISOString(),
      };
      setHistory(prev => [newNotif, ...prev]);

      // Device push (VAPID)
      if (channels.push) {
        try {
          const fnUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-push`;
          const pushRes = await fetch(fnUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify({
              caller_uid: callerUid,
              title:      form.title.trim(),
              body:       form.body.trim(),
              user_id:    form.target === 'user' ? form.user_id.trim() : undefined,
              url:        form.url.trim() || '/',
            }),
          });
          setPushResult(await pushRes.json());
        } catch {
          setPushResult({ sent: 0, failed: 0, error: 'send-push unreachable' });
        }
      }

      // WhatsApp via Twilio
      if (channels.whatsapp) {
        try {
          const waUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-alert`;
          const waRes = await fetch(waUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
            body: JSON.stringify(
              form.target === 'user'
                ? { to: form.user_id.trim(), message: `${form.title.trim()}\n\n${form.body.trim()}` }
                : { broadcast: true, caller_uid: callerUid, message: `*${form.title.trim()}*\n\n${form.body.trim()}` }
            ),
          });
          setWaResult(await waRes.json());
        } catch {
          setWaResult({ error: 'whatsapp-alert unreachable' });
        }
      }

      setSent(true);
      setForm(f => ({ ...f, title: '', body: '', user_id: '' }));
      setSelectedStudent(null);
      setTimeout(() => { setSent(false); setPushResult(null); }, 6000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Bell size={22} /> Push Notifications
        </h1>
        <p className="text-slate-400 text-sm mt-1">Send in-app + FCM device push notifications to all students or a specific user</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Compose */}
        <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-white text-base flex items-center gap-2"><Send size={15} /> Compose</h2>

          {/* Title */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notification Title *</label>
            <input value={form.title} onChange={set('title')} maxLength={80}
              placeholder="e.g. 🎯 NEET 2025 exam date announced!"
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 transition-colors" />
            <p className="text-[10px] text-slate-600 mt-1">{form.title.length}/80</p>
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Message *</label>
            <textarea value={form.body} onChange={set('body')} rows={3} maxLength={200}
              placeholder="Short message students will see in the notification…"
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none transition-colors" />
            <p className="text-[10px] text-slate-600 mt-1">{form.body.length}/200</p>
          </div>

          {/* Type */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">Notification Type</label>
            <div className="flex flex-wrap gap-2">
              {TYPES.map(t => (
                <button key={t.value} onClick={() => setForm(f => ({ ...f, type: t.value }))}
                  className={['px-3 py-1 rounded-lg text-xs font-semibold border transition-colors', form.type === t.value ? `${t.color} border-transparent` : 'border-white/10 text-slate-400 hover:bg-white/5'].join(' ')}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Target */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">Send To</label>
            <div className="grid grid-cols-2 gap-2">
              {[['all', Users, 'All Students'], ['user', User, 'Specific User']].map(([val, Icon, label]) => (
                <button key={val} onClick={() => setForm(f => ({ ...f, target: val }))}
                  className={['flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors', form.target === val ? 'bg-primary-600 border-primary-600 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5'].join(' ')}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>
          </div>

          {form.target === 'user' && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Student</label>
              <StudentPicker
                value={selectedStudent}
                onSelect={(u) => { setSelectedStudent(u); setForm(f => ({ ...f, user_id: u?.firebase_uid ?? '' })); }}
                placeholder="Search by name or email…"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Link URL <span className="text-slate-600">(optional)</span></label>
              <input value={form.url} onChange={set('url')} placeholder="/dashboard"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Expires in <span className="text-slate-600">(days)</span></label>
              <input value={form.expires_in_days} onChange={set('expires_in_days')} type="number" min="1" max="365" placeholder="Never"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            </div>
          </div>

          {/* Channels */}
          <div>
            <label className="block text-xs text-slate-400 mb-2">Delivery Channels</label>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'inapp',    icon: Bell,          label: 'In-App',   locked: true  },
                { key: 'push',     icon: Smartphone,    label: 'Device Push'             },
                { key: 'whatsapp', icon: MessageCircle, label: 'WhatsApp'                },
              ].map(({ key, icon: Icon, label, locked }) => {
                const on = channels[key];
                return (
                  <button
                    key={key}
                    disabled={locked}
                    onClick={() => !locked && setChannels(c => ({ ...c, [key]: !c[key] }))}
                    className={[
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors',
                      on ? 'bg-primary-600 border-primary-600 text-white' : 'border-white/10 text-slate-400 hover:bg-white/5',
                      locked ? 'opacity-60 cursor-default' : '',
                    ].join(' ')}
                  >
                    <Icon size={12} /> {label} {locked && '(always)'}
                  </button>
                );
              })}
            </div>
            {channels.whatsapp && (
              <p className="text-[10px] text-amber-400 mt-1.5">
                WhatsApp only reaches students who saved their number in Profile → Notifications.
              </p>
            )}
          </div>

          {err && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertTriangle size={13} className="text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{err}</p>
            </div>
          )}

          <AnimatePresence>
            {sent && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className="space-y-1.5">
                <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
                  <CheckCircle2 size={13} className="text-emerald-400" />
                  <p className="text-xs text-emerald-400 font-semibold">In-app notification saved successfully!</p>
                </div>
                {pushResult && (
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 border text-xs font-semibold ${pushResult.error ? 'bg-red-500/10 border-red-500/20 text-red-400' : pushResult.sent > 0 ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                    <Smartphone size={13} className="shrink-0" />
                    {pushResult.error
                      ? `Device push error: ${pushResult.error}`
                      : pushResult.sent > 0
                        ? `Device push: ${pushResult.sent}/${pushResult.total} delivered`
                        : (pushResult.message ?? 'Device push: no subscriptions found')}
                  </div>
                )}
                {waResult && (
                  <div className={`flex items-center gap-2 rounded-xl px-3 py-2 border text-xs font-semibold ${waResult.error ? 'bg-red-500/10 border-red-500/20 text-red-400' : waResult.sent > 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : 'bg-amber-500/10 border-amber-500/20 text-amber-400'}`}>
                    <MessageCircle size={13} className="shrink-0" />
                    {waResult.error
                      ? `WhatsApp error: ${waResult.error}`
                      : waResult.sent > 0
                        ? `WhatsApp: sent to ${waResult.sent}${waResult.total ? `/${waResult.total}` : ''} users`
                        : (waResult.message ?? 'WhatsApp: no opted-in users found')}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={handleSend} disabled={sending}
            className="w-full py-3 rounded-xl bg-primary-600 text-white font-bold text-sm hover:bg-primary-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
            {sending ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : <><Send size={15} /> Send Notification</>}
          </button>
        </div>

        {/* History */}
        <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6 space-y-4">
          <h2 className="font-bold text-white text-base">Recent Notifications</h2>
          {loadingH ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-primary-500" /></div>
          ) : history.length === 0 ? (
            <div className="text-center py-12">
              <Bell size={28} className="text-slate-600 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">No notifications sent yet</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {history.map(n => <NotifCard key={n.id} notif={n} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
