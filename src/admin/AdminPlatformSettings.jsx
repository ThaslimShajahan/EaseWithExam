import { useState, useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Settings, Upload, Image, Cookie, Palette, Globe, CheckCircle2, Loader2, AlertTriangle, Trash2, Sparkles, Percent, ArrowUpRight, LifeBuoy } from 'lucide-react';
import { supabase, adminClearAllData } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';
import { invalidatePlatformSettings } from '../hooks/usePlatformSettings';

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find(k => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

// Same `**word**` -> accent-colored span parse as CampaignSection
// (LandingPage.jsx) — duplicated locally rather than imported so this
// admin bundle doesn't pull in the whole landing page module for one
// small pure function. Keep the two in sync by hand if the syntax changes.
function renderAccentHeadline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <span key={i} className="text-primary-600">{part.slice(2, -2)}</span>
      : <span key={i}>{part}</span>,
  );
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
  const campaignImageRef = useRef();
  const errRef    = useRef();

  const [settings,    setSettings]    = useState({});
  const [loading,     setLoading]     = useState(true);
  const [savingKey,   setSavingKey]   = useState('');
  const [saved,       setSaved]       = useState('');
  const [err,         setErr]         = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingCampaignImage, setUploadingCampaignImage] = useState(false);
  const [localVals,   setLocalVals]   = useState({});

  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc('admin_get_platform_settings', { p_caller: callerUid });
      setSettings(data || {});
      setLocalVals(data || {});
      setLoading(false);
    })();
  }, []);

  // Found 2026-08-15 chasing a real "upload does nothing" report: the error
  // banner lives once, at the very top of this (long) page, decoupled from
  // whichever field actually triggered it — an oversized file selected in
  // the campaign section (or the logo/avatar fields above it, same bug,
  // pre-existing) sets `err` correctly, but nothing visibly changes at the
  // admin's actual scroll position, ~1750px below where the message
  // renders. Every setErr(...) call in this file shares one `err` state, so
  // fixing it here covers all of them at once rather than wiring a scroll
  // per field.
  useEffect(() => {
    if (err) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [err]);

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

  // For a SettingRow that groups several independent keys under one logical
  // setting (e.g. the campaign's heading + form URL) — one button, one
  // savingKey/saved sentinel (groupKey, not a real settings key) instead of
  // N separate SaveBtns. Added 2026-08-15: the campaign section originally had
  // one SaveBtn per field, which read as "two broken saves" rather than one
  // working one — see the same day's changelog entry.
  async function saveSettings(groupKey, entries) {
    setSavingKey(groupKey); setErr('');
    try {
      for (const [key, value] of entries) {
        const { error } = await supabase.rpc('admin_set_platform_setting', {
          p_caller: callerUid, p_key: key, p_value: value,
        });
        if (error) throw error;
        logChange(ENTITY.SYSTEM, key, ACTION.UPDATE,
          { before: settings[key] ?? null, after: value },
          `Platform setting "${key}" updated`);
      }
      setSettings(prev => {
        const next = { ...prev };
        for (const [key, value] of entries) next[key] = value;
        return next;
      });
      invalidatePlatformSettings();
      setSaved(groupKey);
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

  // Same flow as the logo/avatar uploads — auto-saves on upload rather than
  // waiting for the campaign section's Save button, since an image change is
  // its own visual commit, same reasoning as the logo/avatar precedent.
  async function handleCampaignImageUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024) { setErr('Image file too large (max 2 MB)'); return; }
    setUploadingCampaignImage(true); setErr('');
    try {
      const path = `platform/campaign_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('platform-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('platform-assets').getPublicUrl(path);
      await saveSetting('landing_campaign_image_url', data.publicUrl);
      setLocalVals(prev => ({ ...prev, landing_campaign_image_url: data.publicUrl }));
    } catch (e2) {
      setErr('Upload failed: ' + e2.message);
    } finally {
      setUploadingCampaignImage(false);
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
        <div ref={errRef} className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
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

        <SettingRow icon={Sparkles} label="Quota Grant Badge">
          <div>
            <label className="text-xs text-slate-500 block mb-1">Badge label</label>
            <input value={lv('quota_grant_badge_label')} onChange={setLv('quota_grant_badge_label')}
              placeholder="Bonus access"
              className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            {/* The day/hour count is intentionally NOT part of this text — it is
                always computed by ExpiryBadge.jsx (see the 2026-08-14 fix for
                why: singular/plural and hours-vs-days need real logic, not a
                hand-typed template). This field only controls what comes
                before it. */}
            <p className="text-[11px] text-slate-500 mt-1.5">
              Shown to any student with an active quota grant, e.g. <span className="text-slate-300">"{lv('quota_grant_badge_label') || 'Bonus access'} — 3 days left"</span>.
              Change this for a named campaign (e.g. "Independence Day Special") — the day count always
              updates itself.
            </p>
            <div className="mt-2 flex justify-end">
              <SaveBtn onClick={() => saveSetting('quota_grant_badge_label', lv('quota_grant_badge_label'))}
                loading={savingKey === 'quota_grant_badge_label'} saved={saved === 'quota_grant_badge_label'} />
            </div>
          </div>
        </SettingRow>

        <SettingRow icon={Sparkles} label="Landing Page Campaign" hint="A section on the public homepage, hidden unless a campaign is running">
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <button type="button"
                onClick={() => {
                  const turningOn = lv('landing_campaign_enabled') !== 'true';
                  // Added 2026-08-15: this toggle auto-saves immediately (by
                  // design — same as the cookie banner toggle), which is
                  // exactly how a placeholder "test" heading ended up live on
                  // the public site earlier tonight — nothing stopped a
                  // stray click from enabling an empty campaign. Enabling
                  // now requires a real heading first; disabling is always
                  // allowed with no gate.
                  if (turningOn && !lv('landing_campaign_label')?.trim()) {
                    setErr('Add a heading below before enabling — an empty/placeholder campaign should not go live.');
                    return;
                  }
                  const next = turningOn ? 'true' : 'false';
                  setLv('landing_campaign_enabled')({ target: { value: next } });
                  saveSetting('landing_campaign_enabled', next);
                }}
                className={`relative w-10 h-6 rounded-full transition-colors ${lv('landing_campaign_enabled') === 'true' ? 'bg-emerald-500' : 'bg-slate-600'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${lv('landing_campaign_enabled') === 'true' ? 'left-5' : 'left-1'}`} />
              </button>
              <span className="text-sm text-slate-300">
                {lv('landing_campaign_enabled') === 'true' ? 'Section visible on landing page' : 'Section hidden'}
              </span>
            </label>
            {/* Independent of quota_overrides on purpose — a support grant to
                one student must not turn on a public section for everyone.
                Both enabled AND a form URL are required for the section to
                actually render; see CampaignSection in LandingPage.jsx. */}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Heading</label>
              <input value={lv('landing_campaign_label')} onChange={setLv('landing_campaign_label')}
                placeholder="e.g. Get **3 months free** on the yearly plan"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
              <p className="text-[11px] text-slate-500 mt-1">
                Wrap one word or phrase in <span className="text-slate-300 font-mono">**double asterisks**</span> to
                highlight it in green — e.g. "Get <span className="text-slate-300 font-mono">**3 months free**</span>" shows
                "3 months free" in color, the rest stays dark.
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Description</label>
              <textarea value={lv('landing_campaign_description')} onChange={setLv('landing_campaign_description')}
                placeholder="Fill in the form below to take part." rows={3}
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500 resize-none" />
              <p className="text-[11px] text-slate-500 mt-1">
                A few lines under the heading. There's no separate end-date field — if the offer has a deadline,
                just write it in here (e.g. "Offer ends March 5"). Leave blank to use the default line above as a
                placeholder.
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Signup form URL</label>
              <input value={lv('landing_campaign_form_url')} onChange={setLv('landing_campaign_form_url')}
                placeholder="https://forms.gle/…"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
              <p className="text-[11px] text-slate-500 mt-1">Opens in a new tab when a visitor clicks "Join now". Any form URL works — Google Forms, Typeform, etc.</p>
            </div>

            {/* Image — same upload flow as the platform logo/EWE avatar
                above, reused rather than rebuilt. Optional: an unset image
                falls back to the full-width text layout, not a
                broken/empty box (see CampaignSection).
                Content-model note: this slot expects a PHOTO, not a flyer.
                The layout crops it and bleeds it to the card's edge, which
                only looks right on a clean photo of a person — a full
                promotional graphic with its own baked-in text will have
                that text cropped out. The offer's own headline/description/
                CTA above are the only text layer. */}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Photo (optional)</label>
              {lv('landing_campaign_image_url') && (
                <div className="flex items-center gap-3 p-3 bg-slate-900 rounded-xl border border-white/5 mb-2">
                  <img src={lv('landing_campaign_image_url')} alt="Campaign" className="h-10 w-16 object-cover rounded" />
                  <div className="flex-1">
                    <p className="text-xs text-slate-400 truncate">{lv('landing_campaign_image_url').split('/').pop()}</p>
                    <p className="text-[10px] text-emerald-400 mt-0.5">Two-column layout active</p>
                  </div>
                  <button
                    onClick={() => saveSetting('landing_campaign_image_url', '')}
                    className="text-[11px] text-slate-400 hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                </div>
              )}
              <button
                onClick={() => campaignImageRef.current?.click()}
                disabled={uploadingCampaignImage}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-white/10 text-slate-300 text-sm font-semibold hover:bg-white/5 disabled:opacity-50 transition-colors"
              >
                {uploadingCampaignImage
                  ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                  : <><Upload size={14} /> {lv('landing_campaign_image_url') ? 'Replace photo' : 'Upload photo'}</>}
              </button>
              <input ref={campaignImageRef} type="file" accept="image/*" className="hidden" onChange={handleCampaignImageUpload} />
              <p className="text-[11px] text-slate-500 mt-1">
                Upload a clean, cropped photo of a person — not a promotional graphic with its own text, logo, or
                CTA baked in (that belongs in the fields above instead). Portrait or square works best, waist-up,
                ideally facing toward the text. PNG or JPG · max 2 MB · without one the section stays full-width text.
              </p>
            </div>

            {/* Found 2026-08-15 chasing a report of "the section isn't
                showing even though it's enabled": both saves were working
                correctly the whole time — the section's own render
                condition (CampaignSection in LandingPage.jsx) requires
                enabled AND a non-empty form URL, and reads as invisible
                with no explanation when only one is set. This makes that
                requirement visible instead of a silent no-op. */}
            {lv('landing_campaign_enabled') === 'true' && !lv('landing_campaign_form_url')?.trim() && (
              <p className="text-[11px] text-amber-400 bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                Enabled, but the section won't show yet — a form URL is also required.
              </p>
            )}

            <div className="flex justify-end">
              <SaveBtn onClick={() => saveSettings('landing_campaign', [
                ['landing_campaign_label', lv('landing_campaign_label')],
                ['landing_campaign_description', lv('landing_campaign_description')],
                ['landing_campaign_form_url', lv('landing_campaign_form_url')],
              ])}
                loading={savingKey === 'landing_campaign'} saved={saved === 'landing_campaign'} />
            </div>

            {/* Live preview — mirrors CampaignSection's own markup (the
                "white card, on-brand" direction), fed from localVals so it
                updates as the admin types, before saving. lg: breakpoint
                throughout, matching the real page exactly — this panel is
                typically narrower than a full viewport, so the mobile
                stack below is what most admins actually see while
                editing, which is why it's shown too, not just the
                two-column view. */}
            <div>
              <p className="text-xs text-slate-500 mb-2">Preview — desktop (lg+ viewport width)</p>
              <div className={`rounded-2xl overflow-hidden bg-white border border-slate-200 ${lv('landing_campaign_image_url') ? 'lg:grid lg:grid-cols-[3fr_2fr] lg:min-h-[200px]' : ''}`}>
                <div className={`flex flex-col p-5 ${lv('landing_campaign_image_url') ? 'lg:items-start lg:text-left justify-center' : 'items-center text-center'}`}>
                  <span className="inline-flex items-center gap-1.5 bg-primary-50 text-primary-700 text-[10px] font-bold px-2.5 py-1 rounded-full mb-3">
                    <Sparkles size={10} /> Limited time
                  </span>
                  <h3 className="text-lg font-extrabold text-slate-900 tracking-tight leading-tight">
                    {renderAccentHeadline(lv('landing_campaign_label') || 'Special **campaign**')}
                  </h3>
                  <p className={`text-slate-500 mt-1.5 text-xs whitespace-pre-line max-w-sm ${lv('landing_campaign_image_url') ? '' : 'mx-auto'}`}>
                    {lv('landing_campaign_description') || 'Fill in the form below to take part.'}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary-600 text-white text-xs font-bold">
                    Join now <ArrowUpRight size={13} />
                  </span>
                </div>
                {lv('landing_campaign_image_url') && (
                  // Matches CampaignSection's own structural mechanism
                  // exactly — see that component's comment (a portrait
                  // upload was ballooning the whole card before this).
                  <div className="relative hidden lg:block lg:self-stretch bg-slate-50 overflow-hidden">
                    <img src={lv('landing_campaign_image_url')} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
                  </div>
                )}
                {lv('landing_campaign_image_url') && (
                  <div className="relative lg:hidden aspect-video bg-slate-50 overflow-hidden">
                    <img src={lv('landing_campaign_image_url')} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
                  </div>
                )}
              </div>
            </div>
          </div>
        </SettingRow>

        <SettingRow icon={Percent} label="Tax / GST" hint="The order-summary review step and payment confirmation page — empty means no tax line is shown at all, not 0%">
          <div className="space-y-3">
            {/* Deliberately no toggle — "on" would require a real rate. The
                fields being empty already means "no tax line", which is the
                honest state until the GST registration question resolves
                (see docs/ACTION_ITEMS_FOR_YOU.md). Filling in a rate here is
                the whole activation step, no code change needed after. */}
            <div>
              <label className="text-xs text-slate-500 block mb-1">Tax rate (%)</label>
              <input value={lv('tax_rate_percent')} onChange={setLv('tax_rate_percent')}
                placeholder="e.g. 18 — leave blank to show no tax line"
                inputMode="decimal"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">Tax line label</label>
              <input value={lv('tax_label')} onChange={setLv('tax_label')}
                placeholder="GST"
                className="w-full bg-slate-900 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-primary-500" />
            </div>
            <div className="flex justify-end gap-2">
              <SaveBtn onClick={() => saveSetting('tax_rate_percent', lv('tax_rate_percent'))}
                loading={savingKey === 'tax_rate_percent'} saved={saved === 'tax_rate_percent'} />
              <SaveBtn onClick={() => saveSetting('tax_label', lv('tax_label'))}
                loading={savingKey === 'tax_label'} saved={saved === 'tax_label'} />
            </div>
          </div>
        </SettingRow>
      </div>

      <div className="bg-slate-800/50 border border-white/5 rounded-2xl p-6">
        <h2 className="font-bold text-white text-base mb-1">Support Widget</h2>
        <p className="text-slate-500 text-xs mb-4">Redber AI chat, reached from Help Center's "Chat with us" — a full page (/support), not a floating bubble</p>

        <SettingRow icon={LifeBuoy} label="Chat Support" hint="Enable or disable the Redber support chat link">
          <label className="flex items-center gap-3 cursor-pointer">
            <div
              onClick={() => {
                const newVal = lv('support_widget_enabled') !== 'true' ? 'true' : 'false';
                setLocalVals(prev => ({ ...prev, support_widget_enabled: newVal }));
                saveSetting('support_widget_enabled', newVal);
              }}
              className={`relative w-10 h-6 rounded-full transition-colors ${lv('support_widget_enabled') === 'true' ? 'bg-emerald-500' : 'bg-slate-600'}`}
            >
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${lv('support_widget_enabled') === 'true' ? 'left-5' : 'left-1'}`} />
            </div>
            <span className="text-sm text-slate-300">
              {lv('support_widget_enabled') === 'true' ? 'Widget enabled' : 'Widget disabled'}
            </span>
          </label>
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
