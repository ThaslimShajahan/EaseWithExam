/**
 * Supabase Edge Function: send-push
 *
 * Sends Web Push notifications via VAPID + RFC 8291 encryption.
 * No Firebase service account or org-policy-gated keys needed.
 *
 * Prerequisites (run once in Supabase SQL Editor):
 *   INSERT INTO platform_settings (key, value)
 *   VALUES
 *     ('vapid_public_key',  '<your-public-key>'),
 *     ('vapid_private_key', '<your-private-key>')
 *   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
 *
 *   ALTER TABLE notification_prefs
 *     ADD COLUMN IF NOT EXISTS push_endpoint TEXT,
 *     ADD COLUMN IF NOT EXISTS push_p256dh   TEXT,
 *     ADD COLUMN IF NOT EXISTS push_auth     TEXT;
 *
 * Deploy: supabase functions deploy send-push
 */

import { serve }        from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_SUBJECT = 'mailto:support@easewithexam.in';

// ── Base64url helpers ─────────────────────────────────────────────────

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64 + '='.repeat((4 - b64.length % 4) % 4);
  return Uint8Array.from(atob(pad), c => c.charCodeAt(0));
}

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── HKDF (Extract + Expand via Web Crypto) ────────────────────────────

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key  = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

// ── Import VAPID key pair from base64url raw scalars ──────────────────

async function importVapidKeys(pubB64: string, privB64: string) {
  const pubBytes  = b64urlDecode(pubB64);   // 65 bytes: 0x04 || x(32) || y(32)
  const privBytes = b64urlDecode(privB64);  // 32 bytes: raw P-256 scalar

  const x = b64urlEncode(pubBytes.slice(1, 33));
  const y = b64urlEncode(pubBytes.slice(33, 65));
  const d = b64urlEncode(privBytes);

  const privateKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', d, x, y, key_ops: ['sign'] },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign'],
  );

  return { privateKey, pubBytes, pubB64 };
}

// ── VAPID JWT (ES256) ─────────────────────────────────────────────────

async function vapidJwt(endpoint: string, privateKey: CryptoKey): Promise<string> {
  const { origin } = new URL(endpoint);
  const now = Math.floor(Date.now() / 1000);
  const te  = new TextEncoder();

  const hdr = b64urlEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const pay = b64urlEncode(te.encode(JSON.stringify({ aud: origin, exp: now + 43200, sub: VAPID_SUBJECT })));
  const msg = `${hdr}.${pay}`;

  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, te.encode(msg))
  );
  return `${msg}.${b64urlEncode(sig)}`;
}

// ── Web Push message encryption (RFC 8291 + RFC 8188 aes128gcm) ───────

async function encryptPayload(
  plaintext:       string,
  p256dhB64:       string,
  authB64:         string,
  senderPubBytes:  Uint8Array,
  senderPrivKey:   CryptoKey,
): Promise<Uint8Array> {
  const te          = new TextEncoder();
  const receiverPub = b64urlDecode(p256dhB64);   // 65 bytes uncompressed P-256
  const authSecret  = b64urlDecode(authB64);      // 16 bytes

  // Import receiver public key for ECDH
  const receiverKey = await crypto.subtle.importKey(
    'raw', receiverPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  );

  // Shared secret via ECDH
  const ecdhBits   = await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderPrivKey, 256);
  const ecdhSecret = new Uint8Array(ecdhBits);

  // IKM per RFC 8291 §3.1
  const keyInfo = concat(te.encode('WebPush: info\x00'), receiverPub, senderPubBytes);
  const ikm     = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // CEK + nonce per RFC 8188
  const salt  = crypto.getRandomValues(new Uint8Array(16));
  const cek   = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\x00'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\x00'), 12);

  // Encrypt plaintext + 0x02 pad delimiter (single-record)
  const cekKey   = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const toEnc    = concat(te.encode(plaintext), new Uint8Array([0x02]));
  const ct       = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, toEnc));

  // RFC 8188 body: salt(16) | rs(4,BE) | idlen(1) | keyid(65) | ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);

  return concat(salt, rs, new Uint8Array([65]), senderPubBytes, ct);
}

// ── Send one push notification ────────────────────────────────────────

async function sendOne(
  endpoint:    string,
  p256dh:      string,
  auth:        string,
  payload:     string,
  vapidPriv:   CryptoKey,
  vapidPubB64: string,
): Promise<{ ok: boolean; endpoint: string; status: number }> {
  try {
    // Ephemeral ECDH key pair for content encryption
    const eph    = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const ephPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));

    const body = await encryptPayload(payload, p256dh, auth, ephPub, eph.privateKey);
    const jwt  = await vapidJwt(endpoint, vapidPriv);

    const resp = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        'Authorization':    `vapid t=${jwt}, k=${vapidPubB64}`,
        'TTL':              '86400',
      },
      body,
    });

    return { ok: resp.ok || resp.status === 201, endpoint, status: resp.status };
  } catch (e) {
    console.error('[send-push] sendOne error:', (e as Error).message);
    return { ok: false, endpoint, status: 0 };
  }
}

// ── Main handler ──────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST')    return new Response('Method not allowed', { status: 405, headers: CORS });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let reqBody: { caller_uid: string; title: string; body: string; user_id?: string; url?: string; icon?: string };
  try { reqBody = await req.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { caller_uid, title, body: msgBody, user_id, url = '/dashboard', icon = '/pwa-192x192.png' } = reqBody;
  if (!caller_uid || !title || !msgBody) return json(400, { error: 'Missing required fields' });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Verify caller is a platform admin
  const { data: adminCheck } = await supabase
    .from('admins').select('uid').eq('uid', caller_uid).eq('is_active', true).maybeSingle();
  if (!adminCheck) return json(403, { error: 'Unauthorized' });

  // Read VAPID keys from platform_settings (no Supabase secrets needed)
  const { data: settings } = await supabase
    .from('platform_settings').select('key, value').in('key', ['vapid_private_key', 'vapid_public_key']);

  const sm       = Object.fromEntries((settings ?? []).map((s: { key: string; value: string }) => [s.key, s.value]));
  const privB64  = sm['vapid_private_key'];
  const pubB64   = sm['vapid_public_key'];
  if (!privB64 || !pubB64) return json(500, { error: 'VAPID keys not found in platform_settings — run the SQL setup' });

  const { privateKey: vapidPriv, pubB64: vapidPubB64 } = await importVapidKeys(pubB64, privB64);

  // Fetch push subscriptions
  let query = supabase
    .from('notification_prefs')
    .select('user_id, push_endpoint, push_p256dh, push_auth')
    .eq('push_enabled', true)
    .not('push_endpoint', 'is', null)
    .not('push_p256dh',   'is', null)
    .not('push_auth',     'is', null);

  if (user_id) query = query.eq('user_id', user_id);

  const { data: prefs, error: prefErr } = await query;
  if (prefErr) return json(500, { error: prefErr.message });

  const subs = prefs ?? [];
  if (subs.length === 0) return json(200, { sent: 0, message: 'No active push subscriptions found' });

  const payload = JSON.stringify({ title, body: msgBody, url, icon });

  const results = await Promise.all(
    subs.slice(0, 500).map(s =>
      sendOne(s.push_endpoint, s.push_p256dh, s.push_auth, payload, vapidPriv, vapidPubB64)
    )
  );

  const sent = results.filter(r => r.ok).length;
  const gone = results.filter(r => r.status === 404 || r.status === 410);

  // Clean up expired subscriptions
  if (gone.length > 0) {
    await supabase
      .from('notification_prefs')
      .update({ push_endpoint: null, push_p256dh: null, push_auth: null, push_enabled: false })
      .in('push_endpoint', gone.map(r => r.endpoint));
  }

  console.log(`Web Push: sent=${sent} failed=${results.length - sent} cleaned=${gone.length}`);
  return json(200, { sent, failed: results.length - sent, total: subs.length });
});
