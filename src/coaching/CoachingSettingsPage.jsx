import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Settings, Upload, Image, Globe, Phone, Type, Palette,
  CheckCircle2, Loader2, AlertTriangle,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useCoaching } from './CoachingPortalGuard';

function SettingRow({ icon: Icon, label, hint, children }) {
  return (
    <div className="flex items-start gap-4 py-5 border-b border-slate-100 last:border-0">
      <div className="h-9 w-9 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={16} className="text-slate-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 mb-0.5">{label}</p>
        {hint && <p className="text-xs text-slate-400 mb-3">{hint}</p>}
        {children}
      </div>
    </div>
  );
}

function SaveBtn({ onClick, loading, saved }) {
  return (
    <button onClick={onClick} disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 transition-colors disabled:opacity-50 ${saved ? 'bg-emerald-600 text-white' : 'bg-primary-600 hover:bg-primary-700 text-white'}`}>
      {loading ? <Loader2 size={12} className="animate-spin" /> : saved ? <><CheckCircle2 size={12} /> Saved</> : 'Save'}
    </button>
  );
}

export default function CoachingSettingsPage() {
  const { record, updateRecord } = useCoaching();
  const centreId  = record?.centre_id;
  const adminUid  = record?.uid;
  const logoRef   = useRef();

  const [form,         setForm]         = useState({
    name:       record?.centre_name       ?? '',
    tagline:    record?.centre_tagline    ?? '',
    brand_color:record?.centre_brand_color?? '#6366f1',
    website_url:record?.centre_website_url?? '',
    phone:      record?.centre_phone      ?? '',
  });
  const [savingKey,    setSavingKey]    = useState('');
  const [savedKey,     setSavedKey]    = useState('');
  const [err,          setErr]          = useState('');
  const [uploadingLogo,setUploadingLogo]= useState(false);
  const [logoUrl,      setLogoUrl]      = useState(record?.centre_logo_url ?? '');

  const setF = k => e => setForm(prev => ({ ...prev, [k]: typeof e === 'string' ? e : e.target.value }));

  async function save(field, value) {
    setSavingKey(field); setErr('');
    try {
      const { error } = await supabase.rpc('coaching_centre_update_branding', {
        p_admin_uid: adminUid,
        p_centre_id: centreId,
        p_field:     field,
        p_value:     value,
      });
      if (error) throw error;
      setSavedKey(field);
      setTimeout(() => setSavedKey(''), 2500);

      // Update the shared portal context immediately (header, PIN screen accent, etc.)
      // instead of only sessionStorage, which nothing else re-reads until a reload.
      updateRecord({ [`centre_${field}`]: value });
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingKey('');
    }
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Please select an image file'); return; }
    if (file.size > 2 * 1024 * 1024)    { setErr('Logo too large (max 2 MB)');   return; }
    setUploadingLogo(true); setErr('');
    try {
      const path = `coaching/${centreId}/logo_${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from('platform-assets').upload(path, file, { upsert: true });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('platform-assets').getPublicUrl(path);
      await save('logo_url', data.publicUrl);
      setLogoUrl(data.publicUrl);
    } catch (e) {
      setErr('Upload failed: ' + e.message);
    } finally {
      setUploadingLogo(false);
    }
  }

  if (!centreId) {
    return (
      <div className="flex flex-col items-center py-20 text-center gap-2 text-slate-400">
        <Settings size={28} className="opacity-30" />
        <p className="text-sm">Settings are only available to coaching centre admins.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Settings size={20} className="text-slate-400" /> Centre Settings
        </h1>
        <p className="text-sm text-slate-500 mt-1">Manage your coaching centre's branding and contact information</p>
      </div>

      {err && (
        <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
          <AlertTriangle size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-600">{err}</p>
        </div>
      )}

      {/* Branding */}
      <div className="bg-white rounded-2xl border border-slate-100 px-5">
        <h2 className="font-bold text-slate-800 text-sm pt-5 pb-1">Branding</h2>
        <p className="text-slate-400 text-xs mb-2">Your centre's visual identity shown to students</p>

        <SettingRow icon={Type} label="Centre Name" hint="Displayed in the coaching portal header">
          <div className="flex gap-2">
            <input value={form.name} onChange={setF('name')}
              placeholder="e.g. Sharma Classes"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-400 transition-colors" />
            <SaveBtn onClick={() => save('name', form.name)} loading={savingKey === 'name'} saved={savedKey === 'name'} />
          </div>
        </SettingRow>

        <SettingRow icon={Type} label="Tagline" hint="Short line shown below your centre name">
          <div className="flex gap-2">
            <input value={form.tagline} onChange={setF('tagline')}
              placeholder="e.g. NEET specialists since 2015"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-400 transition-colors" />
            <SaveBtn onClick={() => save('tagline', form.tagline)} loading={savingKey === 'tagline'} saved={savedKey === 'tagline'} />
          </div>
        </SettingRow>

        <SettingRow icon={Palette} label="Brand Color" hint="Used for nav highlights and accent elements">
          <div className="flex items-center gap-3">
            <input type="color" value={form.brand_color} onChange={setF('brand_color')}
              className="h-10 w-16 rounded-xl border border-slate-200 cursor-pointer p-1 bg-white" />
            <input value={form.brand_color} onChange={setF('brand_color')} maxLength={7}
              className="w-28 border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-400 transition-colors uppercase" />
            <SaveBtn onClick={() => save('brand_color', form.brand_color)} loading={savingKey === 'brand_color'} saved={savedKey === 'brand_color'} />
          </div>
        </SettingRow>

        <SettingRow icon={Image} label="Logo" hint="PNG or SVG · max 2 MB · shown in the portal sidebar">
          <div className="space-y-3">
            {logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                <img src={logoUrl} alt="Logo" className="h-10 w-auto max-w-[160px] object-contain rounded" />
                <p className="text-xs text-emerald-600 font-medium">Active logo</p>
              </div>
            )}
            <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-600 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50 transition-colors">
              {uploadingLogo
                ? <><Loader2 size={14} className="animate-spin" /> Uploading…</>
                : <><Upload size={14} /> {logoUrl ? 'Replace Logo' : 'Upload Logo'}</>}
            </button>
            <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </div>
        </SettingRow>
      </div>

      {/* Contact */}
      <div className="bg-white rounded-2xl border border-slate-100 px-5">
        <h2 className="font-bold text-slate-800 text-sm pt-5 pb-1">Contact Info</h2>
        <p className="text-slate-400 text-xs mb-2">Shown to students in the portal footer</p>

        <SettingRow icon={Globe} label="Website URL" hint="Your coaching centre's public website">
          <div className="flex gap-2">
            <input value={form.website_url} onChange={setF('website_url')}
              placeholder="https://yourcentre.com"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-400 transition-colors" />
            <SaveBtn onClick={() => save('website_url', form.website_url)} loading={savingKey === 'website_url'} saved={savedKey === 'website_url'} />
          </div>
        </SettingRow>

        <SettingRow icon={Phone} label="Phone Number" hint="Students can see this if they need support">
          <div className="flex gap-2">
            <input value={form.phone} onChange={setF('phone')}
              placeholder="+91 98765 43210"
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary-400 transition-colors" />
            <SaveBtn onClick={() => save('phone', form.phone)} loading={savingKey === 'phone'} saved={savedKey === 'phone'} />
          </div>
        </SettingRow>
      </div>

      {/* Preview */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h2 className="font-bold text-slate-800 text-sm mb-3">Preview</h2>
        <div className="rounded-xl overflow-hidden border border-slate-100">
          {/* Mock sidebar header */}
          <div className="flex items-center gap-3 p-4" style={{ background: form.brand_color + '15' }}>
            {logoUrl
              ? <img src={logoUrl} alt="Logo" className="h-9 w-auto max-w-[100px] object-contain" />
              : <div className="h-9 w-9 rounded-xl flex items-center justify-center text-white text-base font-bold"
                     style={{ background: form.brand_color }}>
                  {(form.name || 'C')[0]}
                </div>}
            <div>
              <p className="font-bold text-slate-900 text-sm">{form.name || 'Centre Name'}</p>
              {form.tagline && <p className="text-xs text-slate-500">{form.tagline}</p>}
            </div>
          </div>
          {/* Active nav sample */}
          <div className="p-3 bg-white border-t border-slate-100">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-white text-xs font-semibold w-fit"
                 style={{ background: form.brand_color }}>
              Dashboard
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
