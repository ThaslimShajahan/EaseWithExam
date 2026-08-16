// Supabase Edge Function — OpenAI proxy
// Keeps OPENAI_API_KEY server-side; never exposed to the browser.
//
// Deploy:
//   supabase secrets set OPENAI_API_KEY=sk-...
//   supabase functions deploy ai-proxy
//
// CORS: allowed from any origin (restrict to your domain in production)

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  // A cross-origin response hides every header not named here, so without this
  // the browser cannot read Retry-After even when we forward it below — the
  // client's rate-limit backoff would silently fall back to guessing.
  'Access-Control-Expose-Headers': 'retry-after',
};

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/** Passes OpenAI's own backoff instruction through to the browser on a 429.
 *  Guessing a delay works; being told the real one works better. */
function withRetryAfter(headers: Record<string, string>, upstream: Response) {
  const retryAfter = upstream.headers.get('retry-after');
  return retryAfter ? { ...headers, 'Retry-After': retryAfter } : headers;
}

/**
 * Writes one row to ai_call_log via the service role — bypasses RLS by
 * design (see 20260816000000_ai_call_log.sql: the table has no policies at
 * all, only this insert path and the two admin read RPCs). Fire-and-forget
 * is deliberately NOT used here — a logging call that silently races the
 * response is exactly the kind of gap this table exists to eliminate, so we
 * await it. One extra INSERT is a few ms; a missing row is a dead end the
 * next spike investigation hits blind.
 */
async function logCall(entry: {
  route: string; feature: string | null; model: string | null; caller_uid: string | null;
  status: number | null; streaming: boolean; prompt_tokens: number | null;
  completion_tokens: number | null; total_tokens: number | null; duration_ms: number;
  error: string | null;
}) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_call_log`, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'apikey':        SERVICE_ROLE_KEY,
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(entry),
    });
  } catch (e) {
    // Logging must never take the real request down with it.
    console.error('ai_call_log insert failed:', e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  const startedAt = Date.now();

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
      });
    }

    // Route: ?route=images for DALL-E, ?route=embeddings for text-embedding,
    // ?route=tts for text-to-speech (Podcast Generator); default is chat/completions
    const url  = new URL(req.url);
    const route = url.searchParams.get('route');
    const openaiEndpoint = route === 'images'
      ? 'https://api.openai.com/v1/images/generations'
      : route === 'embeddings'
      ? 'https://api.openai.com/v1/embeddings'
      : route === 'tts'
      ? 'https://api.openai.com/v1/audio/speech'
      : 'https://api.openai.com/v1/chat/completions';
    const routeTag = route === 'images' ? 'images' : route === 'embeddings' ? 'embeddings' : route === 'tts' ? 'tts' : 'chat';

    // Forward the exact OpenAI request body from the client, MINUS the two
    // logging-only fields below — OpenAI's API rejects unknown top-level
    // parameters, so these must never reach openaiEndpoint. Client-reported,
    // not verified — see this migration's header comment on why.
    const rawBody = await req.json();
    const { _feature, _caller_uid, ...body } = rawBody;
    const feature   = typeof _feature === 'string' ? _feature.slice(0, 100) : null;
    const callerUid = typeof _caller_uid === 'string' ? _caller_uid.slice(0, 100) : null;
    const model = typeof body?.model === 'string' ? body.model : null;
    const isStreaming = body?.stream === true;

    // req.signal aborts if the client disconnects (e.g. a component
    // unmounted mid-request and cancelled its fetch) — propagating it here
    // means OpenAI actually stops billing for the call, not just that the
    // client stops waiting for a response it'll never use.
    const openaiRes = await fetch(openaiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    // TTS returns raw audio bytes, not JSON — no token usage is ever reported
    // for this endpoint, so the log carries route/model/feature/status only.
    if (route === 'tts') {
      await logCall({
        route: routeTag, feature, model, caller_uid: callerUid, status: openaiRes.status,
        streaming: false, prompt_tokens: null, completion_tokens: null, total_tokens: null,
        duration_ms: Date.now() - startedAt, error: openaiRes.ok ? null : `TTS ${openaiRes.status}`,
      });
      return new Response(openaiRes.body, {
        status: openaiRes.status,
        headers: { ...CORS, 'Content-Type': openaiRes.headers.get('Content-Type') ?? 'audio/mpeg' },
      });
    }

    // Streaming chat completions: the SSE body is passed straight through
    // unbuffered, so usage is not observable here without buffering the
    // whole stream (which would defeat the point of streaming). Logged with
    // streaming:true and null tokens — the call is still visible for volume
    // and error-rate purposes, just not for token accounting. Enabling
    // `stream_options:{include_usage:true}` upstream and parsing the final
    // SSE chunk would close this gap; deferred as a follow-up, not silently
    // dropped — the streaming:true flag on every such row makes the gap
    // itself visible in admin_ai_usage_summary rather than hidden as a 0.
    if (body?.stream && openaiRes.body) {
      await logCall({
        route: routeTag, feature, model, caller_uid: callerUid, status: openaiRes.status,
        streaming: true, prompt_tokens: null, completion_tokens: null, total_tokens: null,
        duration_ms: Date.now() - startedAt, error: openaiRes.ok ? null : `stream ${openaiRes.status}`,
      });
      return new Response(openaiRes.body, {
        status: openaiRes.status,
        headers: { ...CORS, 'Content-Type': 'text/event-stream' },
      });
    }

    const data = await openaiRes.json();

    // Images and embeddings responses carry no `usage.completion_tokens`
    // (images: none at all; embeddings: prompt_tokens only) — read what
    // exists and leave the rest null rather than coercing 0, which would
    // read as "confirmed zero cost" instead of "not applicable".
    const usage = data?.usage ?? null;
    await logCall({
      route: routeTag, feature, model: model ?? data?.model ?? null, caller_uid: callerUid,
      status: openaiRes.status, streaming: false,
      prompt_tokens: usage?.prompt_tokens ?? null,
      completion_tokens: usage?.completion_tokens ?? null,
      total_tokens: usage?.total_tokens ?? null,
      duration_ms: Date.now() - startedAt,
      error: openaiRes.ok ? null : (data?.error?.message ?? `HTTP ${openaiRes.status}`),
    });

    return new Response(JSON.stringify(data), {
      status: openaiRes.status,
      headers: withRetryAfter({ ...CORS, 'Content-Type': 'application/json' }, openaiRes),
    });
  } catch (err) {
    await logCall({
      route: 'chat', feature: null, model: null, caller_uid: null, status: null, streaming: false,
      prompt_tokens: null, completion_tokens: null, total_tokens: null,
      duration_ms: Date.now() - startedAt, error: String(err).slice(0, 500),
    });
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
