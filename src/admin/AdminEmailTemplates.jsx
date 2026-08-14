import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail, Pencil, X, Save, Loader2, CheckCircle2, AlertTriangle, RotateCcw, Plus, Trash2,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logChange, ENTITY, ACTION } from '../lib/changelog';

/**
 * Admin-configurable copy for the app's own transactional emails
 * (email_templates table, sql/0057) — welcome, paper-ready, subscription-
 * activated, and the connect-email verification code. Rendered by the
 * send-email / connect-email edge functions via
 * supabase/functions/_shared/emailLayout.ts; this page edits the same rows
 * those functions read, so changes here go live on the next send with no
 * deploy. admin_broadcast (Push Notifications → Email channel) is
 * deliberately NOT here — its title/body are supplied fresh by the admin on
 * every send already, which is more customization than a static template.
 */

function getCallerUid() {
  try {
    const key = Object.keys(sessionStorage).find((k) => k.startsWith('edu_admin_rec_'));
    return key ? JSON.parse(sessionStorage.getItem(key))?.uid : '';
  } catch { return ''; }
}

const FIELD_LABEL = 'text-[11px] font-semibold text-slate-400 uppercase tracking-wide block mb-1.5';
const FIELD_INPUT = 'w-full bg-slate-800 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500';

// Placeholder tokens available per template, shown as a hint in the editor,
// and swapped for example values in the preview pane.
const PLACEHOLDER_EXAMPLES = {
  welcome:              { name: 'Priya', exam: 'NEET UG' },
  paper_ready:          { examType: 'NEET', subject: 'Physics', count: '30' },
  subscription_active:  { planName: '3-Year Plan' },
  subscription_receipt: { planName: '3-Year Plan', amount: '₹4,999', paymentId: 'pay_QeXampLe123456', date: '14 Aug 2026' },
  verify_email:         { code: '482913' },
};

function substitute(text, vars) {
  return (text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

// Client-side mirror of _shared/emailLayout.ts's layout()/renderTemplateRow()
// / renderReceiptEmail() — kept visually identical on purpose so this
// preview isn't lying about what the edge function will actually send.
function buildPreviewHtml(row) {
  const vars = PLACEHOLDER_EXAMPLES[row.template_key] ?? {};
  const heading = substitute(row.heading, vars);
  const body    = substitute(row.body_text, vars);
  const footer  = row.footer_note ? substitute(row.footer_note, vars) : '';

  const buttonHtml = (row.button_label && row.button_path)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
        <tr><td style="background:#21A375;border-radius:12px;">
          <a href="#" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${row.button_label}</a>
        </td></tr>
      </table>`
    : '';

  let bodyInner;

  if (row.template_key === 'subscription_receipt') {
    // Mirrors renderReceiptEmail(): heading is the status-pill text,
    // bullet_points render as a bordered label/value table (parsed on the
    // first ":"), body_text sits below the table.
    const lines = (row.bullet_points ?? []).map((raw) => substitute(raw, vars));
    const rowsHtml = lines.map((line, i) => {
      const sep = line.indexOf(':');
      const label = sep === -1 ? line : line.slice(0, sep).trim();
      const value = sep === -1 ? '' : line.slice(sep + 1).trim();
      const isLast = i === lines.length - 1;
      const isMono = /payment id/i.test(label);
      const border = isLast ? '' : 'border-bottom:1px solid #F1F5F9;';
      return `<tr>
        <td style="padding:14px 18px;font-size:13px;color:#64748B;${border}">${label}</td>
        <td style="padding:14px 18px;font-size:${isMono ? '12px' : '13px'};color:#0F172A;font-weight:600;${isMono ? 'font-family:ui-monospace,SFMono-Regular,Consolas,monospace;' : ''}text-align:right;${border}">${value}</td>
      </tr>`;
    }).join('');

    bodyInner = `
      <div style="text-align:center;margin:0 0 4px;">
        <span style="display:inline-flex;align-items:center;gap:6px;background:#F0FDF9;color:#156A4C;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:6px 14px;border-radius:999px;">✓ ${heading}</span>
      </div>
      <h1 style="margin:16px 0 4px;font-size:28px;font-weight:800;color:#0F172A;text-align:center;letter-spacing:-0.01em;">${vars.amount ?? ''}</h1>
      <p style="margin:0 0 22px;font-size:14px;color:#64748B;text-align:center;">for ${vars.planName ?? ''}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;margin-bottom:20px;">
        ${rowsHtml}
      </table>
      <p style="margin:0 0 18px;font-size:14px;line-height:1.7;color:#475569;text-align:center;">${body}</p>
      ${buttonHtml ? `<div style="text-align:center;">${buttonHtml}</div>` : ''}
      ${footer ? `<p style="margin:0;font-size:12px;color:#94A3B8;text-align:center;">${footer}</p>` : ''}
    `;
  } else {
    const bulletsHtml = row.bullet_points?.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">${
          row.bullet_points.map((f) => `
            <tr><td style="padding:6px 0;font-size:14px;color:#334155;">
              <span style="color:#21A375;font-weight:700;">✓</span>&nbsp;&nbsp;${substitute(f, vars)}
            </td></tr>`).join('')
        }</table>`
      : '';

    const codeBoxHtml = row.template_key === 'verify_email'
      ? `<div style="text-align:center;margin:4px 0 20px;"><div style="display:inline-block;background:#F0FDF9;border:1px solid #D0F1E6;border-radius:14px;padding:16px 32px;font-size:32px;font-weight:800;letter-spacing:8px;color:#156A4C;">${vars.code}</div></div>`
      : '';

    bodyInner = `
      <h1 style="margin:0 0 12px;font-size:22px;color:#0F172A;text-align:${row.template_key === 'verify_email' ? 'center' : 'left'};">${heading}</h1>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#475569;white-space:pre-wrap;text-align:${row.template_key === 'verify_email' ? 'center' : 'left'};">${body}</p>
      ${codeBoxHtml}
      ${bulletsHtml}
      ${buttonHtml}
      ${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#94A3B8;text-align:${row.template_key === 'verify_email' ? 'center' : 'left'};">${footer}</p>` : ''}
    `;
  }

  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border-radius:20px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#21A375,#1B8660);padding:22px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0"><tr>
            <td style="width:32px;height:32px;background:rgba(255,255,255,0.15);border-radius:9px;text-align:center;vertical-align:middle;font-weight:800;font-size:16px;color:#FFFFFF;">E</td>
            <td style="padding-left:10px;font-weight:800;font-size:16px;color:#FFFFFF;">EaseWithExam</td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:28px;">${bodyInner}</td></tr>
        <tr><td style="padding:16px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
          <p style="margin:0;font-size:11px;color:#94A3B8;">EaseWithExam · support@easewithexam.in</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function BulletsEditor({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const items = Array.isArray(value) ? value : [];
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className={FIELD_INPUT}
            value={item}
            onChange={(e) => onChange(items.map((it, idx) => (idx === i ? e.target.value : it)))}
          />
          <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="p-2 text-slate-500 hover:text-red-400 transition-colors shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className={FIELD_INPUT}
          placeholder="Add a bullet point…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button type="button" onClick={add}
          className="flex items-center gap-1 px-3 py-2 bg-slate-800 border border-white/10 text-slate-300 text-xs rounded-xl hover:bg-slate-700 transition-colors shrink-0">
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

// A new template's key is a permanent database identifier and, once code is
// wired to fire it, a string another developer will type verbatim — so it is
// constrained to the same shape every EXISTING key already has (lowercase
// snake_case), rather than accepting anything.
const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

function EditModal({ row, isNew, onClose, onSave, onReset, saving, error }) {
  const [form, setForm] = useState({ ...row });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const vars = Object.keys(PLACEHOLDER_EXAMPLES[row.template_key] ?? {});
  const keyValid = isNew ? KEY_PATTERN.test(form.template_key.trim()) : true;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div>
            <h3 className="font-bold text-white">{isNew ? 'New Email Template' : row.label}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{isNew ? 'Not yet wired to any send — see the note below.' : row.description}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-slate-400 hover:text-white"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-hidden grid md:grid-cols-2">
          {/* Form */}
          <div className="overflow-y-auto p-5 space-y-4 border-r border-white/10">
            {isNew && (
              <>
                <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-3 py-2.5">
                  <p className="text-[11px] text-amber-300 leading-relaxed">
                    Creating this template does not make anything send it. A developer still has to add
                    a trigger in code that calls it by key — same as the 4 built-in templates each have
                    their own trigger. This screen is for authoring and previewing the content now, so
                    it is ready when that trigger is added.
                  </p>
                </div>
                <div>
                  <label className={FIELD_LABEL}>Template Key (permanent — cannot be changed after saving)</label>
                  <input className={FIELD_INPUT} value={form.template_key}
                    onChange={(e) => setForm((f) => ({ ...f, template_key: e.target.value.trim().toLowerCase() }))}
                    placeholder="e.g. diwali_promo" />
                  {!keyValid && form.template_key && (
                    <p className="text-[11px] text-red-400 mt-1">Lowercase letters, numbers and underscores only, starting with a letter.</p>
                  )}
                </div>
                <div>
                  <label className={FIELD_LABEL}>Internal Label (shown in this list, not to students)</label>
                  <input className={FIELD_INPUT} value={form.label} onChange={set('label')} placeholder="e.g. Diwali Promo Email" />
                </div>
              </>
            )}
            {vars.length > 0 && (
              <div className="bg-primary-900/20 border border-primary-700/30 rounded-xl px-3 py-2">
                <p className="text-[10px] text-primary-300">
                  Available placeholders: {vars.map((v) => `{{${v}}}`).join(', ')}
                </p>
              </div>
            )}
            <div>
              <label className={FIELD_LABEL}>Email Subject</label>
              <input className={FIELD_INPUT} value={form.subject} onChange={set('subject')} />
            </div>
            <div>
              <label className={FIELD_LABEL}>Heading</label>
              <input className={FIELD_INPUT} value={form.heading} onChange={set('heading')} />
            </div>
            <div>
              <label className={FIELD_LABEL}>Body Text</label>
              <textarea rows={4} className={FIELD_INPUT} value={form.body_text} onChange={set('body_text')} />
            </div>
            {/* Existing templates keep their original per-key gating unchanged
                (welcome-only bullets, no button on verify_email) — a NEW
                template has no such history, so both fields are simply
                offered; the author leaves what they don't need blank. */}
            {(isNew || row.template_key === 'welcome' || row.template_key === 'subscription_receipt') && (
              <div>
                <label className={FIELD_LABEL}>{row.template_key === 'subscription_receipt' ? 'Receipt Line Items' : 'Feature Bullet Points'}</label>
                <BulletsEditor value={form.bullet_points} onChange={(v) => setForm((f) => ({ ...f, bullet_points: v }))} />
              </div>
            )}
            {(isNew || row.template_key !== 'verify_email') && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD_LABEL}>Button Label</label>
                  <input className={FIELD_INPUT} value={form.button_label} onChange={set('button_label')} placeholder="e.g. Start Practicing" />
                </div>
                <div>
                  <label className={FIELD_LABEL}>Button Link (path)</label>
                  <input className={FIELD_INPUT} value={form.button_path} onChange={set('button_path')} placeholder="/dashboard" />
                </div>
              </div>
            )}
            <div>
              <label className={FIELD_LABEL}>Footer Note (optional, smaller text under the button)</label>
              <input className={FIELD_INPUT} value={form.footer_note} onChange={set('footer_note')} />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-900/30 border border-red-500/30 rounded-xl px-4 py-3">
                <AlertTriangle size={14} className="text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}
          </div>

          {/* Preview */}
          <div className="overflow-y-auto p-5 bg-slate-950/40">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Live Preview (example values)</p>
            <div className="rounded-xl overflow-hidden border border-white/10 bg-white">
              <iframe
                title="Email preview"
                srcDoc={buildPreviewHtml(form)}
                className="w-full"
                style={{ height: '560px', border: 'none' }}
              />
            </div>
          </div>
        </div>

        <div className="p-5 border-t border-white/10 flex gap-3 shrink-0">
          {!isNew && (
            <button onClick={onReset} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-amber-400 hover:border-amber-500/30 text-sm font-medium transition-colors disabled:opacity-50">
              <RotateCcw size={13} /> Reset to default
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">Cancel</button>
          <button
            onClick={() => onSave(form)}
            disabled={saving || !form.subject.trim() || !form.heading.trim() || (isNew && (!keyValid || !form.template_key.trim() || !form.label.trim()))}
            className="px-5 py-2.5 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? 'Saving…' : isNew ? 'Create Template' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

export default function AdminEmailTemplates() {
  const callerUid = getCallerUid();
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [isNew,   setIsNew]   = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState('');
  const [toast,   setToast]   = useState('');

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.rpc('admin_list_email_templates', { p_caller: callerUid });
    setRows(Array.isArray(data) ? data : []);
    setLoading(false);
  };
  useEffect(() => { if (callerUid) load(); }, [callerUid]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleSave(form) {
    setSaving(true); setError('');
    // admin_upsert_email_template is a real upsert (ON CONFLICT DO UPDATE) —
    // correct for editing an existing row, but it means "Create Template"
    // with a key that already exists would silently overwrite that template
    // instead of erroring. Checked client-side against the already-loaded
    // list rather than adding a server-side existence check for a table this
    // small.
    if (isNew && rows.some((r) => r.template_key === form.template_key.trim())) {
      setError(`"${form.template_key}" already exists — edit it from the list instead of creating a duplicate.`);
      setSaving(false);
      return;
    }
    try {
      const { error: err } = await supabase.rpc('admin_upsert_email_template', {
        p_caller: callerUid, p_template_key: form.template_key, p_label: form.label,
        p_description: form.description, p_subject: form.subject, p_heading: form.heading,
        p_body_text: form.body_text, p_bullet_points: form.bullet_points ?? [],
        p_button_label: form.button_label ?? '', p_button_path: form.button_path ?? '',
        p_footer_note: form.footer_note ?? '',
      });
      if (err) throw new Error(err.message);
      logChange(ENTITY.SYSTEM, form.template_key, isNew ? ACTION.CREATE : ACTION.UPDATE, { after: form },
        isNew ? `Admin created the "${form.label}" email template` : `Admin updated the "${form.label}" email template`);
      setEditing(null); setIsNew(false);
      setToast(isNew ? 'Created — not yet wired to a send trigger.' : 'Saved — live on the next send.');
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(templateKey) {
    setSaving(true);
    try {
      const { data, error: err } = await supabase.rpc('admin_reset_email_template', { p_caller: callerUid, p_template_key: templateKey });
      if (err) throw new Error(err.message);
      logChange(ENTITY.SYSTEM, templateKey, ACTION.UPDATE, null, `Admin reset the "${templateKey}" email template to default`);
      setEditing(data);
      setToast('Reset to default.');
      load();
    } catch (e) {
      setToast(`Reset failed: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="text-center py-16 space-y-3">
        <Loader2 size={24} className="animate-spin mx-auto text-slate-600" />
        <p className="text-sm text-slate-500">Loading email templates…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Mail size={20} /> Email Templates</h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Copy for the app's own transactional emails — live on the next send, no deploy needed. The admin
            Push Notifications composer's Email channel is separate: its subject/message come fresh from
            that form on every send, not from a template here.
          </p>
        </div>
        <button onClick={() => {
          setIsNew(true);
          setEditing({ template_key: '', label: '', description: '', subject: '', heading: '',
            body_text: '', bullet_points: [], button_label: '', button_path: '', footer_note: '' });
        }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 transition-colors shrink-0">
          <Plus size={13} /> New Template
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.template_key} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-800/60 border border-white/5">
            <div className="h-9 w-9 rounded-lg bg-primary-900/30 flex items-center justify-center shrink-0">
              <Mail size={15} className="text-primary-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200">{row.label}</p>
              <p className="text-[11px] text-slate-500 truncate">{row.description}</p>
            </div>
            <button onClick={() => { setIsNew(false); setEditing(row); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-primary-300 bg-primary-900/30 border border-primary-700/30 hover:bg-primary-900/50 transition-colors shrink-0">
              <Pencil size={12} /> Edit
            </button>
          </div>
        ))}
      </div>

      {editing && (
        <EditModal
          row={editing}
          isNew={isNew}
          onClose={() => { setEditing(null); setIsNew(false); setError(''); }}
          onSave={handleSave}
          onReset={() => handleReset(editing.template_key)}
          saving={saving}
          error={error}
        />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-slate-800 border border-white/10 text-white text-sm px-4 py-2.5 rounded-xl shadow-2xl z-50 flex items-center gap-2 whitespace-nowrap">
            <CheckCircle2 size={15} className="text-emerald-400" /> {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
