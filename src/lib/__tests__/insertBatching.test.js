/**
 * Batched insert with timeout backoff.
 *
 * On 2026-08-12 a real study-notes upload (PART 1.pdf) died on
 * "canceling statement due to statement timeout" and lost the whole document.
 * Measuring afterwards could NOT reproduce it — 20 rows insert in ~46ms against
 * the live table and its HNSW index, a 65x margin under anon's 3s budget — so
 * the cause is still unknown and any fix premised on row count would have been
 * a guess.
 *
 * These pin behaviour that works regardless of the cause: halve on contact,
 * never lose the document, and record the payload size so the next occurrence
 * identifies itself.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../firebase/config', () => ({ auth: {}, adminAuth: {} }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }));
vi.mock('../aiProxy', () => ({ embedText: vi.fn(), embedTexts: vi.fn() }));
vi.mock('../changelog', () => ({ logChange: vi.fn(), ENTITY: {}, ACTION: {} }));
vi.mock('../examMapping', () => ({ examTypesFor: () => [] }));

const { insertInBatches, isStatementTimeout, INSERT_BATCH } = await import('../supabase');

const rows = (n) => Array.from({ length: n }, (_, i) => ({ i, content: 'x'.repeat(100) }));
const ok = (slice) => ({ data: slice.map((r) => ({ id: `id-${r.i}` })), error: null });
const timeout = () => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });

describe('isStatementTimeout', () => {
  it('recognises the SQLSTATE', () => {
    expect(isStatementTimeout({ code: '57014' })).toBe(true);
  });

  it('recognises the message when no code is present', () => {
    expect(isStatementTimeout({ message: 'canceling statement due to statement timeout' })).toBe(true);
  });

  // Must NOT swallow unrelated failures into a retry loop — a 42501 retried at
  // half size is just a permission error charged twice.
  it.each([
    ['permission denied', { code: '42501', message: 'Access denied' }],
    ['not-null violation', { code: '23502', message: 'null value in column' }],
    ['no error', null],
  ])('does not treat %s as a timeout', (_l, e) => {
    expect(isStatementTimeout(e)).toBe(false);
  });
});

describe('insertInBatches', () => {
  it('inserts everything in full batches when nothing fails', async () => {
    const calls = [];
    const r = await insertInBatches(rows(50), (s) => { calls.push(s.length); return ok(s); });
    expect(r.error).toBeNull();
    expect(r.inserted).toHaveLength(50);
    expect(calls).toEqual([20, 20, 10]);
  });

  // THE FIX. A timeout must cost a retry, not the document.
  it('halves the batch on a timeout and still inserts every row', async () => {
    const calls = [];
    let failed = false;
    const r = await insertInBatches(rows(40), (s) => {
      calls.push(s.length);
      if (!failed && s.length === 20) { failed = true; return timeout(); }
      return ok(s);
    });
    expect(r.error).toBeNull();
    expect(r.inserted).toHaveLength(40);
    expect(calls[0]).toBe(20);
    expect(calls[1]).toBe(10);   // halved, same starting row
  });

  // The reduced size sticks: if one batch was too heavy the next probably is,
  // and creeping back up just pays the timeout again.
  it('keeps the reduced size for the rest of the document', async () => {
    const calls = [];
    let failed = false;
    await insertInBatches(rows(60), (s) => {
      calls.push(s.length);
      if (!failed && s.length === 20) { failed = true; return timeout(); }
      return ok(s);
    });
    // 20 fails, then six batches of 10 cover all 60 rows from the start.
    expect(calls).toEqual([20, 10, 10, 10, 10, 10, 10]);
  });

  it('halves repeatedly when the timeout persists', async () => {
    const calls = [];
    await insertInBatches(rows(20), (s) => {
      calls.push(s.length);
      return s.length > 2 ? timeout() : ok(s);
    });
    expect(calls.slice(0, 4)).toEqual([20, 10, 5, 2]);
  });

  // A single row that still times out is genuinely stuck — retrying forever
  // would hang the upload instead of failing it.
  it('gives up at one row rather than looping', async () => {
    let n = 0;
    const r = await insertInBatches(rows(4), (s) => { n++; return timeout(); });
    expect(r.error).toBeTruthy();
    expect(r.failedSlice.rowCount).toBe(1);
    expect(n).toBeLessThan(10);
  });

  it('does not retry a non-timeout error', async () => {
    const calls = [];
    const r = await insertInBatches(rows(40), (s) => {
      calls.push(s.length);
      return { data: null, error: { code: '42501', message: 'Access denied' } };
    });
    expect(calls).toEqual([20]);          // one attempt, no halving
    expect(r.error.code).toBe('42501');
  });

  // The diagnostics are the point: the original failure was undiagnosable
  // because nothing recorded how big the failing payload was.
  it('reports row count, byte size and position of the failing slice', async () => {
    const r = await insertInBatches(rows(30), (s) => (s.length === 20 ? timeout() : { data: null, error: { code: '42501', message: 'nope' } }), { minBatchSize: 10 });
    expect(r.failedAt).toBe(0);
    expect(r.failedSlice.rowCount).toBe(10);
    expect(r.failedSlice.bytes).toBeGreaterThan(0);
  });

  it('returns rows inserted before the failure so the caller can roll them back', async () => {
    const r = await insertInBatches(rows(40), (s) =>
      (s[0].i === 0 ? ok(s) : { data: null, error: { code: '42501', message: 'nope' } }));
    expect(r.inserted).toHaveLength(20);
    expect(r.failedAt).toBe(20);
  });

  it('defaults to a batch size of 20', () => {
    expect(INSERT_BATCH).toBe(20);
  });
});
