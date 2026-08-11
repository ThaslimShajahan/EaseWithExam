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

/** Passes OpenAI's own backoff instruction through to the browser on a 429.
 *  Guessing a delay works; being told the real one works better. */
function withRetryAfter(headers: Record<string, string>, upstream: Response) {
  const retryAfter = upstream.headers.get('retry-after');
  return retryAfter ? { ...headers, 'Retry-After': retryAfter } : headers;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

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

    // Forward the exact OpenAI request body from the client
    const body = await req.json();

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

    // TTS returns raw audio bytes, not JSON — pass the binary body straight through.
    if (route === 'tts') {
      return new Response(openaiRes.body, {
        status: openaiRes.status,
        headers: { ...CORS, 'Content-Type': openaiRes.headers.get('Content-Type') ?? 'audio/mpeg' },
      });
    }

    // Streaming chat completions: pass the SSE body straight through unbuffered.
    if (body?.stream && openaiRes.body) {
      return new Response(openaiRes.body, {
        status: openaiRes.status,
        headers: { ...CORS, 'Content-Type': 'text/event-stream' },
      });
    }

    const data = await openaiRes.json();

    return new Response(JSON.stringify(data), {
      status: openaiRes.status,
      headers: withRetryAfter({ ...CORS, 'Content-Type': 'application/json' }, openaiRes),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
