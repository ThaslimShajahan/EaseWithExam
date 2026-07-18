import { useEffect, useState } from 'react';
import { Bell, BellOff, Loader2, Check, MessageCircle, Phone } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  requestPushPermission, disablePush,
  getNotificationPrefs, updateNotificationPrefs,
} from '../../lib/notifications';

function Field({ label, hint, icon: Icon, iconClass, value, onChange, placeholder, onSave, saving, saved }) {
  return (
    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
      <div className="flex items-center gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${iconClass}`}>
          <Icon size={16} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{hint}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <input
          type="tel"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-xl outline-none focus:border-primary-400 transition-colors"
        />
        <button
          onClick={onSave}
          disabled={saving}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
            saved
              ? 'bg-emerald-500 text-white'
              : 'bg-primary-600 text-white hover:bg-primary-700'
          }`}
        >
          {saved ? <><Check size={13} /> Saved</> : saving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
        </button>
      </div>
      {value && saved && (
        <p className="text-xs text-emerald-600 font-medium">✓ Active for {value}</p>
      )}
    </div>
  );
}

export default function NotificationSettings() {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  const [prefs,    setPrefs]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [toggling, setToggling] = useState(false);
  const [waNum,    setWaNum]    = useState('');
  const [phoneNum, setPhoneNum] = useState('');
  const [waSaved,  setWaSaved]  = useState(false);
  const [phSaved,  setPhSaved]  = useState(false);

  useEffect(() => {
    if (!uid) return;
    getNotificationPrefs(uid).then((p) => {
      setPrefs(p);
      setWaNum(p?.whatsapp_number || '');
      setPhoneNum(p?.phone_number  || '');
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [uid]);

  const supported = 'Notification' in window;
  const pushOn    = prefs?.push_enabled && Notification.permission === 'granted';

  const handlePushToggle = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      if (pushOn) {
        await disablePush(uid);
        setPrefs(p => ({ ...p, push_enabled: false, push_endpoint: null }));
      } else {
        const result = await requestPushPermission(uid);
        if (result.granted) setPrefs(p => ({ ...p, push_enabled: true }));
      }
    } finally { setToggling(false); }
  };

  const saveWhatsApp = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      await updateNotificationPrefs(uid, {
        whatsapp_number:  waNum.trim(),
        whatsapp_enabled: !!waNum.trim(),
      });
      setPrefs(p => ({ ...p, whatsapp_number: waNum.trim(), whatsapp_enabled: !!waNum.trim() }));
      setWaSaved(true);
      setTimeout(() => setWaSaved(false), 2000);
    } finally { setToggling(false); }
  };

  const savePhone = async () => {
    if (!uid) return;
    setToggling(true);
    try {
      await updateNotificationPrefs(uid, {
        phone_number:  phoneNum.trim(),
        call_enabled:  !!phoneNum.trim(),
      });
      setPrefs(p => ({ ...p, phone_number: phoneNum.trim(), call_enabled: !!phoneNum.trim() }));
      setPhSaved(true);
      setTimeout(() => setPhSaved(false), 2000);
    } finally { setToggling(false); }
  };

  if (loading) return <div className="h-20 animate-pulse bg-slate-50 rounded-2xl" />;

  return (
    <div className="space-y-4">
      {/* Push toggle */}
      <div className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <div className={`h-9 w-9 rounded-xl flex items-center justify-center ${pushOn ? 'bg-primary-50' : 'bg-slate-100'}`}>
            {pushOn ? <Bell size={16} className="text-primary-600" /> : <BellOff size={16} className="text-slate-400" />}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Push Notifications</p>
            <p className="text-xs text-slate-500">
              {!supported ? 'Not supported in this browser' : pushOn ? 'Active — study reminders enabled' : 'Enable to get daily study reminders'}
            </p>
          </div>
        </div>
        {supported && (
          <button
            onClick={handlePushToggle}
            disabled={toggling}
            className={`relative h-6 w-11 rounded-full transition-colors ${pushOn ? 'bg-primary-600' : 'bg-slate-300'}`}
          >
            {toggling
              ? <Loader2 size={12} className="absolute top-1 left-2.5 animate-spin text-white" />
              : <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${pushOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
            }
          </button>
        )}
      </div>

      {/* WhatsApp */}
      <Field
        label="WhatsApp Alerts"
        hint="Weekly reports, exam alerts, announcements"
        icon={MessageCircle}
        iconClass="bg-emerald-50 text-emerald-600"
        value={waNum}
        onChange={e => setWaNum(e.target.value)}
        placeholder="+91 9876543210"
        onSave={saveWhatsApp}
        saving={toggling}
        saved={waSaved}
      />

      {/* Call number */}
      <Field
        label="Phone / Call Number"
        hint="Preferred number for important calls"
        icon={Phone}
        iconClass="bg-blue-50 text-blue-600"
        value={phoneNum}
        onChange={e => setPhoneNum(e.target.value)}
        placeholder="+91 9876543210"
        onSave={savePhone}
        saving={toggling}
        saved={phSaved}
      />
    </div>
  );
}
