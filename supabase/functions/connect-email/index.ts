/**
 * Supabase Edge Function: connect-email
 *
 * Lets a phone-signup student (no email on file) add one for notification
 * delivery. Not a Firebase account-linking flow — the email never becomes a
 * login method, it's a stored field on `users` gated by a 6-digit code sent
 * to prove ownership. The code is generated, hashed, and emailed entirely
 * here, server-side — it's never returned in this function's HTTP response,
 * otherwise a caller could "verify" an email they don't actually control by
 * just reading the code back out of the request instead of their inbox.
 *
 * Confirming the code (confirm_email_connect RPC, sql/0056) is a separate,
 * plain Postgres RPC — no external I/O needed there, so no edge function.
 *
 * The wrapper copy (heading/body/footer) comes from the `verify_email` row
 * in `email_templates` (sql/0057) — editable in Admin → Platform → Email
 * Templates — with the big styled code box always rendered separately below
 * the body text, since that's a fixed visual element, not admin copy.
 *
 * Requires RESEND_API_KEY (same secret as send-email).
 * Deploy: supabase functions deploy connect-email
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { FROM_ADDRESS, layout, substitute, FALLBACK_TEMPLATES } from '../_shared/emailLayout.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';

function sha256hex(input: string): Promise<string> {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
    .then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join(''));
}

async function renderVerifyEmail(supabase: ReturnType<typeof createClient>, code: string) {
  const { data: row } = await supabase.from('email_templates').select('*').eq('template_key', 'verify_email').maybeSingle();
  const t = row ?? FALLBACK_TEMPLATES.verify_email;
  const vars = { code };

  const html = `
    <div style="text-align:center;">
      <h1 style="margin:0 0 8px;font-size:18px;color:#0F172A;">${substitute(t.heading, vars)}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#475569;line-height:1.6;">${substitute(t.body_text, vars)}</p>
      <div style="display:inline-block;background:#F0FDF9;border:1px solid #D0F1E6;border-radius:14px;padding:16px 32px;font-size:32px;font-weight:800;letter-spacing:8px;color:#156A4C;">
        ${code}
      </div>
      ${t.footer_note ? `<p style="margin:20px 0 0;font-size:12px;color:#94A3B8;">${substitute(t.footer_note, vars)}</p>` : ''}
    </div>
  `;
  return { subject: substitute(t.subject, vars), html };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let reqBody: { caller_uid: string; email: string };
  try { reqBody = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { caller_uid, email } = reqBody;
  if (!caller_uid || !email) return json(400, { error: 'Missing required fields' });

  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return json(400, { error: 'invalid_email' });
  }

  if (!RESEND_API_KEY) {
    console.error('[connect-email] RESEND_API_KEY not configured');
    return json(503, { error: 'Email sending is not configured (RESEND_API_KEY missing)' });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Self-service only — this is always the user connecting their own email,
  // never an admin acting on someone's behalf.
  const { data: caller } = await supabase.from('users').select('firebase_uid, email').eq('firebase_uid', caller_uid).maybeSingle();
  if (!caller) return json(404, { error: 'account_not_found' });

  // Already-has-email accounts shouldn't be re-prompted — the client already
  // hides this flow for them, but enforce it server-side too.
  if (caller.email) return json(400, { error: 'already_has_email' });

  // The real account-integrity check: is this email already claimed by a
  // DIFFERENT account's verified `email`? (users_email_unique_idx, sql/0056,
  // is the hard backstop at confirm time — this is the friendly early check.)
  const { data: existing } = await supabase
    .from('users').select('firebase_uid').ilike('email', normalized).neq('firebase_uid', caller_uid).maybeSingle();
  if (existing) return json(409, { error: 'email_taken' });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256hex(code);

  const { error: updateErr } = await supabase
    .from('users')
    .update({
      pending_email: normalized,
      pending_email_code_hash: codeHash,
      pending_email_requested_at: new Date().toISOString(),
    })
    .eq('firebase_uid', caller_uid);
  if (updateErr) return json(500, { error: updateErr.message });

  const { subject, html: bodyHtml } = await renderVerifyEmail(supabase, code);

  const resendResp = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      normalized,
      subject,
      html:    layout(bodyHtml, ''),
    }),
  });

  if (!resendResp.ok) {
    const errText = await resendResp.text().catch(() => '');
    console.error('[connect-email] Resend API error:', resendResp.status, errText);
    return json(502, { error: 'Resend API error', status: resendResp.status });
  }

  return json(200, { ok: true });
});
