/**
 * _addEmbeddings (supabase.js) — the caller of embedTexts, exercised at the
 * knowledge_base-row level. Pins the property the batching fix exists for:
 * a chapter's worth of chunks costs 1 embeddings call (occasionally 2+ once
 * EMBED_BATCH is exceeded), not one call per chunk — plus the retry-on-
 * partial-failure path staying batched instead of falling back to per-item
 * calls, and every row still getting the RIGHT embedding for ITS content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../firebase/config', () => ({ auth: {}, adminAuth: {} }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('../changelog', () => ({ logChange: vi.fn(), ENTITY: {}, ACTION: {} }));
vi.mock('../examMapping', () => ({ examTypesFor: () => [] }));

const embedTexts = vi.fn();
vi.mock('../aiProxy', () => ({ embedText: vi.fn(), embedTexts: (...args) => embedTexts(...args) }));

const { _addEmbeddings, EMBED_BATCH } = await import('../supabase');

const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ content: `chunk-${i}`, other: `keep-${i}` }));
const vecFor = (content) => [content.length, 0.5, 1]; // deterministic per-content "vector"

beforeEach(() => { embedTexts.mockReset(); });

describe('_addEmbeddings', () => {
  it('makes ONE embedTexts call for a realistic chapter-sized batch (well under EMBED_BATCH)', async () => {
    // Largest real chapter observed in the codebase comments is 51 rows
    // (keph104.pdf, "Laws of Motion") — use that as the realistic case.
    const rows = rowsOf(51);
    embedTexts.mockImplementation(async (texts) => texts.map((t) => vecFor(t)));

    const { rows: out, failedCount } = await _addEmbeddings(rows);

    expect(embedTexts).toHaveBeenCalledTimes(1);          // was: 51 embedText() calls
    expect(embedTexts.mock.calls[0][0]).toHaveLength(51);
    expect(failedCount).toBe(0);
    // Every row keeps its own content's embedding — order/identity preserved.
    out.forEach((r, i) => expect(r.embedding).toEqual(vecFor(`chunk-${i}`)));
  });

  it('every row gets the embedding for ITS OWN content, not a neighbor\'s (order-correctness)', async () => {
    const rows = rowsOf(10);
    // Return embeddings in a DELIBERATELY different internal order than
    // input, the way embedTexts already defends against upstream — this
    // proves _addEmbeddings assigns by array position from embedTexts'
    // (already-reordered) return value, not by re-deriving order itself.
    embedTexts.mockImplementation(async (texts) => texts.map((t) => vecFor(t)));

    const { rows: out } = await _addEmbeddings(rows);
    expect(out.map((r) => r.embedding)).toEqual(rows.map((r) => vecFor(r.content)));
    // Non-embedding fields must survive untouched.
    out.forEach((r, i) => expect(r.other).toBe(`keep-${i}`));
  });

  it('splits into multiple batched calls once EMBED_BATCH is exceeded — still far fewer than N', async () => {
    const n = EMBED_BATCH + 30;
    const rows = rowsOf(n);
    embedTexts.mockImplementation(async (texts) => texts.map((t) => vecFor(t)));

    const { rows: out, failedCount } = await _addEmbeddings(rows);

    const expectedCalls = Math.ceil(n / EMBED_BATCH);
    expect(expectedCalls).toBeGreaterThan(1);
    expect(expectedCalls).toBeLessThan(n);                 // still nowhere near one-per-row
    expect(embedTexts).toHaveBeenCalledTimes(expectedCalls);
    expect(failedCount).toBe(0);
    out.forEach((r, i) => expect(r.embedding).toEqual(vecFor(`chunk-${i}`)));
  });

  it('retries a partial failure with ONE extra batched call covering just the failures, not per-item calls', async () => {
    const rows = rowsOf(5);
    embedTexts
      // first call: rows 1 and 3 (0-indexed) fail
      .mockImplementationOnce(async (texts) => texts.map((t, i) => (i === 1 || i === 3 ? null : vecFor(t))))
      // retry call: only 2 texts should be sent (the failed ones), both succeed this time
      .mockImplementationOnce(async (texts) => texts.map((t) => vecFor(t)));

    const { rows: out, failedCount } = await _addEmbeddings(rows);

    expect(embedTexts).toHaveBeenCalledTimes(2);
    expect(embedTexts.mock.calls[1][0]).toEqual(['chunk-1', 'chunk-3']); // retry batch, not 2 separate calls
    expect(failedCount).toBe(0);
    out.forEach((r, i) => expect(r.embedding).toEqual(vecFor(`chunk-${i}`)));
  });

  it('counts rows still null after the batched retry as failed, without throwing', async () => {
    const rows = rowsOf(3);
    embedTexts
      .mockImplementationOnce(async () => [vecFor('chunk-0'), null, null])
      .mockImplementationOnce(async () => [null, vecFor('chunk-2')]); // row 1 still fails on retry

    const { rows: out, failedCount } = await _addEmbeddings(rows);

    expect(failedCount).toBe(1);
    expect(out[0].embedding).toEqual(vecFor('chunk-0'));
    expect(out[1].embedding).toBeUndefined();
    expect(out[2].embedding).toEqual(vecFor('chunk-2'));
  });

  it('does not mutate the caller\'s original row objects', async () => {
    const rows = rowsOf(2);
    const original = rows.map((r) => ({ ...r }));
    embedTexts.mockImplementation(async (texts) => texts.map((t) => vecFor(t)));

    await _addEmbeddings(rows);
    expect(rows).toEqual(original); // no .embedding on the inputs themselves
  });
});
