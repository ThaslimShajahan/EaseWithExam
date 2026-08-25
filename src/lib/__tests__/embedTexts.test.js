/**
 * Batched embeddings (embedTexts) — collapses N per-chunk embedText() calls
 * into one call carrying an array `input`, since the ai-proxy edge function
 * forwards the request body to OpenAI's /v1/embeddings verbatim (it accepts
 * an array there) and OpenAI returns each result's position via `index`.
 *
 * These pin the two things that would silently corrupt a chapter's
 * embeddings if they regressed: (1) it really is one call for the whole
 * batch, not one per item, and (2) results land back on the right row even
 * if the API ever returns `data[]` out of input order — reordering by
 * `index` rather than trusting array position.
 *
 * Runs against the edge path (USE_EDGE), same as aiProxyRetry.test.js.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-key');
vi.stubEnv('VITE_USE_EDGE_FUNCTIONS', 'true');

const { embedTexts, embedText } = await import('../aiProxy');

const vec = (seed) => Array.from({ length: 4 }, (_, i) => seed + i * 0.001);

const jsonOk = (data) => ({
  ok: true, status: 200,
  json: async () => ({ data, model: 'text-embedding-3-small', usage: { prompt_tokens: 10, total_tokens: 10 } }),
  headers: new Headers(),
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('embedTexts', () => {
  it('sends every text in ONE request, as an array input — not one call per text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk([
      { index: 0, embedding: vec(0) },
      { index: 1, embedding: vec(1) },
      { index: 2, embedding: vec(2) },
    ]));

    const texts = ['chunk A', 'chunk B', 'chunk C'];
    await embedTexts(texts, { feature: 'kb-chunk-embed' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('route=embeddings');
    const body = JSON.parse(opts.body);
    expect(body.input).toEqual(texts);       // array input, not a single string
    expect(body.model).toBe('text-embedding-3-small');
  });

  it('returns embeddings in the SAME ORDER as the input texts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk([
      { index: 0, embedding: vec(10) },
      { index: 1, embedding: vec(20) },
      { index: 2, embedding: vec(30) },
    ]));
    const out = await embedTexts(['a', 'b', 'c']);
    expect(out).toEqual([vec(10), vec(20), vec(30)]);
  });

  // The API is documented to return data[] in input order, but this must not
  // be TRUSTED — reorder by the response's own `index` field so a future
  // upstream change (or a mock like this one) can't silently swap two
  // chunks' embeddings.
  it('reorders by the response index even when data[] arrives scrambled', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk([
      { index: 2, embedding: vec(30) },
      { index: 0, embedding: vec(10) },
      { index: 1, embedding: vec(20) },
    ]));
    const out = await embedTexts(['a', 'b', 'c']);
    expect(out).toEqual([vec(10), vec(20), vec(30)]);
  });

  it('produces the SAME vectors as calling embedText once per item (same mocked API, just fewer round-trips)', async () => {
    // Batched: one call, array response.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonOk([
      { index: 0, embedding: vec(1) },
      { index: 1, embedding: vec(2) },
    ]));
    const batched = await embedTexts(['x', 'y']);

    // Per-item: two calls, one embedding each — same underlying vectors.
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonOk([{ index: 0, embedding: vec(1) }]))
      .mockResolvedValueOnce(jsonOk([{ index: 0, embedding: vec(2) }]));
    const perItem = [await embedText('x'), await embedText('y')];

    expect(batched).toEqual(perItem);
  });

  it('fills null for a failed HTTP response, at the correct length', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500, headers: new Headers() });
    const out = await embedTexts(['a', 'b', 'c']);
    expect(out).toEqual([null, null, null]);
  });

  it('fills null for a thrown/network error, at the correct length', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const out = await embedTexts(['a', 'b']);
    expect(out).toEqual([null, null]);
  });

  it('a missing index in the response leaves that slot null rather than misaligning the rest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonOk([
      { index: 0, embedding: vec(1) },
      // index 1 missing entirely (e.g. one item filtered content — real API doesn't do this, but defend anyway)
      { index: 2, embedding: vec(3) },
    ]));
    const out = await embedTexts(['a', 'b', 'c']);
    expect(out).toEqual([vec(1), null, vec(3)]);
  });

  it('returns [] for an empty input without making a network call', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const out = await embedTexts([]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
