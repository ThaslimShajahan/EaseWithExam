/**
 * Supabase Edge Function: unsubscribe-email
 *
 * One-click unsubscribe target for links in send-email's templates. GET
 * only (email clients / browsers hitting a link, not a fetch call from the
 * app) — verifies the HMAC token from send-email, flips
 * notification_prefs.email_enabled to false, and returns a small
 * confirmation page. Invalid/tampered tokens get a generic failure page
 * rather than any hint about why, and never touch the database.
 *
 * Deploy: supabase functions deploy unsubscribe-email --no-verify-jwt
 * (--no-verify-jwt is required — this is opened directly from an email
 * client with no Supabase Authorization header available; the HMAC token
 * in the URL is this function's own auth check.)
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

async function signUid(uid: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SERVICE_KEY),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(uid)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function page(title: string, message: string): Response {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — EaseWithExam</title></head>
<body style="margin:0;padding:40px 16px;background:#F1F5F9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;">
  <div style="max-width:420px;margin:0 auto;background:#FFFFFF;border-radius:20px;padding:32px;text-align:center;">
    <div style="width:44px;height:44px;background:#21A375;border-radius:12px;margin:0 auto 16px;color:#fff;font-weight:800;font-size:20px;line-height:44px;">E</div>
    <h1 style="margin:0 0 8px;font-size:18px;color:#0F172A;">${title}</h1>
    <p style="margin:0;font-size:14px;color:#64748B;line-height:1.6;">${message}</p>
  </div>
</body></html>`;
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

serve(async (req) => {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const url   = new URL(req.url);
  const uid   = url.searchParams.get('u');
  const token = url.searchParams.get('t');
  if (!uid || !token) return page('Link invalid', 'This unsubscribe link is missing required information.');

  const expected = await signUid(uid);
  if (expected !== token) {
    return page('Link invalid', 'This unsubscribe link is invalid or has expired. If you keep getting emails you did not expect, contact support@easewithexam.in.');
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await supabase.rpc('set_email_enabled', { p_uid: uid, p_enabled: false });
  if (error) {
    console.error('[unsubscribe-email] set_email_enabled failed:', error.message);
    return page('Something went wrong', 'We could not process your request right now. Please try again later.');
  }

  return page('Unsubscribed', "You won't receive further emails from EaseWithExam. You'll still see in-app notifications when you're signed in.");
});
