/**
 * Timeout + retry policy for AI calls.
 *
 * These exist because a PYQ upload hung on one page for 15+ minutes with no
 * timeout anywhere in the chain, and — the mirror-image bug — a rate-limited
 * page was silently swallowed into "this page was empty". Both are behaviours
 * you cannot check by reading the code once; they need a clock and a fake
 * server, so they are pinned here.
 *
 * Everything runs against the edge path (USE_EDGE), which is what production
 * uses, with fetch stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
vi.stubEnv('VITE_USE_EDGE_FUNCTIONS', 'true');

const {
  chatComplete, parseRetryAfter, isRetryableStatus,
  AiRequestError, AI_REQUEST_TIMEOUT_MS, RETRY_AFTER_CAP_MS,
} = await import('../aiProxy');

const jsonOk = (body = { choices: [] }) => ({
  ok: true,
  status: 200,
  json: async () => body,
  headers: new Headers(),
});

const jsonErr = (status, { retryAfter = null, message = 'boom' } = {}) => ({
  ok: false,
  status,
  json: async () => ({ error: { message } }),
  headers: new Headers(retryAfter ? { 'retry-after': retryAfter } : {}),
});

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.useRealTimers(); });

describe('parseRetryAfter', () => {
  it('reads delta-seconds', () => {
    expect(parseRetryAfter('20')).toBe(20_000);
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('reads an HTTP-date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
  });

  it('never returns a negative wait for a date already in the past', () => {
    const now = Date.parse('2026-01-01T00:01:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:00 GMT', now)).toBe(0);
  });

  // A malformed header must fall back to exponential backoff, NOT to 0 —
  // reading garbage as "retry immediately" would hammer an endpoint that just
  // told us to slow down.
  it.each([null, undefined, '', '   ', 'soon', 'NaN'])('returns null for %p', (raw) => {
    expect(parseRetryAfter(raw)).toBeNull();
  });
});

describe('isRetryableStatus', () => {
  it.each([429, 408, 500, 502, 503, 504])('retries %i', (s) => {
    expect(isRetryableStatus(s)).toBe(true);
  });

  // Retrying a malformed request just spends the quota three times over to
  // collect the same rejection.
  it.each([400, 401, 403, 404, 422])('does not retry %i', (s) => {
    expect(isRetryableStatus(s)).toBe(false);
  });

  it('retries a network-level failure that produced no response at all', () => {
    expect(isRetryableStatus(null)).toBe(true);
  });
});

describe('chatComplete retry policy', () => {
  it('returns the first successful response without retrying', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk({ choices: ['x'] }));
    const r = await chatComplete({ model: 'gpt-4o' });
    expect(r).toEqual({ choices: ['x'] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and succeeds on the second attempt', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonErr(429, { retryAfter: '0' }))
      .mockResolvedValueOnce(jsonOk({ choices: ['recovered'] }));

    const r = await chatComplete({ model: 'gpt-4o' });
    expect(r).toEqual({ choices: ['recovered'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts and reports the status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonErr(503, { retryAfter: '0' }));

    await expect(chatComplete({ model: 'gpt-4o' })).rejects.toMatchObject({
      name: 'AiRequestError',
      status: 503,
      attempts: 3,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // The whole point of distinguishing statuses: a 400 is our bug, not the
  // server's load, and repeating it is pure waste.
  it('does not retry a 400', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonErr(400, { message: 'bad request' }));
    await expect(chatComplete({ model: 'gpt-4o' })).rejects.toThrow('bad request');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops rather than waiting out a Retry-After beyond the cap', async () => {
    const overCap = String(RETRY_AFTER_CAP_MS / 1000 + 60);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonErr(429, { retryAfter: overCap }));

    await expect(chatComplete({ model: 'gpt-4o' })).rejects.toThrow(/over the .*s cap/);
    // One attempt only — parking a page for 80s is the hang this replaces.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces a network failure as a retryable AiRequestError', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(chatComplete({ model: 'gpt-4o' })).rejects.toBeInstanceOf(AiRequestError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('chatComplete timeout', () => {
  /* A fetch that only ever settles if something aborts it. `signal?.` is
   * deliberately optional: against the pre-fix code (which passed
   * `signal: undefined`) this promise never settles at all, so the test fails
   * by TIMING OUT — reproducing the exact 15-minute hang rather than dying on
   * an incidental TypeError from the mock. */
  const neverSettles = () => vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) =>
    new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        const e = new Error('The operation was aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }));

  // THE ROOT CAUSE, pinned directly: fetch was called with signal:undefined, so
  // nothing could ever interrupt it. Everything else in this block depends on
  // this being true, and this is the assertion that names it.
  it('always hands fetch an AbortSignal, even when the caller supplies none', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk());
    await chatComplete({ model: 'gpt-4o' });
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    expect(opts.signal.aborted).toBe(false);
  });

  // THE ORIGINAL BUG: a request that never settled stalled the document
  // forever. Hand it a fetch that never resolves; the call must still reject.
  it('rejects a request that never settles, instead of hanging', async () => {
    neverSettles();
    await expect(
      chatComplete({ model: 'gpt-4o' }, { timeoutMs: 20, maxAttempts: 1 }),
    ).rejects.toMatchObject({ name: 'AiRequestError', timedOut: true });
  });

  it('retries after a timeout rather than failing the page immediately', async () => {
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, opts) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }
      return Promise.resolve(jsonOk({ choices: ['second try'] }));
    });

    const r = await chatComplete({ model: 'gpt-4o' }, { timeoutMs: 20 });
    expect(r).toEqual({ choices: ['second try'] });
    expect(calls).toBe(2);
  });

  // A caller cancel and a deadline both abort the fetch, but they mean opposite
  // things: cancel stops the document, a timeout fails one page. Collapsing
  // them would make the Cancel button retry three times before obeying.
  it('propagates a caller abort as AbortError and does not retry it', async () => {
    const ctrl = new AbortController();
    const fetchMock = neverSettles();

    const p = chatComplete({ model: 'gpt-4o' }, { signal: ctrl.signal });
    ctrl.abort(new DOMException('Cancelled by operator', 'AbortError'));

    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses to start when the caller signal is already aborted', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk());
    const ctrl = new AbortController();
    ctrl.abort(new DOMException('Cancelled', 'AbortError'));

    await expect(chatComplete({ model: 'gpt-4o' }, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('defaults to a 90s ceiling', () => {
    expect(AI_REQUEST_TIMEOUT_MS).toBe(90_000);
  });
});
