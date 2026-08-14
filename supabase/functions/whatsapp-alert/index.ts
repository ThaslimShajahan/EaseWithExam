/**
 * Edge Function: whatsapp-alert
 * Sends WhatsApp via Twilio. Two modes:
 *   Single:    { to: "+919876543210", message: "Hello!" }
 *   Broadcast: { broadcast: true, message: "Hello everyone!" }
 *              → fetches everyone with whatsapp_enabled=true in notification_prefs,
 *                sends to their VERIFIED users.phone_number (Firebase OTP,
 *                see NotificationSettings.jsx) — 2026-08-14, no longer a
 *                second unverified number typed into notification_prefs
 *                itself.
 *
 * Supabase Secrets required (set via `supabase secrets set`, values live
 * only in Supabase, never committed here):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM  = whatsapp:+14155238886
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TWILIO_SID   = Deno.env.get('TWILIO_ACCOUNT_SID')    ?? '';
const TWILIO_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN')      ?? '';
const TWILIO_FROM  = Deno.env.get('TWILIO_WHATSAPP_FROM')   ?? 'whatsapp:+14155238886';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')           ?? '';
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function sendOne(to: string, body: string): Promise<{ ok: boolean; to: string; error?: string }> {
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  const url  = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;
  const form = new URLSearchParams({ From: TWILIO_FROM, To: toFormatted, Body: body });

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { ok: false, to, error: err.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, to };
  } catch (e) {
    return { ok: false, to, error: (e as Error).message };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  if (!TWILIO_SID || !TWILIO_TOKEN) {
    return json(500, { error: 'Twilio secrets not configured. Add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Supabase Secrets.' });
  }

  let body: {
    to?: string;
    message?: string;
    broadcast?: boolean;
    studentName?: string;
    weeklyStats?: Record<string, unknown>;
    caller_uid?: string;
  };

  try { body = await req.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { to, message, broadcast, studentName, weeklyStats, caller_uid } = body;

  // Build message text
  let text = message ?? '';
  if (!text && weeklyStats) {
    text =
      `📊 *EaseWithExam Weekly Report*\n\n` +
      `Student: *${studentName || 'Your child'}*\n\n` +
      `📝 Tests taken: *${weeklyStats.testCount}*\n` +
      `🎯 Avg score: *${weeklyStats.avgScore}%*\n` +
      `🔥 Study streak: *${weeklyStats.streak} days*\n` +
      `💎 XP earned: *${weeklyStats.xpEarned || 0}*\n\n` +
      `_Keep up the great work! — EaseWithExam_`;
  }

  if (!text) return json(400, { error: 'message is required' });

  /* ── Single send ─────────────────────────────────────────── */
  if (!broadcast) {
    if (!to) return json(400, { error: 'to is required for single send' });
    const result = await sendOne(to, text);
    return json(result.ok ? 200 : 500, result);
  }

  /* ── Broadcast: fetch all opted-in users ─────────────────── */
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verify caller is an admin (broadcast requires admin auth) — caller_uid is mandatory,
  // not optional, otherwise this check is trivially bypassed by omitting the field.
  if (!caller_uid) return json(403, { error: 'Unauthorized' });
  const { data: adminCheck } = await db
    .from('admins').select('uid').eq('uid', caller_uid).eq('is_active', true).maybeSingle();
  if (!adminCheck) return json(403, { error: 'Unauthorized' });

  // Targets the Firebase-OTP-verified number (users.phone_number), not a
  // second manually-typed one — 2026-08-14. notification_prefs.whatsapp_number
  // no longer exists as a write path (NotificationSettings.jsx's toggle only
  // sets whatsapp_enabled now); this only reads the opt-in flag from there
  // and joins the actual number from `users` in JS, since notification_prefs
  // has no formal FK to users to embed the select through.
  const { data: prefs, error: prefErr } = await db
    .from('notification_prefs')
    .select('user_id')
    .eq('whatsapp_enabled', true);

  if (prefErr) return json(500, { error: prefErr.message });
  if (!prefs?.length) return json(200, { sent: 0, message: 'No users with WhatsApp enabled' });

  const { data: users, error: usersErr } = await db
    .from('users')
    .select('firebase_uid, phone_number')
    .in('firebase_uid', prefs.map((p) => p.user_id))
    .not('phone_number', 'is', null);

  if (usersErr) return json(500, { error: usersErr.message });

  const targets = (users ?? []).filter((u) => u.phone_number?.trim());
  if (!targets.length) return json(200, { sent: 0, message: 'No opted-in users have a verified phone number' });

  // Send in batches of 5 (Twilio rate limit friendly)
  const results: { ok: boolean; to: string; error?: string }[] = [];
  for (let i = 0; i < targets.length; i += 5) {
    const batch = targets.slice(i, i + 5);
    const batchResults = await Promise.all(batch.map(u => sendOne(u.phone_number!, text)));
    results.push(...batchResults);
    if (i + 5 < targets.length) await new Promise(r => setTimeout(r, 200));
  }

  const sent   = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok);

  console.log(`WhatsApp broadcast: sent=${sent} failed=${failed.length} total=${targets.length}`);
  return json(200, { sent, failed: failed.length, total: targets.length, errors: failed.map(f => f.error) });
});
