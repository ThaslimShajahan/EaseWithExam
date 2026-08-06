/**
 * AI Proxy — client wrapper for OpenAI chat completions.
 *
 * In development (VITE_USE_EDGE_FUNCTIONS not set): calls OpenAI directly
 * with dangerouslyAllowBrowser (for local dev only — key stays out of prod build).
 *
 * In production (VITE_USE_EDGE_FUNCTIONS=true): calls the Supabase Edge
 * Function which holds the key server-side. The browser only ever needs the
 * Supabase anon key, which is already public.
 *
 * To switch to production mode:
 *   1. supabase secrets set OPENAI_API_KEY=sk-...
 *   2. supabase functions deploy ai-proxy
 *   3. Add VITE_USE_EDGE_FUNCTIONS=true to .env
 */

// Production builds ALWAYS use the edge function path, regardless of the .env flag —
// this is a structural guarantee (import.meta.env.PROD is a Vite-native constant that
// reliably dead-code-eliminates the branch below in prod builds), not a discretionary
// setting that could be left unset by mistake. VITE_-prefixed vars are inlined into the
// client bundle unconditionally by Vite, so relying on a plain flag to "hide" a secret
// doesn't work — the only real guarantee is removing the code path that references it.
const USE_EDGE = import.meta.env.PROD || import.meta.env.VITE_USE_EDGE_FUNCTIONS === 'true';
const PROXY_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-proxy`;
const ANON_KEY  = import.meta.env.VITE_SUPABASE_ANON_KEY;

let _openai = null;
async function getOpenAI() {
  if (import.meta.env.PROD) {
    throw new Error('Direct OpenAI calls are dev-only — this should be unreachable in production.');
  }
  if (_openai) return _openai;
  const { default: OpenAI } = await import('openai');
  _openai = new OpenAI({
    apiKey: import.meta.env.VITE_OPENAI_API_KEY,
    dangerouslyAllowBrowser: true,
  });
  return _openai;
}

/**
 * Drop-in replacement for openai.chat.completions.create().
 * Returns the same shape as the OpenAI SDK response.
 *
 * @param {object} params
 * @param {{ signal?: AbortSignal }} [opts] - pass an AbortController's signal
 *   so a caller that unmounts mid-request (navigated away) can cancel the
 *   in-flight call instead of letting it complete unattended in the
 *   background (which would still burn quota and write its result).
 */
export async function chatComplete(params, { signal } = {}) {
  if (USE_EDGE) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${ANON_KEY}`,
      },
      body: JSON.stringify(params),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `AI proxy error ${res.status}`);
    }
    return res.json();
  }

  // Dev fallback — direct browser call (key never leaves local machine)
  const openai = await getOpenAI();
  return openai.chat.completions.create(params, { signal });
}

/**
 * Streaming drop-in replacement for openai.chat.completions.create({ ...params, stream: true }).
 * Returns an async iterable yielding the same chunk shape as the OpenAI SDK
 * ({ choices: [{ delta: { content } }] }) regardless of edge vs. dev-fallback path.
 */
export async function chatCompleteStream(params) {
  const body = { ...params, stream: true };

  if (!USE_EDGE) {
    const openai = await getOpenAI();
    return openai.chat.completions.create(body);
  }

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `AI proxy error ${res.status}`);
  }

  return parseSSEStream(res.body);
}

// Parses an OpenAI-format SSE response body into an async iterable of parsed JSON chunks.
async function* parseSSEStream(body) {
  const reader  = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload); } catch { /* skip malformed chunk */ }
    }
  }
}

/**
 * Generate an image via DALL-E 3.
 * When VITE_USE_EDGE_FUNCTIONS=true, routes through the Supabase Edge Function
 * (?route=images) so the API key never leaves the server.
 * Returns the image URL string or null on failure.
 *
 * @param {string} prompt
 * @param {{ size?: string, quality?: string, n?: number }} opts
 * @returns {Promise<string|null>}
 */
export async function generateImage(prompt, { size = '1024x1024', quality = 'standard', n = 1, responseFormat } = {}) {
  try {
    const body = { model: 'dall-e-3', prompt, size, quality, n, ...(responseFormat && { response_format: responseFormat }) };
    const pick = (data) => responseFormat === 'b64_json' ? (data?.[0]?.b64_json ?? null) : (data?.[0]?.url ?? null);

    if (USE_EDGE) {
      const res = await fetch(`${PROXY_URL}?route=images`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return pick(json?.data);
    }
    // Dev fallback
    const openai = await getOpenAI();
    const res = await openai.images.generate(body);
    return pick(res.data);
  } catch { return null; }
}

/**
 * Generate speech audio via OpenAI TTS (Podcast Generator).
 * Returns a Blob (audio/mpeg) the caller can turn into an object URL, or
 * throws on failure (unlike the other helpers here, silence would leave a
 * student staring at a broken player with no idea why).
 *
 * @param {string} text
 * @param {{ voice?: string }} opts
 * @returns {Promise<Blob>}
 */
export async function generateSpeech(text, { voice = 'alloy' } = {}) {
  const body = { model: 'tts-1', voice, input: text };

  if (USE_EDGE) {
    const res = await fetch(`${PROXY_URL}?route=tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `TTS proxy error ${res.status}`);
    }
    return res.blob();
  }

  // Dev fallback — direct browser call
  const openai = await getOpenAI();
  const res = await openai.audio.speech.create(body);
  return res.blob ? res.blob() : new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' });
}

/**
 * Generate a 1536-dim embedding via text-embedding-3-small.
 * Returns a float array or null on failure.
 */
export async function embedText(text) {
  try {
    if (USE_EDGE) {
      const res = await fetch(`${PROXY_URL}?route=embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
      });
      if (!res.ok) return null;
      const json = await res.json();
      return json?.data?.[0]?.embedding ?? null;
    }
    const openai = await getOpenAI();
    const res = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
    return res.data?.[0]?.embedding ?? null;
  } catch { return null; }
}
