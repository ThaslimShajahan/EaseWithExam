/**
 * Shared between send-email and connect-email — the branded HTML shell,
 * button component, and {{placeholder}} substitution used to render
 * admin-configurable rows from the `email_templates` table (sql/0057).
 * Kept here instead of duplicated in both function directories so the two
 * never quietly drift in appearance.
 */

export const SITE_URL      = 'https://easewithexam.com';
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
              <td style="width:36px;height:36px;background:rgba(255,255,255,0.15);border-radius:10px;text-align:center;vertical-align:middle;font-weight:800;font-size:18px;color:#FFFFFF;">E</td>
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
    // fixed everywhere else on 2026-08-14 (premium is 200 AI / 150 EWE per day,
    // not Infinity) — this hardcoded fallback was the one place that edit
    // missed, since it only fires when the DB row is unexpectedly absent.
    body_text: 'Thanks for upgrading. Your full toolkit is open, with limits set high enough that you should not meet them: 200 AI practice questions a day, 150 EWE messages a day, unlimited mock tests, the Misconception Engine, and adaptive flashcards.',
    bullet_points: [], button_label: 'Go to Dashboard', button_path: '/dashboard', footer_note: '',
  },
  subscription_expiring: {
    template_key: 'subscription_expiring', label: 'Expiry Reminder Email',
    subject: 'Your {{planName}} plan ends in {{daysLeft}} day(s)',
    heading: 'Your access is ending soon',
    body_text: '{{planName}} ends on {{expiryDate}} ({{daysLeft}} day(s) left). Renew now to keep your limits and features without a gap.',
    bullet_points: [], button_label: 'Renew now', button_path: '/pricing', footer_note: '',
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
