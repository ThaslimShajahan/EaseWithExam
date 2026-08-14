/**
 * Shared between send-email and connect-email — the branded HTML shell,
 * button component, and {{placeholder}} substitution used to render
 * admin-configurable rows from the `email_templates` table (sql/0057).
 * Kept here instead of duplicated in both function directories so the two
 * never quietly drift in appearance.
 */

// The bare domain 301-redirects to the www. form (verified live), so every
// button link in every email cost an extra redirect hop until this was fixed
// — same www. correction the deploy pipeline already uses for the site itself.
export const SITE_URL      = 'https://www.easewithexam.com';
// Real EWE app icon, reused from public/icon-192.png — not a new asset.
// Absolute HTTPS URL is required: email clients do not resolve relative
// paths, and most strip <img> tags that don't already have one.
export const LOGO_URL      = 'https://www.easewithexam.com/icon-192.png';
export const SUPPORT_EMAIL = 'support@easewithexam.in';
export const FROM_ADDRESS  = 'EaseWithExam <support@easewithexam.com>';

export function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr><td style="background:#21A375;border-radius:12px;">
      <a href="${href}" style="display:inline-block;padding:13px 28px;font-size:14px;font-weight:700;color:#FFFFFF;text-decoration:none;">${label}</a>
    </td></tr>
  </table>`;
}

// Shared layout — inline styles throughout (email-client CSS support is
// limited to inline + a handful of safe properties), single 600px column,
// system font stack matching the app's own (Inter, falls back cleanly).
// `footerExtra` slots in an unsubscribe line when one applies (transactional
// account emails); omit it for the verification-code email, which isn't a
// "notification" a student would unsubscribe from — it only ever fires
// because they clicked "Connect email" themselves.
export function layout(bodyHtml: string, footerExtra: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EaseWithExam</title>
</head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:20px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#21A375,#1B8660);padding:28px 32px;">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:36px;height:36px;border-radius:10px;overflow:hidden;">
                <img src="${LOGO_URL}" width="36" height="36" alt="EaseWithExam" style="display:block;width:36px;height:36px;border-radius:10px;">
              </td>
              <td style="padding-left:10px;font-weight:800;font-size:18px;color:#FFFFFF;">EaseWithExam</td>
            </tr></table>
          </td>
        </tr>
        <tr><td style="padding:32px;">
          ${bodyHtml}
        </td></tr>
        <tr>
          <td style="padding:20px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;">
            ${footerExtra}
            <p style="margin:0;font-size:12px;color:#94A3B8;">
              EaseWithExam · Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#94A3B8;">${SUPPORT_EMAIL}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export type TemplateRow = {
  template_key:  string;
  label:         string;
  subject:       string;
  heading:       string;
  body_text:     string;
  bullet_points: string[];
  button_label:  string;
  button_path:   string;
  footer_note:   string;
};

// Renders any DB-backed template row (welcome, paper_ready,
// subscription_active, verify_email — the ones with a fixed shape editable
// in AdminEmailTemplates.jsx) into {subject, html}. admin_broadcast is NOT
// one of these — its title/body are supplied fresh by the admin on every
// send, which is already a stronger form of customization than a static
// template would add, so it keeps its own small render function instead.
export function renderTemplateRow(
  row: TemplateRow,
  vars: Record<string, string>,
  buttonPathOverride?: string,
): { subject: string; html: string } {
  const subject = substitute(row.subject, vars);
  const heading = substitute(row.heading, vars);
  const body    = substitute(row.body_text, vars);
  const footer  = row.footer_note ? substitute(row.footer_note, vars) : '';

  const bulletsHtml = row.bullet_points?.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 20px;">${
        row.bullet_points.map((f) => `
          <tr><td style="padding:6px 0;font-size:14px;color:#334155;">
            <span style="color:#21A375;font-weight:700;">✓</span>&nbsp;&nbsp;${substitute(f, vars)}
          </td></tr>`).join('')
      }</table>`
    : '';

  const path = buttonPathOverride || row.button_path;
  const buttonHtml = (row.button_label && path)
    ? button(row.button_label, path.startsWith('http') ? path : `${SITE_URL}${path}`)
    : '';

  const html = `
    <h1 style="margin:0 0 12px;font-size:22px;color:#0F172A;">${heading}</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.7;color:#475569;white-space:pre-wrap;">${body}</p>
    ${bulletsHtml}
    ${buttonHtml}
    ${footer ? `<p style="margin:20px 0 0;font-size:13px;color:#94A3B8;">${footer}</p>` : ''}
  `;

  return { subject, html };
}

// Receipt-specific renderer (subscription_receipt only) — approved redesign,
// 2026-08-14 (see chat: side-by-side of the old checklist-style layout vs
// this one, rendered from a real completed transaction). Same admin-editable
// fields as renderTemplateRow above, just laid out like a receipt instead of
// a feature-announcement email:
//   subject      -> email subject, unchanged
//   heading      -> the "Payment received" status pill text
//   (vars.amount)-> the price itself, set large and centered — a receipt
//                   states its total once, unmissably, not as prose, so this
//                   comes straight from the amount variable, not a field
//   bullet_points-> the SAME stored "Label: value" strings the admin already
//                   edits as a bulleted checklist for every other template,
//                   here parsed on the first ":" and rendered as rows in a
//                   bordered table instead — no new admin field needed,
//                   Payment ID gets a monospace value cell by matching its
//                   own label text, everything else stays proportional text
//   body_text    -> the line below the table ("Your {{planName}} plan is
//                   active — the full toolkit is unlocked.")
//   button/footer-> identical to renderTemplateRow
export function renderReceiptEmail(
  row: TemplateRow,
  vars: Record<string, string>,
): { subject: string; html: string } {
  const subject  = substitute(row.subject, vars);
  const pillText = substitute(row.heading, vars);
  const body     = row.body_text ? substitute(row.body_text, vars) : '';
  const footer   = row.footer_note ? substitute(row.footer_note, vars) : '';

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

  const path = row.button_path;
  const buttonHtml = (row.button_label && path)
    ? button(row.button_label, path.startsWith('http') ? path : `${SITE_URL}${path}`)
    : '';

  const html = `
    <div style="text-align:center;margin:0 0 4px;">
      <span style="display:inline-flex;align-items:center;gap:6px;background:#F0FDF9;color:#156A4C;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:6px 14px;border-radius:999px;">✓ ${pillText}</span>
    </div>
    <h1 style="margin:16px 0 4px;font-size:30px;font-weight:800;color:#0F172A;text-align:center;letter-spacing:-0.01em;">${vars.amount ?? ''}</h1>
    <p style="margin:0 0 26px;font-size:14px;color:#64748B;text-align:center;">for ${vars.planName ?? ''}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E2E8F0;border-radius:14px;overflow:hidden;margin-bottom:24px;">
      ${rowsHtml}
    </table>
    <p style="margin:0 0 22px;font-size:14px;line-height:1.7;color:#475569;text-align:center;">${body}</p>
    ${buttonHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">${buttonHtml}</td></tr></table>` : ''}
    ${footer ? `<p style="margin:0;font-size:13px;color:#94A3B8;text-align:center;">${footer}</p>` : ''}
  `;

  return { subject, html };
}

// Hardcoded fallbacks — used only if the DB row is missing (deleted, or the
// table unreachable), so a template glitch never breaks the underlying
// feature (onboarding, paper generation, payment, connect-email) that
// triggered the send.
export const FALLBACK_TEMPLATES: Record<string, TemplateRow> = {
  welcome: {
    template_key: 'welcome', label: 'Welcome Email',
    subject: 'Welcome to EaseWithExam, {{name}}! 🎉',
    heading: "Hey {{name}}, you're all set 👋",
    body_text: "Your account is ready and set up for {{exam}}. Here's what's unlocked on your free plan right now:",
    bullet_points: [
      '20 AI practice questions every day',
      '2 full question papers per day',
      '2 full mock tests per week',
      'EWE — your AI study tutor (15 messages/day)',
      'Daily challenge + basic analytics',
    ],
    button_label: 'Start Practicing', button_path: '/practice/generate',
    footer_note: "Good luck with {{exam}} — we're rooting for you.",
  },
  paper_ready: {
    template_key: 'paper_ready', label: 'Paper Ready Email',
    subject: 'Your paper is ready 📝',
    heading: 'Your paper is ready!',
    body_text: '{{examType}} · {{subject}} — {{count}} questions, generated and waiting for you in Exam Center.',
    bullet_points: [], button_label: 'Start the Paper', button_path: '/exams?tab=papers', footer_note: '',
  },
  subscription_active: {
    template_key: 'subscription_active', label: 'Subscription Activated Email',
    subject: '{{planName}} is active — welcome aboard! 🎉',
    heading: '{{planName}} activated',
    // "unlimited practice questions, unlimited EWE tutoring" was the overclaim
    // fixed everywhere else on 2026-08-14 (premium is 350 AI / 250 EWE per day,
    // not Infinity) — this hardcoded fallback was the one place that edit
    // missed, since it only fires when the DB row is unexpectedly absent.
    body_text: 'Thanks for upgrading. Your full toolkit is open, with limits set high enough that you should not meet them: 350 AI practice questions a day, 250 EWE messages a day, unlimited mock tests, the Misconception Engine, and adaptive flashcards.',
    bullet_points: [], button_label: 'Go to Dashboard', button_path: '/dashboard', footer_note: '',
  },
  subscription_expiring: {
    template_key: 'subscription_expiring', label: 'Expiry Reminder Email',
    subject: 'Your {{planName}} plan ends in {{daysLeft}} day(s)',
    heading: 'Your access is ending soon',
    body_text: '{{planName}} ends on {{expiryDate}} ({{daysLeft}} day(s) left). Renew now to keep your limits and features without a gap.',
    bullet_points: [], button_label: 'Renew now', button_path: '/pricing', footer_note: '',
  },
  subscription_receipt: {
    template_key: 'subscription_receipt', label: 'Payment Receipt Email',
    subject: 'Your EaseWithExam receipt — {{planName}} ✅',
    // heading is the status-pill text (renderReceiptEmail), not a page
    // heading — kept short on purpose, it sits next to a ✓ in a small pill.
    heading: 'Payment received',
    body_text: 'Your {{planName}} plan is active — the full toolkit is unlocked.',
    bullet_points: [
      'Plan: {{planName}}',
      'Amount paid: {{amount}}',
      'Payment ID: {{paymentId}}',
      'Date: {{date}}',
    ],
    button_label: 'Go to Dashboard', button_path: '/dashboard',
    footer_note: 'Keep this email as your payment record. Questions about this charge? Reply to this email.',
  },
  verify_email: {
    template_key: 'verify_email', label: 'Connect-Email Verification Code',
    subject: 'Your EaseWithExam verification code',
    heading: 'Confirm your email',
    body_text: 'Enter this code in EaseWithExam to start receiving email notifications at this address.',
    bullet_points: [], button_label: '', button_path: '',
    footer_note: "This code expires in 30 minutes. Didn't request this? You can ignore this email.",
  },
};
