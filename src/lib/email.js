/**
 * Client-side trigger for the app's own transactional emails (send-email
 * edge function) — separate from Supabase Auth's own SMTP-via-Resend
 * (verification / password reset), which is configured server-side and
 * never touched from here.
 *
 * Fire-and-forget by design, matching sendPaperReadyPush in
 * backgroundGeneration.js: an email failing (missing RESEND_API_KEY,
 * network error, user unsubscribed) must never block or fail the action
 * that triggered it (onboarding, payment, paper generation).
 */

import { supabase } from './supabase';

export async function sendTransactionalEmail(uid, template, data = {}) {
  if (!uid) return;
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-email`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ caller_uid: uid, user_id: uid, template, data }),
    });
  } catch (err) {
    console.warn('[email] sendTransactionalEmail failed:', err?.message);
  }
}

/**
 * Connect-email flow (Part B) — unlike sendTransactionalEmail above, these
 * are interactive: the caller needs the real success/failure result (email
 * already taken, wrong code, etc.) to show the user, so they deliberately
 * do NOT swallow errors the way the fire-and-forget helper does.
 */
export async function requestEmailConnect(uid, email) {
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/connect-email`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ caller_uid: uid, email }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result?.error || 'request_failed');
  return result;
}

export async function confirmEmailConnect(uid, code) {
  const { data, error } = await supabase.rpc('confirm_email_connect', { p_uid: uid, p_code: code });
  if (error) throw new Error(error.message);
  return data; // { ok: true } | { ok: false, error: '...' }
}
