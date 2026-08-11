import { describe, it, expect, vi, beforeEach } from 'vitest';

// backoffMs/sleep are stubbed rather than mocked away entirely: visionExtractPage
// paces its parse-retry with them, and the real sleep would add ~1s of wall time
// per retry test for no added coverage. Returning 0 keeps the call-count
// assertions honest while the suite stays fast.
vi.mock('../aiProxy', () => ({
  chatComplete: vi.fn(),
  backoffMs:    vi.fn(() => 0),
  sleep:        vi.fn(() => Promise.resolve()),
}));
vi.mock('../pdfAnalyzer', () => ({ loadPdfDocument: vi.fn() }));
vi.mock('../supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { chatComplete } from '../aiProxy';
import {
  needsVision, isUsableBbox, visionExtractPage,
  MIN_TEXT_CHARS, MAX_VISION_PAGES,
} from '../pdfVision';

beforeEach(() => { chatComplete.mockReset(); });

describe('needsVision — the gate that decides whether a page costs an AI call', () => {
  it.each([
    ['empty string', '', true],
    ['whitespace only', '   \n\t  ', true],
    ['null', null, true],
    ['undefined', undefined, true],
  ])('fires on %s', (_label, input, expected) => {
    expect(needsVision(input)).toBe(expected);
  });

  // The boundary is the whole point: one character either side decides whether
  // a page is transcribed by a vision model or trusted as-is.
  it('is exclusive at exactly MIN_TEXT_CHARS', () => {
    expect(needsVision('x'.repeat(MIN_TEXT_CHARS - 1))).toBe(true);
    expect(needsVision('x'.repeat(MIN_TEXT_CHARS))).toBe(false);
    expect(needsVision('x'.repeat(MIN_TEXT_CHARS + 1))).toBe(false);
  });

  it('measures trimmed length, so a page of padding still counts as empty', () => {
    expect(needsVision(`   ${'x'.repeat(10)}   `)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(needsVision('x'.repeat(50), { minChars: 10 })).toBe(false);
    expect(needsVision('x'.repeat(5),  { minChars: 10 })).toBe(true);
  });

  it('keeps the documented default in sync with the constant', () => {
    expect(MIN_TEXT_CHARS).toBe(80);
    expect(MAX_VISION_PAGES).toBe(40);
  });
});

describe('isUsableBbox — vision models are unreliable at coordinates', () => {
  it('accepts a well-formed box', () => {
    expect(isUsableBbox({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 })).toBe(true);
  });

  it.each([
    ['null',                 null],
    ['not an object',        'nope'],
    ['missing h',            { x: 0.1, y: 0.1, w: 0.5 }],
    ['NaN',                  { x: NaN, y: 0.1, w: 0.5, h: 0.5 }],
    ['negative origin',      { x: -0.1, y: 0.1, w: 0.5, h: 0.5 }],
    ['zero area',            { x: 0.1, y: 0.1, w: 0, h: 0.5 }],
    ['overflows the page',   { x: 0.8, y: 0.1, w: 0.5, h: 0.5 }],
    ['sliver-thin',          { x: 0.1, y: 0.1, w: 0.01, h: 0.5 }],
    ['effectively the page', { x: 0, y: 0, w: 1, h: 1 }],
  ])('rejects %s', (_label, bbox) => {
    expect(isUsableBbox(bbox)).toBe(false);
  });

  it('tolerates floating-point overshoot at the page edge', () => {
    expect(isUsableBbox({ x: 0.5, y: 0.5, w: 0.5000004, h: 0.5000004 })).toBe(true);
  });
});

describe('visionExtractPage', () => {
  const ok = (payload) => chatComplete.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(payload) } }],
  });

  it('returns the parsed transcription', async () => {
    ok({
      markdown: '# Motion in a Plane\n$v = u + at$',
      equations: [{ latex: 'v = u + at', inline: true }],
      figures: [{ index: 1, caption: 'Vector addition', kind: 'diagram', bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.3 } }],
    });
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', { pageNo: 1 });
    expect(r.markdown).toContain('Motion in a Plane');
    expect(r.equations).toHaveLength(1);
    expect(r.figures[0].caption).toBe('Vector addition');
  });

  it('sends the image as a vision content part with detail:high', async () => {
    ok({ markdown: 'x', equations: [], figures: [] });
    await visionExtractPage('data:image/jpeg;base64,AAA', '', { pageNo: 3 });

    const [params] = chatComplete.mock.calls[0];
    expect(params.model).toBe('gpt-4o');
    const parts = params.messages.at(-1).content;
    expect(Array.isArray(parts)).toBe(true);
    const img = parts.find((p) => p.type === 'image_url');
    // "low" discards exactly what this is for — small diagram labels and exponents.
    expect(img.image_url.detail).toBe('high');
    expect(img.image_url.url).toBe('data:image/jpeg;base64,AAA');
  });

  it('passes the existing text layer through as a disambiguation hint', async () => {
    ok({ markdown: 'x', equations: [], figures: [] });
    await visionExtractPage('data:image/jpeg;base64,AAA', 'partial layer text', { pageNo: 1 });
    const text = chatComplete.mock.calls[0][0].messages.at(-1).content.find((p) => p.type === 'text').text;
    expect(text).toContain('partial layer text');
  });

  // One bad page must not abort a 40-page document — but it must not pass for a
  // blank page either. `ok: false` plus a reason is what lets the orchestrator
  // report "3 pages FAILED" instead of silently shipping unrepaired text.
  it.each([
    ['malformed JSON', { choices: [{ message: { content: '{ not json' } }] }, /unparseable JSON/],
    ['empty choices',  { choices: [] },                                      /empty response/],
    ['no content',     { choices: [{ message: {} }] },                       /empty response/],
  ])('degrades to a FAILED result on %s, carrying the reason', async (_label, response, reason) => {
    chatComplete.mockResolvedValue(response);
    // attempts:1 keeps this focused on the degradation, not the retry.
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {}, { attempts: 1 });
    expect(r.markdown).toBe('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(reason);
  });

  /* A real upload lost page 9 of a Class X maths paper to "model returned
   * unparseable JSON" on the first and only attempt. The transport retry in
   * chatComplete never saw it — a 200 with a bad body is not a transport
   * failure — so the page was dropped for something a second call would very
   * likely have fixed. */
  it('retries an unparseable body and keeps the recovered page', async () => {
    chatComplete
      .mockResolvedValueOnce({ choices: [{ message: { content: '{ not json' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify({ markdown: 'recovered page', equations: [], figures: [] }) } }] });

    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(chatComplete).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    expect(r.markdown).toBe('recovered page');
  });

  it('gives up after the retry and says how many attempts it made', async () => {
    chatComplete.mockResolvedValue({ choices: [{ message: { content: 'still not json' } }] });
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(chatComplete).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unparseable JSON \(after 2 attempts\)/);
  });

  /* chatComplete has already spent its own 3 attempts on a transport failure.
   * Retrying here too would turn one dead page into 6 calls. */
  it('does NOT retry a transport failure, which aiProxy already retried', async () => {
    chatComplete.mockRejectedValue(new Error('AI request timed out after 90s'));
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(chatComplete).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('AI request timed out after 90s');
  });

  it('reports the underlying error when the call itself throws', async () => {
    chatComplete.mockRejectedValue(new Error('AI request timed out after 90s'));
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(r.markdown).toBe('');
    expect(r.ok).toBe(false);
    // The reason has to survive to the UI — "it failed" is what made the
    // original hang undiagnosable for 15 minutes.
    expect(r.error).toBe('AI request timed out after 90s');
  });

  it('marks a genuinely blank page as ok, not failed', async () => {
    ok({ markdown: '', equations: [], figures: [] });
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
  });

  // An abort is the operator navigating away — it must stop the run, not be
  // swallowed into "this page had no text" and let the loop grind on.
  it('rethrows AbortError instead of swallowing it', async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    chatComplete.mockRejectedValue(err);
    await expect(visionExtractPage('data:image/jpeg;base64,AAA', '', {})).rejects.toThrow('aborted');
  });

  it('drops equations with no latex and tolerates non-array fields', async () => {
    ok({ markdown: 'x', equations: [{ latex: 'E=mc^2' }, { inline: true }], figures: 'not-an-array' });
    const r = await visionExtractPage('data:image/jpeg;base64,AAA', '', {});
    expect(r.equations).toHaveLength(1);
    expect(r.figures).toEqual([]);
  });
});
