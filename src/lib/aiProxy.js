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

/* ── Timeout + retry ──────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 * A PYQ upload sat on "Reading page 4 with vision… (4/16)" for 15+ minutes,
 * then on a retry of the same file stopped at page 6 instead. Nothing in the
 * chain had a timeout: `fetch` was called with `signal: undefined`, the intake
 * screen never built an AbortController, and the edge function sets no deadline
 * of its own. A request that never settles therefore stalled the whole document
 * forever, with the progress line frozen and no error anywhere.
 *
 * The mirror-image bug was just as bad: every non-abort failure was swallowed
 * by visionExtractPage into an empty result, so a 429 silently produced an
 * unrepaired page and the upload still reported success. One class of failure
 * hung forever, the other left no trace at all.
 *
 * So: bound every call, retry the ones worth retrying, and make the rest fail
 * loudly enough that the caller can report them.
 */

/** Per-attempt ceiling. A detail:"high" vision call on a dense A4 scan runs
 *  20-40s; 90s is roughly 2-3x the slowest observed real response, which is
 *  wide enough not to cut off legitimate work and short enough that a wedged
 *  request costs one page of latency instead of an afternoon. */
export const AI_REQUEST_TIMEOUT_MS = 90_000;

/** Initial attempt + 2 retries. */
export const AI_MAX_ATTEMPTS = 3;

/** Ceiling on how long we honour a server's Retry-After. OpenAI's TPM limits
 *  usually ask for a few seconds, but nothing stops it asking for 300 — and
 *  silently parking a page for five minutes is the hang this file exists to
 *  prevent. Past this we stop retrying rather than wait it out. */
export const RETRY_AFTER_CAP_MS = 20_000;

/** Marks an abort that WE triggered on a deadline, as opposed to one the
 *  caller triggered by cancelling. The distinction matters: a caller abort
 *  must stop the whole document, a timeout must fail one page and continue. */
const TIMEOUT_REASON = Symbol('ai-request-timeout');

/** Error carrying the HTTP status, so callers can distinguish "rate limited"
 *  from "bad request" instead of pattern-matching a message string. */
export class AiRequestError extends Error {
  constructor(message, { status = null, retryAfterMs = null, attempts = 1, timedOut = false } = {}) {
    super(message);
    this.name = 'AiRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.attempts = attempts;
    this.timedOut = timedOut;
  }
}

/**
 * Parses an HTTP Retry-After value into milliseconds.
 *
 * Both forms are real and both appear in the wild: delta-seconds ("20") and an
 * HTTP-date ("Wed, 21 Oct 2015 07:28:00 GMT"). Returns null for anything else,
 * so a malformed header falls back to exponential backoff rather than being
 * read as 0 and hammering the endpoint.
 */
export function parseRetryAfter(raw, now = Date.now()) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const ms = Number(s) * 1000;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }
  const at = Date.parse(s);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/**
 * Retryable = the request might succeed if repeated.
 *
 * 429 (rate limited) and 5xx (server-side) qualify, as does 408. A 4xx other
 * than those is a malformed request — retrying it just spends the quota three
 * times to get the same rejection.
 */
export function isRetryableStatus(status) {
  if (status == null) return true;   // network-level failure, no response at all
  if (status === 429 || status === 408) return true;
  return status >= 500;
}

/** Exponential backoff with jitter: ~1s, ~2s. Jitter matters when a batch of
 *  pages hits the same TPM ceiling — without it they all wake together and
 *  re-trigger it.
 *
 *  Exported so callers that retry at a HIGHER layer than transport — see
 *  visionExtractPage, which retries a 200 response carrying an unparseable
 *  body — pace themselves identically instead of inventing a second policy. */
export function backoffMs(attempt) {
  const base = 1000 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * 250);
}

/** Abort-aware sleep. Exported alongside backoffMs so a higher-layer retry
 *  still cancels instantly when the operator hits Cancel. */
export const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(done, ms);
  function done() { cleanup(); resolve(); }
  function onAbort() { cleanup(); reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); }
  function cleanup() {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal) {
    if (signal.aborted) { onAbort(); return; }
    signal.addEventListener('abort', onAbort, { once: true });
  }
});

/**
 * Combines the caller's signal with a deadline into one signal.
 *
 * Deliberately hand-rolled rather than AbortSignal.any(): that landed in
 * Chrome 116 / Safari 17.4, and an admin on an older browser would get a
 * TypeError here instead of the timeout this whole change is adding.
 */
function withDeadline(callerSignal, timeoutMs) {
  const ctrl = new AbortController();
  const onCallerAbort = () => ctrl.abort(callerSignal.reason);
  const timer = setTimeout(() => ctrl.abort(TIMEOUT_REASON), timeoutMs);

  if (callerSignal) {
    if (callerSignal.aborted) ctrl.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  return {
    signal: ctrl.signal,
    timedOut: () => ctrl.signal.reason === TIMEOUT_REASON,
    release: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

/**
 * Runs `attempt(signal)` under a deadline, retrying the failures worth
 * retrying.
 *
 * A caller abort propagates immediately as an AbortError and is never retried
 * — cancelling means stop, not "try harder".
 */
async function runWithRetry(attempt, { signal, timeoutMs, maxAttempts, label }) {
  let last = null;

  for (let n = 1; n <= maxAttempts; n++) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

    const deadline = withDeadline(signal, timeoutMs);
    try {
      return await attempt(deadline.signal);
    } catch (e) {
      // Caller cancelled — stop everything, do not retry.
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');

      if (deadline.timedOut()) {
        last = new AiRequestError(
          `${label} timed out after ${Math.round(timeoutMs / 1000)}s`,
          { status: null, attempts: n, timedOut: true },
        );
      } else if (e instanceof AiRequestError) {
        last = e;
        last.attempts = n;
      } else {
        // Network-level failure (DNS, connection reset) — no response, so no status.
        last = new AiRequestError(e?.message || `${label} failed`, { status: null, attempts: n });
      }

      if (n === maxAttempts || !isRetryableStatus(last.status)) break;

      const wait = last.retryAfterMs ?? backoffMs(n);
      // A server asking for longer than we are willing to wait is a hard stop,
      // not something to quietly ignore and retry early against.
      if (wait > RETRY_AFTER_CAP_MS) {
        last = new AiRequestError(
          `${label} rate limited — server asked for ${Math.round(wait / 1000)}s, over the ${RETRY_AFTER_CAP_MS / 1000}s cap`,
          { status: last.status, retryAfterMs: wait, attempts: n },
        );
        break;
      }
      await sleep(wait, signal);
    } finally {
      deadline.release();
    }
  }

  throw last;
}

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
 * Every call is bounded by AI_REQUEST_TIMEOUT_MS and retried up to
 * AI_MAX_ATTEMPTS times on 429/5xx/network failures — see the block at the top
 * of this file for why. Failures arrive as AiRequestError carrying `.status`,
 * so a caller can tell a rate limit from a malformed request.
 *
 * @param {object} params
 * @param {{ signal?: AbortSignal, timeoutMs?: number, maxAttempts?: number, feature?: string, callerUid?: string }} [opts]
 *   `signal` cancels the call — a caller that unmounts mid-request (navigated
 *   away, or hit Cancel) stops it instead of letting it complete unattended in
 *   the background, which would still burn quota and write its result. A caller
 *   abort is never retried; only our own deadline is.
 *   `feature`/`callerUid` are logging-only tags for ai_call_log (see
 *   20260816000000_ai_call_log.sql) — sent as `_feature`/`_caller_uid`
 *   alongside `params`, stripped by ai-proxy before the request reaches
 *   OpenAI. Every real call site should pass `feature`; a call with none
 *   shows up as feature:null in admin_ai_usage_summary, which is itself a
 *   signal that a caller still needs tagging.
 */
export async function chatComplete(params, {
  signal,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
  maxAttempts = AI_MAX_ATTEMPTS,
  feature = null,
  callerUid = null,
} = {}) {
  const attempt = USE_EDGE
    ? async (sig) => {
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${ANON_KEY}`,
        },
        body: JSON.stringify({ ...params, _feature: feature, _caller_uid: callerUid }),
        signal: sig,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new AiRequestError(err?.error?.message || `AI proxy error ${res.status}`, {
          status: res.status,
          // Only present once ai-proxy forwards it AND exposes it via
          // Access-Control-Expose-Headers — a cross-origin response hides
          // every header not on that list, so without both halves this is
          // null and we fall back to exponential backoff.
          retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
        });
      }
      return res.json();
    }
    : async (sig) => {
      // Dev fallback — direct browser call (key never leaves local machine)
      const openai = await getOpenAI();
      try {
        return await openai.chat.completions.create(params, { signal: sig });
      } catch (e) {
        // The SDK surfaces the status on the error; normalise it so the retry
        // policy is identical in dev and prod rather than only tested in one.
        throw new AiRequestError(e?.message || 'OpenAI request failed', {
          status: e?.status ?? null,
          retryAfterMs: parseRetryAfter(e?.headers?.get?.('retry-after')),
        });
      }
    };

  return runWithRetry(attempt, { signal, timeoutMs, maxAttempts, label: 'AI request' });
}

/* ── Recent-call cache (accidental-duplicate guard) ──────────────────────
 *
 * Exists for the ACCIDENTAL retry only: a content_jobs worker re-running a
 * job whose write half failed after its AI half already succeeded, an admin
 * re-confirming the same row after a transient error in the multi-file
 * review screen, or a stray double-click on Process before the button
 * disabled itself. All three re-send the EXACT SAME request body this
 * session already got a successful answer for — paying OpenAI twice for an
 * identical response teaches nothing new.
 *
 * Deliberately NOT wired into plain chatComplete(), and deliberately NOT a
 * general response cache: most callers pass temperature > 0 specifically so
 * a repeat call returns something DIFFERENT (a "Regenerate" practice paper,
 * a fresh daily challenge, a podcast script) — caching those would silently
 * turn "give me a new one" into "show me the same one again", a correctness
 * bug wearing an optimisation's clothes. cachedChatComplete() is a separate,
 * opt-in export that refuses to cache anything but temperature: 0 calls, and
 * only the deterministic extraction call sites that actually see accidental
 * duplicates (vision page reads, notes/PYQ structuring batches) use it.
 *
 * In-memory and per-tab, cleared on reload — a session-scoped safety net,
 * never a durable store that could serve a stale answer across sessions or
 * for a genuinely re-edited source file.
 */
const RECENT_CALL_TTL_MS = 15 * 60 * 1000;
const RECENT_CALL_MAX_ENTRIES = 300;
const recentCalls = new Map(); // sha256(params) -> { value, at }

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pruneRecentCalls() {
  const now = Date.now();
  for (const [k, v] of recentCalls) if (now - v.at > RECENT_CALL_TTL_MS) recentCalls.delete(k);
  while (recentCalls.size > RECENT_CALL_MAX_ENTRIES) recentCalls.delete(recentCalls.keys().next().value);
}

/** Test-only: wipes the cache so tests (and a fresh upload of genuinely
 *  different content under a coincidentally-reused mock) don't leak state
 *  across runs. */
export function _clearRecentCallCache() { recentCalls.clear(); }

/**
 * Drop-in replacement for chatComplete() that skips the network entirely
 * when this EXACT request body (model, messages, and every param — a
 * byte-for-byte duplicate) already produced a successful response within the
 * last 15 minutes. A cache hit never reaches ai-proxy, so it never writes an
 * ai_call_log row — correct, since no real API call was made.
 *
 * Only ever caches temperature: 0, non-streaming calls; anything else is
 * passed straight through to chatComplete() uncached, so a caller cannot opt
 * into unsafe caching by accident.
 */
export async function cachedChatComplete(params, opts = {}) {
  if (params?.temperature !== 0 || params?.stream) return chatComplete(params, opts);

  pruneRecentCalls();
  const key = await sha256Hex(JSON.stringify(params));
  const hit = recentCalls.get(key);
  if (hit) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new DOMException('Aborted', 'AbortError');
    return hit.value;
  }

  const resp = await chatComplete(params, opts);
  recentCalls.set(key, { value: resp, at: Date.now() });
  return resp;
}

/**
 * Streaming drop-in replacement for openai.chat.completions.create({ ...params, stream: true }).
 * Returns an async iterable yielding the same chunk shape as the OpenAI SDK
 * ({ choices: [{ delta: { content } }] }) regardless of edge vs. dev-fallback path.
 */
export async function chatCompleteStream(params, { feature = null, callerUid = null } = {}) {
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
    body: JSON.stringify({ ...body, _feature: feature, _caller_uid: callerUid }),
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
export async function generateImage(prompt, { size = '1024x1024', quality = 'standard', n = 1, responseFormat, feature = null, callerUid = null } = {}) {
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
        body: JSON.stringify({ ...body, _feature: feature, _caller_uid: callerUid }),
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
export async function generateSpeech(text, { voice = 'alloy', feature = null, callerUid = null } = {}) {
  const body = { model: 'tts-1', voice, input: text };

  if (USE_EDGE) {
    const res = await fetch(`${PROXY_URL}?route=tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
      body: JSON.stringify({ ...body, _feature: feature, _caller_uid: callerUid }),
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
export async function embedText(text, { feature = null, callerUid = null } = {}) {
  try {
    if (USE_EDGE) {
      const res = await fetch(`${PROXY_URL}?route=embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: text, _feature: feature, _caller_uid: callerUid }),
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
