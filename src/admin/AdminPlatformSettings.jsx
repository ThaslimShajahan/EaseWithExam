import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, Upload, Image, Cookie, Palette, Globe, CheckCircle2, Loader2, AlertTriangle, Trash2 } from 'lucide-react';
import { supabase, adminClearAllData } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { invalidatePlatformSettings } from '../hooks/usePlatformSettings';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

/* ── Danger zone — moved here from Admin > Publish > Paper Gen so it lives
   alongside other platform-wide settings instead of buried in a content tool. ── */
function DangerZone({ callerUid }) {
  const [open,     setOpen]     = useState(false);
  const [clearing, setClearing] = useState(false);
  const [done,     setDone]     = useState(false);
  const [err,      setErr]      = useState('');

  const handleClear = async () => {
    if (!confirm('This will permanently delete ALL knowledge base, PYQ questions, published tests, study notes, exam blueprints, caches, and topic data. Your Syllabus structure (Admin > Syllabus) is kept. This cannot be undone. Proceed?')) return;
    setClearing(true); setErr('');
    try {
      await adminClearAllData(callerUid);
      setDone(true);
    } catch (e) {
      setErr(`Clear failed: ${e.message}`);
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="bg-red-950/30 border border-red-800/40 rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-red-900/20 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <Trash2 size={15} className="text-red-400" />
          <div>
            <p className="text-sm font-semibold text-red-300">Danger Zone</p>
            <p className="text-xs text-red-600 mt-0.5">Clear all uploaded content platform-wide</p>
          </div>
        </div>
        <span className="text-red-700 text-xs">{open ? '▲' : '▼'}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 pt-2 border-t border-red-800/30 space-y-3">
              <p className="text-xs text-red-400 leading-relaxed">
                Deletes everything: <code className="bg-red-900/30 px-1 rounded">knowledge_base</code>, <code className="bg-red-900/30 px-1 rounded">pyq_questions</code>, <code className="bg-red-900/30 px-1 rounded">published_tests</code>, <code className="bg-red-900/30 px-1 rounded">question_cache</code>, <code className="bg-red-900/30 px-1 rounded">topic_frequency</code>, <code className="bg-red-900/30 px-1 rounded">study_notes</code>, <code className="bg-red-900/30 px-1 rounded">exam_blueprints</code>. Your Syllabus structure is kept. Use this before uploading a fresh content set.
              </p>
              {err && <p className="text-xs text-red-300">{err}</p>}
              {done ? (
                <p className="text-xs text-emerald-400 font-semibold">All data cleared successfully.</p>
              ) : (
                <button onClick={handleClear} disabled={clearing}
                  className="flex items-center gap-2 px-4 py-2 bg-red-700 hover:bg-red-600 disabled:opacity-40 rounded-xl text-white text-xs font-semibold transition-colors">
                  {clearing ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {clearing ? 'Clearing…' : 'Clear All Data'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingRow({ icon: Icon, label, hint, children }) {
  return (
    <div className="flex items-start gap-4 py-5 border-b border-white/5 last:border-0">
      <div className="h-9 w-9 rounded-xl bg-white/5 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={16} className="text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-white mb-0.5">{label}</p>
        {hint && <p className="text-xs text-slate-500 mb-3">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

export default function AdminPlatformSettings() {
  const callerUid = getCallerUid();
  const logoRef   = useRef();
  const avatarRef = useRef();

  const [settings,    setSettings]    = useState({});
  const [loading,     setLoading]     = useState(true);
  const [savingKey,   setSavingKey]   = useState('');
  const [saved,       setSaved]       = useState('');
  const [err,         setErr]         = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [localVals,   setLocalVals]   = useState({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('admin_get_platform_settings', { p_caller: callerUid });
      setSettings(data || {});
      setLocalVals(data || {});
      setLoading(false);
    })();
  }, []);

  async function saveSetting(key, value) {
    setSavingKey(key); setErr('');
    try {
      const { error } = await supabase.rpc('admin_set_platform_setting', {
        p_caller: callerUid, p_key: key, p_value: value,
      });
      if (error) throw error;
      logChange(ENTITY.SYSTEM, key, ACTION.UPDATE,
        { before: settings[key] ?? null, after: value },
        `Platform setting "${key}" updated`);
      setSettings(prev => ({ ...prev, [key]: value }));
      // Drop the shared cache so the logo/avatar update everywhere immediately
      // instead of only after a full page reload.
      invalidatePlatformSettings();
      setSaved(key);
      setTimeout(() => setSaved(''), 2500);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingKey('');
    }
  }

  // Same flow as the logo, separate key/state so one upload can't clobber the
  // other's spinner or error.
  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { setErr('Avatar file too large (max 2 MB)'); return; }
    setUploadingAvatar(true); setErr('');
    try {
      const path = `platform/ewe_avatar_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('platform-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('platform-assets').getPublicUrl(path);
      await saveSetting('ewe_avatar_url', data.publicUrl);
      setLocalVals((prev) => ({ ...prev, ewe_avatar_url: data.publicUrl }));
    } catch (e2) {
      setErr('Upload failed: ' + e2.message);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { setErr('Logo file too large (max 2 MB)'); return; }
    setUploadingLogo(true); setErr('');
    try {
      const path = `platform/logo_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('platform-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('platform-assets').getPublicUrl(path);
      await saveSetting('platform_logo_url', data.publicUrl);
      setLocalVals(prev => ({ ...prev, platform_logo_url: data.publicUrl }));
    } catch (e) {
      setErr('Upload failed: ' + e.message);
    } finally {
      setUploadingLogo(false);
    }
  }

  const lv = (key) => localVals[key] ?? '';
  const setLv = (key) => (e) => setLocalVals(prev => ({ ...prev, [key]: e.target.value }));

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 size={24} className="animate-spin text-primary-500" />
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3"><Settings size={22} /> Platform Settings</h1>
        <p className="text-slate-400 text-sm mt-1">Configure EaseWithExam branding, cookies, and global settings</p>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">{err}</p>
        </div>
      )}

      {/* Branding section */}
      <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6">
        <h2 className="font-bold text-white text-base mb-1">Branding</h2>
        <p className="text-slate-500 text-xs mb-4">Platform name, logo, and visual identity</p>

        <SettingRow icon={Globe} label="Platform Name" hint="Shown in the browser tab title and welcome screens">
          <div className="flex gap-2">
            <input value={lv('platform_name')} onChange={setLv('platform_name')}
              placeholder="EaseWithExam"
              className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            <SaveBtn onClick={() => saveSetting('platform_name', lv('platform_name'))} loading={savingKey === 'platform_name'} saved={saved === 'platform_name'} />
          </div>
        </SettingRow>

        <SettingRow icon={Palette} label="Platform Tagline" hint="Short tagline shown on auth and onboarding screens">
          <div className="flex gap-2">
            <input value={lv('platform_tagline')} onChange={setLv('platform_tagline')}
              placeholder="AI-Powered Exam Prep for NEET & JEE"
              className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            <SaveBtn onClick={() => saveSetting('platform_tagline', lv('platform_tagline'))} loading={savingKey === 'platform_tagline'} saved={saved === 'platform_tagline'} />
          </div>
        </SettingRow>

        <SettingRow icon={Image} label="Platform Logo" hint="PNG or SVG · max 2 MB · displayed in the student sidebar">
          <div className="space-y-3">
            {settings.platform_logo_url && (
              <div className="flex items-center gap-3 p-3 bg-slate-900 rounded-xl border border-white/5">
                <img src={settings.platform_logo_url} alt="Logo" className="h-10 w-auto max-w-[180px] object-contain rounded" />
                <div className="flex-1">
                  <p className="text-xs text-slate-400 truncate">{settings.platform_logo_url.split('/').pop()}</p>
                  <p className="text-[10px] text-emerald-400 mt-0.5">Active logo</p>
                </div>
              </div>
            )}
            <button
              onClick={() => logoRef.current?.click()}
              disabled={uploadingLogo}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-semibold hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              {uploadingLogo
                ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                : <><Upload size={14} /> {settings.platform_logo_url ? 'Replace Logo' : 'Upload Logo'}</>}
            </button>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </SettingRow>

        <SettingRow icon={Image} label="EWE Avatar" hint="Square image · max 2 MB · shown wherever EWE speaks in chat. Leave empty to use the brand logo">
          <div className="space-y-3">
            {settings.ewe_avatar_url && (
              <div className="flex items-center gap-3 p-3 bg-slate-900 rounded-xl border border-white/5">
                <img src={settings.ewe_avatar_url} alt="EWE avatar" className="h-10 w-10 object-cover rounded-full border border-white/10" />
                <div className="flex-1">
                  <p className="text-xs text-slate-400 truncate">{settings.ewe_avatar_url.split('/').pop()}</p>
                  <p className="text-[10px] text-emerald-400 mt-0.5">Active in EWE chat</p>
                </div>
                <button
                  onClick={() => saveSetting('ewe_avatar_url', '')}
                  className="text-[11px] text-slate-400 hover:text-red-400 transition-colors"
                >
                  Reset to logo
                </button>
              </div>
            )}
            <button
              onClick={() => avatarRef.current?.click()}
              disabled={uploadingAvatar}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-semibold hover:bg-white/5 disabled:opacity-50 transition-colors"
            >
              {uploadingAvatar
                ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                : <><Upload size={14} /> {settings.ewe_avatar_url ? 'Replace Avatar' : 'Upload Avatar'}</>}
            </button>
            <input ref={avatarRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          </div>
        </SettingRow>
      </div>

      {/* Cookie banner */}
      <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6">
        <h2 className="font-bold text-white text-base mb-1">Cookie Consent Banner</h2>
        <p className="text-slate-500 text-xs mb-4">Shown to new visitors before they interact with the app</p>

        <SettingRow icon={Cookie} label="Cookie Banner" hint="Enable or disable the consent banner">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => {
                  const newVal = lv('cookie_banner_enabled') !== 'true' ? 'true' : 'false';
                  setLocalVals(prev => ({ ...prev, cookie_banner_enabled: newVal }));
                  saveSetting('cookie_banner_enabled', newVal);
                }}
                className={`relative w-10 h-6 rounded-full transition-colors ${lv('cookie_banner_enabled') === 'true' ? 'bg-emerald-500' : 'bg-slate-600'}`}
              >
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${lv('cookie_banner_enabled') === 'true' ? 'left-5' : 'left-1'}`} />
              </div>
              <span className="text-sm text-slate-300">
                {lv('cookie_banner_enabled') === 'true' ? 'Banner enabled' : 'Banner disabled'}
              </span>
            </label>

            <div>
              <label className="text-xs text-slate-500 block mb-1">Banner Text</label>
              <textarea value={lv('cookie_banner_text')} onChange={setLv('cookie_banner_text')} rows={2}
                placeholder="We use cookies to improve your experience…"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none" />
              <div className="mt-2 flex justify-end">
                <SaveBtn onClick={() => saveSetting('cookie_banner_text', lv('cookie_banner_text'))} loading={savingKey === 'cookie_banner_text'} saved={saved === 'cookie_banner_text'} />
              </div>
            </div>
          </div>
        </SettingRow>
      </div>

      {/* Preview */}
      {settings.platform_logo_url && (
        <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6">
          <h2 className="font-bold text-white text-base mb-4">Preview</h2>
          <div className="bg-slate-950 rounded-xl p-4 flex items-center gap-3 border border-white/5">
            <img src={settings.platform_logo_url} alt="Logo preview" className="h-8 w-auto max-w-[140px] object-contain" />
            <div>
              <p className="text-white text-sm font-bold">{settings.platform_name || 'EaseWithExam'}</p>
              <p className="text-slate-400 text-xs">{settings.platform_tagline || 'AI-Powered Exam Prep'}</p>
            </div>
          </div>
        </div>
      )}

      <DangerZone callerUid={callerUid} />
    </div>
  );
}

function SaveBtn({ onClick, loading, saved }) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors ${saved ? 'bg-emerald-600 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white'} disabled:opacity-50`}>
      {loading ? <Loader2 size={12} className="animate-spin" /> : saved ? <><CheckCircle2 size={12} />Saved</> : 'Save'}
    </button>
  );
}
