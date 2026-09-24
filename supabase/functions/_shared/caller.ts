/**
 * Who is calling this edge function — decided from credentials, never from
 * the request body.
 *
 * Security pass 2 (2026-09-25): send-email, send-push, exam-scraper,
 * connect-email and pdf-proxy used to trust a `caller_uid` from the JSON
 * body, and an active admin uid is readable by anyone — so "is this caller an
 * admin?" was answerable by typing one. Proven live with non-delivering probes.
 *
 * A caller is one of:
 *   internal — the platform itself:
 *                Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *                  (razorpay-verify / razorpay-webhook send this), or
 *                x-internal-secret: <INTERNAL_CALL_SECRET>
 *                  (the DB's own cron via pg_net; migration 20260926000000)
 *   user     — a signed-in student or admin:
 *                x-firebase-id-token: <Firebase ID token>
 *              forwarded to the whoami_verified() RPC, so Supabase verifies
 *              the token exactly as it does for every other RPC. Admin role
 *              comes from the admins table for THAT verified uid.
 *
 * Authorization stays the anon key for browser calls so the gateway's
 * verify_jwt check is unchanged; the Firebase token rides its own header.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL    = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ANON_KEY        = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const INTERNAL_SECRET = Deno.env.get('INTERNAL_CALL_SECRET') ?? '';

/** Headers a browser must be allowed to send (add to each function's CORS). */
export const CALLER_CORS_HEADERS = 'authorization, x-client-info, apikey, content-type, x-firebase-id-token';

export type Caller =
  | { kind: 'internal' }
  | { kind: 'user'; uid: string; adminRole: string | null };

/** Constant-time string compare — no early exit on the first differing char. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** null = no valid credentials at all (the caller should answer 401). */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const auth   = req.headers.get('authorization') ?? '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  if (SERVICE_KEY && safeEqual(bearer, SERVICE_KEY)) return { kind: 'internal' };

  const internal = req.headers.get('x-internal-secret') ?? '';
  if (INTERNAL_SECRET && safeEqual(internal, INTERNAL_SECRET)) return { kind: 'internal' };

  const idToken = req.headers.get('x-firebase-id-token') ?? '';
  if (!idToken) return null;

  const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${idToken}` } },
    auth:   { persistSession: false },
  });
  const { data, error } = await asCaller.rpc('whoami_verified');
  if (error || !data?.uid) return null;
  return { kind: 'user', uid: String(data.uid), adminRole: data.admin_role ?? null };
}

export const isAdmin = (c: Caller | null): boolean =>
  !!c && c.kind === 'user' && (c.adminRole === 'admin' || c.adminRole === 'superadmin');
