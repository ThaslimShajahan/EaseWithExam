/**
 * Supabase Edge Function: send-email
 *
 * Sends the app's own transactional emails (welcome, paper-ready,
 * subscription-active, admin broadcasts) via the Resend API. This is
 * separate from Supabase Auth's own SMTP-via-Resend setup, which only
 * handles auth emails (verification / password reset) and is configured in
 * the Supabase dashboard, not here.
 *
 * welcome / paper_ready / subscription_active are rendered from the
 * `email_templates` table (sql/0057) — editable in Admin → Platform → Email
 * Templates without a code deploy — falling back to the hardcoded copy in
 * _shared/emailLayout.ts if a row is ever missing. admin_broadcast is NOT
 * one of these: its title/body are supplied fresh by the admin on every
 * send (AdminPushNotifications.jsx), which is already more customization
 * than a static template would add.
 *
 * Two modes:
 *   Single:    { caller_uid, user_id, template, data }
 *   Broadcast: { caller_uid, broadcast: true, template: 'admin_broadcast', data }
 *              → admin-only; fetches every user with an email on file who
 *              hasn't opted out, and sends via Resend's batch endpoint
 *              (POST /emails/batch, up to 100 personalized emails per HTTP
 *              call) instead of one request per recipient — the same
 *              "one edge-function call fans out server-side" shape already
 *              used by send-push and whatsapp-alert's broadcast mode, so a
 *              class of thousands of students doesn't mean thousands of
 *              round trips or a client-side loop that could run past the
 *              request lifetime.
 *
 * Requires the RESEND_API_KEY secret:
 *   supabase secrets set RESEND_API_KEY=re_xxx
 * Until that's set, this function responds 503 with a clear message instead
 * of throwing — callers on the client already fire-and-forget these calls
 * (`.catch(() => {})`), so a missing key never breaks the feature that
 * triggered the email.
 *
 * Deploy: supabase functions deploy send-email
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  FROM_ADDRESS, SITE_URL, layout, button, renderTemplateRow, renderReceiptEmail, FALLBACK_TEMPLATES,
} from '../_shared/emailLayout.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

const DB_BACKED_TEMPLATES = new Set([
  'welcome', 'paper_ready', 'subscription_active', 'subscription_expiring', 'subscription_receipt',
]);

// ── Unsubscribe token: HMAC-SHA256(uid) keyed on the service-role secret,
// so the link can't be forged to unsubscribe someone else, without needing
// a dedicated signing secret of its own. ────────────────────────────────
async function signUid(uid: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(uid)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function unsubscribeUrl(uid: string): Promise<string> {
  const token = await signUid(uid);
  return `${SUPABASE_URL}/functions/v1/unsubscribe-email?u=${encodeURIComponent(uid)}&t=${token}`;
}

const unsubFooter = (unsubUrl: string) => `
  <p style="margin:0 0 6px;font-size:12px;color:#64748B;line-height:1.6;">
    You're receiving this because you have an EaseWithExam account.
    <a href="${unsubUrl}" style="color:#64748B;text-decoration:underline;">Unsubscribe from these emails</a>.
  </p>`;

// Generic admin-composed notification (AdminPushNotifications.jsx) — see
// file header for why this isn't a DB-backed template like the others.
function renderAdminBroadcast(data: Record<string, unknown>): { subject: string; html: string } {
  const title = (data.title as string) || 'Update from EaseWithExam';
  const bodyText = (data.body as string) || '';
  const url = (data.url as string) || '';
  return {
    subject: title,
    html: `
      <h1 style="margin:0 0 12px;font-size:20px;color:#0F172A;">${title}</h1>
      <p style="margin:0 0 8px;font-size:14px;line-height:1.7;color:#475569;white-space:pre-wrap;">${bodyText}</p>
      ${url ? button('Open EaseWithExam', url.startsWith('http') ? url : `${SITE_URL}${url}`) : ''}
    `,
  };
}

async function renderTemplate(
  supabase: ReturnType<typeof createClient>,
  template: string,
  data: Record<string, unknown>,
): Promise<{ subject: string; html: string } | null> {
  if (template === 'admin_broadcast') return renderAdminBroadcast(data);
  if (!DB_BACKED_TEMPLATES.has(template)) return null;

  const { data: row } = await supabase.from('email_templates').select('*').eq('template_key', template).maybeSingle();
  const templateRow = row ?? FALLBACK_TEMPLATES[template];

  const vars: Record<string, string> =
    template === 'welcome' ? {
      name: (data.displayName as string) || 'there',
      exam: (data.targetExam as string) || 'your exam',
    } :
    template === 'paper_ready' ? {
      examType: (data.examType as string) || '',
      subject:  (data.subject as string) || '',
      count:    String((data.questionCount as number) ?? 0),
    } :
    template === 'subscription_expiring' ? {
      planName:   (data.planName as string) || 'your plan',
      daysLeft:   String((data.daysLeft as number) ?? 0),
      expiryDate: (data.expiryDate as string) || '',
    } :
    template === 'subscription_receipt' ? {
      // Found 2026-08-15: this transaction is always tied to a real user —
      // `user` (fetched below, single-send only) already has display_name
      // and email in scope, the same values 'welcome' already reads via
      // data.displayName. The receipt template just never asked for them.
      // Composed into one billedTo string (rather than separate name/email
      // vars substituted into a fixed "Name (Email)" bullet) so a student
      // who never set a display name gets a clean "Billed to: their@email"
      // instead of an awkward "Billed to:  (their@email)" with a dangling
      // leading space — no placeholder like "there" either; a genuinely
      // missing name should read as absent, not faked.
      billedTo: (() => {
        const name  = (data.displayName as string) || '';
        const email = (data.recipientEmail as string) || '';
        return name ? `${name} (${email})` : email;
      })(),
      planName:       (data.planName as string) || 'Premium',
      baseAmount:     (data.baseAmount as string) || '',
      gstAmount:      (data.gstAmount as string) || '',
      gstRatePercent: String((data.gstRatePercent as number) ?? 0),
      totalAmount:    (data.totalAmount as string) || '',
      paymentId:      (data.paymentId as string) || '',
      date:           (data.date as string) || '',
    } :
    { planName: (data.planName as string) || 'Premium' }; // subscription_active

  if (template === 'subscription_receipt') return renderReceiptEmail(templateRow, vars);

  const buttonPathOverride = template === 'paper_ready' ? (data.link as string | undefined) : undefined;
  return renderTemplateRow(templateRow, vars, buttonPathOverride);
}

// Max recipients per broadcast — a batch job, not truly unbounded, so a
// runaway "All Students" send on a much larger future user base can't run
// past the edge function's execution time. Comfortably above any realistic
// current student count; raise if the platform genuinely grows past it.
const BROADCAST_CAP = 2000;
const RESEND_BATCH_SIZE = 100; // Resend's documented max per /emails/batch call

async function buildEmailPayload(
  supabase: ReturnType<typeof createClient>, template: string, data: Record<string, unknown>, to: string, uid: string,
) {
  const rendered = await renderTemplate(supabase, template, data);
  if (!rendered) return null;
  const unsubUrl = await unsubscribeUrl(uid);
  return { from: FROM_ADDRESS, to, subject: rendered.subject, html: layout(rendered.html, unsubFooter(unsubUrl)) };
}

// ── Main handler ─────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let reqBody: {
    caller_uid: string; user_id?: string; template: string; data?: Record<string, unknown>;
    broadcast?: boolean;
  };
  try { reqBody = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { caller_uid, user_id, template, data = {}, broadcast } = reqBody;
  if (!caller_uid || !template || (!user_id && !broadcast)) return json(400, { error: 'Missing required fields' });

  if (template !== 'admin_broadcast' && !DB_BACKED_TEMPLATES.has(template)) {
    return json(400, { error: `Unknown template: ${template}` });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  /* ── Broadcast: admin-only, fans out to every eligible user ── */
  if (broadcast) {
    const { data: adminCheck } = await supabase
      .from('admins').select('uid').eq('uid', caller_uid).eq('is_active', true).maybeSingle();
    if (!adminCheck) return json(403, { error: 'Unauthorized' });

    if (!RESEND_API_KEY) {
      console.error('[send-email] RESEND_API_KEY not configured — skipping broadcast');
      return json(503, { error: 'Email sending is not configured (RESEND_API_KEY missing)' });
    }

    const [{ data: users, error: usersErr }, { data: optedOut }] = await Promise.all([
      supabase.from('users').select('firebase_uid, email').not('email', 'is', null),
      supabase.from('notification_prefs').select('user_id').eq('email_enabled', false),
    ]);
    if (usersErr) return json(500, { error: usersErr.message });

    const optedOutSet = new Set((optedOut ?? []).map((p: { user_id: string }) => p.user_id));
    const recipients = (users ?? [])
      .filter((u: { firebase_uid: string; email: string }) => u.email?.trim() && !optedOutSet.has(u.firebase_uid))
      .slice(0, BROADCAST_CAP);

    if (!recipients.length) return json(200, { sent: 0, total: 0, message: 'No eligible recipients (no email on file, or all opted out)' });

    let sent = 0;
    const failures: string[] = [];
    for (let i = 0; i < recipients.length; i += RESEND_BATCH_SIZE) {
      const batch = recipients.slice(i, i + RESEND_BATCH_SIZE);
      const payloads = (await Promise.all(
        batch.map((r: { firebase_uid: string; email: string }) =>
          buildEmailPayload(supabase, template, data, r.email, r.firebase_uid)),
      )).filter(Boolean);

      try {
        const resp = await fetch('https://api.resend.com/emails/batch', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${RESEND_API_KEY}` },
          body: JSON.stringify(payloads),
        });
        if (resp.ok) {
          sent += batch.length;
        } else {
          const errText = await resp.text().catch(() => '');
          console.error('[send-email] broadcast batch error:', resp.status, errText);
          failures.push(`batch ${i / RESEND_BATCH_SIZE}: HTTP ${resp.status}`);
        }
      } catch (e) {
        failures.push((e as Error).message);
      }

      if (i + RESEND_BATCH_SIZE < recipients.length) await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`[send-email] broadcast: sent=${sent} total=${recipients.length} failedBatches=${failures.length}`);
    return json(200, { sent, total: recipients.length, failedBatches: failures.length, errors: failures });
  }

  /* ── Single send ──────────────────────────────────────────── */
  // Self-send only, or an active admin sending on a user's behalf — same
  // authorization shape as send-push.
  const isSelfSend = caller_uid === user_id;
  if (!isSelfSend) {
    const { data: adminCheck } = await supabase
      .from('admins').select('uid').eq('uid', caller_uid).eq('is_active', true).maybeSingle();
    if (!adminCheck) return json(403, { error: 'Unauthorized' });
  }

  // Respect an explicit email opt-out. No row at all means never opted out
  // (the row is only created once a preference is actually changed).
  const { data: prefs } = await supabase
    .from('notification_prefs').select('email_enabled').eq('user_id', user_id).maybeSingle();
  if (prefs && prefs.email_enabled === false) {
    return json(200, { skipped: true, reason: 'user_unsubscribed' });
  }

  const { data: user } = await supabase
    .from('users').select('email, display_name').eq('firebase_uid', user_id).maybeSingle();
  if (!user?.email) return json(200, { skipped: true, reason: 'no_email_on_file' });

  if (!RESEND_API_KEY) {
    console.error('[send-email] RESEND_API_KEY not configured — skipping send');
    return json(503, { error: 'Email sending is not configured (RESEND_API_KEY missing)' });
  }

  // recipientEmail added 2026-08-15 alongside displayName's existing
  // fallback — user.email is already fetched right above for the send
  // itself, the receipt template just never received it as a var. Same
  // reasoning as displayName: the caller (razorpay-verify/-webhook) doesn't
  // need to know or pass this, it's already known here.
  const payload = await buildEmailPayload(
    supabase, template,
    { ...data, displayName: data.displayName ?? user.display_name, recipientEmail: data.recipientEmail ?? user.email },
    user.email, user_id!,
  );
  if (!payload) return json(400, { error: `Unknown template: ${template}` });

  const resendResp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      // Explicit charset — 2026-08-14, ₹ (U+20B9) rendered as a literal "?"
      // in a real delivered receipt. JSON is UTF-8 by spec regardless, and
      // the JS string itself carries the correct codepoint the whole way
      // through (verified: source bytes, the JSON body, and the <meta
      // charset="utf-8"> in the HTML shell were all already correct) — the
      // one place charset was never stated explicitly was this header, and
      // an implementation that charset-sniffs a bare "application/json"
      // rather than assuming UTF-8 is exactly how a correct codepoint
      // becomes "?" without anything in this codebase being wrong.
      'Content-Type':  'application/json; charset=utf-8',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text().catch(() => '');
    console.error('[send-email] Resend API error:', resendResp.status, errText);
    return json(502, { error: 'Resend API error', status: resendResp.status });
  }

  const result = await resendResp.json().catch(() => ({}));
  return json(200, { sent: true, id: result?.id });
});
