/**
 * Supabase Edge Function — PDF Proxy + Storage Uploader
 *
 * GET  ?url=https://...   → fetch PDF server-side, validate, return bytes
 * POST ?filename=foo.pdf  → receive PDF bytes in body, upload to Supabase Storage
 *                           using service_role_key (bypasses RLS), return { storagePath, publicUrl }
 *
 * No external imports — uses direct REST API calls only.
 * Deploy: supabase functions deploy pdf-proxy --no-verify-jwt
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET           = 'question-papers';

function isPdf(buf: ArrayBuffer): boolean {
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  const { searchParams } = new URL(req.url);

  /* ── POST: receive PDF bytes → upload to Supabase Storage ── */
  if (req.method === 'POST') {
    const filename    = searchParams.get('filename') || 'upload.pdf';
    const storagePath = `pdfs/${Date.now()}_${safeName(filename)}`;

    let body: ArrayBuffer;
    try { body = await req.arrayBuffer(); } catch (e) {
      return jsonErr(`Could not read request body: ${e}`, 400);
    }

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

  /* ── GET: fetch PDF from source URL, validate, return bytes ─ */
  const targetUrl = searchParams.get('url');
  if (!targetUrl) return jsonErr('Missing ?url= param');

  let origin = '';
  try { origin = new URL(targetUrl).origin; } catch {}

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

    if (!upstream.ok) return jsonErr(`Upstream HTTP ${upstream.status}`, upstream.status);

    const ct = upstream.headers.get('Content-Type') || '';
    if (ct.includes('text/html')) return jsonErr('Site returned HTML (login wall or paywall)', 403);

    const body = await upstream.arrayBuffer();
    if (!isPdf(body)) return jsonErr('Response is not a valid PDF', 422);

    return new Response(body, {
      status:  200,
      headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Length': String(body.byteLength) },
    });
  } catch (e) {
    return jsonErr(String(e), 500);
  }
});
