/**
 * Supabase Edge Function: resend-inbound
 *
 * Receives Resend's `email.received` webhook and files the message into the
 * admin Support Inbox (resend_inbound_emails table, Admin > Support Inbox).
 * Inert until the owner does two things outside this repo:
 *   1. Add the MX record Resend's dashboard shows for the receiving
 *      domain/subdomain to easewithexam.com's DNS.
 *   2. Create a webhook in the Resend dashboard for `email.received`,
 *      pointed at this function's URL, and store the signing secret it
 *      generates as RESEND_WEBHOOK_SECRET (never committed).
 *
 * The webhook payload carries metadata only (from/to/subject/message id/
 * attachment stubs) — NOT the body. This function fetches the full text/html
 * via a follow-up call to Resend's Retrieve Received Email API
 * (GET /emails/receiving/{id}) using the same RESEND_API_KEY already
 * configured for outbound mail.
 *
 * Signature verification follows Resend's documented scheme (Svix-
 * compatible): svix-id + "." + svix-timestamp + "." + raw body, HMAC-SHA256
 * keyed on the base64-decoded secret (after stripping its "whsec_" prefix),
 * compared against any of the space-separated "v1,<sig>" values in
 * svix-signature. Hand-rolled rather than pulling in the svix npm package —
 * same "no extra dependency for a well-documented HMAC scheme" choice
 * already made in razorpay-verify/razorpay-webhook for their own signatures.
 * A 5-minute timestamp tolerance guards against replaying an old, valid
 * signature.
 *
 * Deploy (note --no-verify-jwt — Resend's webhook cannot send a Supabase
 * JWT, so the platform-level JWT gate must be off; this function's own
 * signature check is the real gate, same pattern as unsubscribe-email):
 *   supabase secrets set RESEND_WEBHOOK_SECRET=whsec_...
 *   supabase functions deploy resend-inbound --no-verify-jwt
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac }   from 'https://deno.land/std@0.177.0/node/crypto.ts';

const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')            ?? '';
const SERVICE_KEY        = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY')          ?? '';
const WEBHOOK_SECRET     = Deno.env.get('RESEND_WEBHOOK_SECRET')   ?? '';

const TOLERANCE_SECONDS = 5 * 60;

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function verifySvixSignature(
  rawBody: string, svixId: string, svixTimestamp: string, svixSignature: string,
): boolean {
  if (!WEBHOOK_SECRET) return false; // fail closed — unconfigured means allow no one

  const now = Math.floor(Date.now() / 1000);
  const ts = Number(svixTimestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > TOLERANCE_SECONDS) return false;

  const secretBytes = base64ToBytes(WEBHOOK_SECRET.replace(/^whsec_/, ''));
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // svix-signature can carry multiple space-separated "v1,<sig>" values
  // (key rotation) — match against any of them.
  return svixSignature
    .split(' ')
    .map((part) => part.split(',')[1])
    .filter(Boolean)
    .some((sig) => sig === expected);
}

type ReceivedEmailWebhook = {
  type: string;
  data: {
    email_id:      string;
    from:          string;
    to:            string[];
    subject:       string;
    message_id?:   string;
    created_at?:   string;
  };
};

async function fetchFullEmail(emailId: string): Promise<{ text: string | null; html: string | null; attachments: unknown[] }> {
  if (!RESEND_API_KEY) return { text: null, html: null, attachments: [] };
  try {
    const resp = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
    });
    if (!resp.ok) {
      console.error('resend-inbound: retrieve-received-email failed', resp.status, await resp.text().catch(() => ''));
      return { text: null, html: null, attachments: [] };
    }
    const full = await resp.json();
    return { text: full?.text ?? null, html: full?.html ?? null, attachments: full?.attachments ?? [] };
  } catch (e) {
    console.error('resend-inbound: retrieve-received-email threw', (e as Error).message);
    return { text: null, html: null, attachments: [] };
  }
}

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const svixId        = req.headers.get('svix-id')        ?? '';
  const svixTimestamp  = req.headers.get('svix-timestamp') ?? '';
  const svixSignature  = req.headers.get('svix-signature') ?? '';

  if (!verifySvixSignature(rawBody, svixId, svixTimestamp, svixSignature)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let event: ReceivedEmailWebhook;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON body', { status: 400 });
  }

  // Only the one event type this endpoint is subscribed to should ever
  // arrive, but a dashboard misconfiguration is easy — ack politely rather
  // than erroring so Resend doesn't treat a harmless mismatch as a delivery
  // failure and keep retrying it.
  if (event?.type !== 'email.received' || !event.data?.email_id) {
    return new Response(JSON.stringify({ received: true, ignored: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const { email_id, from, to, subject, message_id, created_at } = event.data;
  const full = await fetchFullEmail(email_id);

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await supabase.from('resend_inbound_emails').upsert({
    resend_email_id:   email_id,
    from_address:       from ?? '',
    to_addresses:        to ?? [],
    subject:              subject ?? '',
    message_id:           message_id ?? null,
    body_text:            full.text,
    body_html:            full.html,
    attachments:          full.attachments,
    resend_created_at:    created_at ?? null,
  }, { onConflict: 'resend_email_id' });

  if (error) {
    console.error('resend-inbound: insert failed', error);
    return new Response(JSON.stringify({ error: 'Failed to file inbound email' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }

  console.log(`✅ Inbound email filed: ${email_id} from ${from}`);
  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
});
