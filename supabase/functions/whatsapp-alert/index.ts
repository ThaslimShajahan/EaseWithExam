/**
 * Edge Function: whatsapp-alert — DISABLED (owner decision, 2026-09-25).
 *
 * Security pass 2 found that its single-send path had no authorization at all:
 * with nothing but the public anon key, anyone could send any text to any
 * number from the company's Twilio WhatsApp sender (proven live with a
 * no-recipient probe that reached the send branch). Its admin broadcast path
 * trusted a body caller_uid, and an admin uid was publicly readable. The
 * admin screen's own single send passed a Firebase uid as the phone number,
 * so it never worked either.
 *
 * Every request now gets 410 Gone with a clear message, and NO sending code
 * exists in this file — not behind a flag, not unreachable-but-present. The
 * previous implementation is in git history (commit before this one) for
 * whoever rebuilds it: see docs/ACTION_ITEMS_FOR_YOU.md "Rebuild WhatsApp".
 */
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-firebase-id-token',
};

serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  return new Response(
    JSON.stringify({ disabled: true, error: 'WhatsApp alerts are disabled until they are rebuilt.' }),
    { status: 410, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
