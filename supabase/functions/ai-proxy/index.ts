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
};

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

    // Route: ?route=images for DALL-E, ?route=embeddings for text-embedding; default is chat/completions
    const url  = new URL(req.url);
    const route = url.searchParams.get('route');
    const openaiEndpoint = route === 'images'
      ? 'https://api.openai.com/v1/images/generations'
      : route === 'embeddings'
      ? 'https://api.openai.com/v1/embeddings'
      : 'https://api.openai.com/v1/chat/completions';

    // Forward the exact OpenAI request body from the client
    const body = await req.json();

    const openaiRes = await fetch(openaiEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

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
      headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
    });
  }
});
