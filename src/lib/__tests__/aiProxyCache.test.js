/**
 * cachedChatComplete — the accidental-duplicate guard (item 6 of the
 * 2026-08-18 efficiency pass).
 *
 * Scope under test: identical temperature:0 request bodies within the same
 * session skip the network entirely; anything with real per-call randomness
 * (temperature !== 0) is never cached, since a "Regenerate" caller wants a
 * genuinely new answer, not the same one replayed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
vi.stubEnv('VITE_USE_EDGE_FUNCTIONS', 'true');

const { cachedChatComplete, _clearRecentCallCache } = await import('../aiProxy');

const jsonOk = (body) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });

beforeEach(() => {
  vi.restoreAllMocks();
  _clearRecentCallCache();
});

describe('cachedChatComplete', () => {
  it('skips the network on an identical temperature:0 request within the session', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk({ choices: ['first'] }));
    const params = { model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: 'page 1 text' }] };

    const a = await cachedChatComplete(params);
    const b = await cachedChatComplete({ ...params }); // a fresh object, same content

    expect(a).toEqual({ choices: ['first'] });
    expect(b).toEqual({ choices: ['first'] }); // cached, not re-fetched
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still calls the network for genuinely different content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonOk({ choices: ['page 1'] }))
      .mockResolvedValueOnce(jsonOk({ choices: ['page 2'] }));

    const r1 = await cachedChatComplete({ model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: 'page 1 text' }] });
    const r2 = await cachedChatComplete({ model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: 'page 2 text' }] });

    expect(r1).toEqual({ choices: ['page 1'] });
    expect(r2).toEqual({ choices: ['page 2'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches a call with temperature !== 0 — a "regenerate" must get a fresh answer', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonOk({ choices: ['draw A'] }))
      .mockResolvedValueOnce(jsonOk({ choices: ['draw B'] }));
    const params = { model: 'gpt-4o', temperature: 0.6, messages: [{ role: 'user', content: 'give me a daily challenge' }] };

    const a = await cachedChatComplete(params);
    const b = await cachedChatComplete({ ...params });

    expect(a).toEqual({ choices: ['draw A'] });
    expect(b).toEqual({ choices: ['draw B'] }); // NOT the cached first draw
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never caches a streaming request', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk({ choices: ['x'] }));
    const params = { model: 'gpt-4o', temperature: 0, stream: true, messages: [{ role: 'user', content: 'x' }] };

    await cachedChatComplete(params);
    await cachedChatComplete({ ...params });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('a failed call is never cached — a retry after a real failure must actually retry', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: { message: 'bad request' } }), headers: new Headers() })
      .mockResolvedValueOnce(jsonOk({ choices: ['recovered'] }));
    const params = { model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: 'x' }] };

    await expect(cachedChatComplete(params)).rejects.toThrow('bad request');
    const r = await cachedChatComplete({ ...params });

    expect(r).toEqual({ choices: ['recovered'] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('_clearRecentCallCache resets state between runs', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk({ choices: ['x'] }));
    const params = { model: 'gpt-4o', temperature: 0, messages: [{ role: 'user', content: 'x' }] };

    await cachedChatComplete(params);
    _clearRecentCallCache();
    await cachedChatComplete({ ...params });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
