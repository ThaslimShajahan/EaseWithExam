/**
 * Supabase Edge Function — PDF Proxy + Storage Uploader
 *
 * GET  ?url=https://...   → fetch PDF server-side, validate, return bytes
 * POST ?filename=foo.pdf  → receive PDF bytes in body, upload to Supabase Storage
 *                           using service_role_key (bypasses RLS), return { storagePath, publicUrl }
 *
 * Security pass 2 (2026-09-25): this used to need no credentials at all, so
 * anyone could store arbitrary PDFs in the public question-papers bucket with
 * the service-role key, or use GET as an open fetcher. Now:
 *   POST — verified ADMIN only, max 50 MB.
 *   GET  — any signed-in user (verified Firebase token), https:// only, no
 *          private/loopback/link-local hosts, max 60 MB.
 * Every current caller is an admin screen (Admin Papers, Content Intake,
 * Paper Templates via lib/pdfAnalyzer.js).
 *
 * Deploy: supabase functions deploy pdf-proxy --no-verify-jwt
 * (verify_jwt stays off; resolveCaller() is the gate.)
 */
import { resolveCaller, isAdmin, CALLER_CORS_HEADERS } from '../_shared/caller.ts';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': CALLER_CORS_HEADERS,
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET           = 'question-papers';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_FETCH_BYTES  = 60 * 1024 * 1024;

function isPdf(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 5) return false;
  const b = new Uint8Array(buf, 0, 5);
  return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF-
}

function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]/g, '_').replace(/__+/g, '_');
}

function jsonErr(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** https only, and never an address inside a private network. */
function isAllowedFetchTarget(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return false;
  if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return false;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return true;
}

/** Read a body, refusing once it passes `max` bytes. */
async function readCapped(stream: ReadableStream<Uint8Array> | null, max: number): Promise<ArrayBuffer | null> {
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out.buffer;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const caller = await resolveCaller(req);
  if (!caller) return jsonErr('Sign in again to continue', 401);

  const { searchParams } = new URL(req.url);

  /* ── POST: receive PDF bytes → upload to Supabase Storage (admin only) ── */
  if (req.method === 'POST') {
    if (caller.kind !== 'internal' && !isAdmin(caller)) return jsonErr('Unauthorized', 403);

    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_UPLOAD_BYTES) return jsonErr('PDF too large (max 50 MB)', 413);

    const filename    = searchParams.get('filename') || 'upload.pdf';
    const storagePath = `pdfs/${Date.now()}_${safeName(filename)}`;

    const body = await readCapped(req.body, MAX_UPLOAD_BYTES);
    if (!body) return jsonErr('PDF too large (max 50 MB)', 413);
    if (!isPdf(body)) return jsonErr('Not a valid PDF (bad magic bytes)', 422);

    // Upload via Supabase Storage REST API using service_role_key — bypasses RLS entirely
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
          'apikey':        SERVICE_ROLE_KEY,
          'Content-Type':  'application/pdf',
          'x-upsert':      'true',
        },
        body,
      },
    );

    if (!uploadRes.ok) {
      const detail = await uploadRes.text().catch(() => '');
      return jsonErr(`Storage upload failed (${uploadRes.status}): ${detail}`, 500);
    }

    const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

    return new Response(JSON.stringify({ storagePath, publicUrl }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'GET') return jsonErr('Method not allowed', 405);

  /* ── GET: fetch PDF from source URL, validate, return bytes ─ */
  const targetUrl = searchParams.get('url');
  if (!targetUrl) return jsonErr('Missing ?url= param');
  if (!isAllowedFetchTarget(targetUrl)) return jsonErr('Only public https:// URLs can be fetched', 400);

  const origin = new URL(targetUrl).origin;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':          'application/pdf,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         origin + '/',
        'Cache-Control':   'no-cache',
      },
      redirect: 'follow',
    });

    // A redirect could land somewhere the original URL check would refuse.
    if (upstream.url && !isAllowedFetchTarget(upstream.url)) return jsonErr('Redirected to a disallowed address', 400);
    if (!upstream.ok) return jsonErr(`Upstream HTTP ${upstream.status}`, upstream.status);

    const ct = upstream.headers.get('Content-Type') || '';
    if (ct.includes('text/html')) return jsonErr('Site returned HTML (login wall or paywall)', 403);

    const declared = Number(upstream.headers.get('content-length') ?? '0');
    if (declared > MAX_FETCH_BYTES) return jsonErr('PDF too large (max 60 MB)', 413);

    const body = await readCapped(upstream.body, MAX_FETCH_BYTES);
    if (!body) return jsonErr('PDF too large (max 60 MB)', 413);
    if (!isPdf(body)) return jsonErr('Response is not a valid PDF', 422);

    return new Response(body, {
      status:  200,
      headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Length': String(body.byteLength) },
    });
  } catch (e) {
    return jsonErr(String(e), 500);
  }
});
