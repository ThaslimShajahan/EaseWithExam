/**
 * Adaptive batch-splitting for runNotesExtraction — the fix for the real
 * failure "Structuring response hit the 3000-token output cap on batch 5/6"
 * (CBSE Class 12 Maths Part 1, "Relations and Functions", 2026-08-19).
 *
 * The old behaviour threw the whole file out the moment ANY batch's output
 * hit NOTES_MAX_TOKENS, which means NOTES_BATCH_CHARS could only ever be as
 * safe as the densest chapter anyone had happened to measure — the exact
 * mistake the PYQ batching (PYQ_BATCH_CHARS's header) already went through
 * three rounds of tuning to learn from. These tests assert the new behaviour
 * instead: a truncated batch is halved and retried automatically, so density
 * is handled per-batch at upload time rather than by a human pre-guessing
 * which chapters are "safe" — see the two halves:
 *
 *   RECOVERS — a batch that truncates (finish_reason='length', or the
 *              unlabelled-truncation case where the JSON simply doesn't
 *              parse) is split and retried rather than failing the file.
 *   STILL FAILS LOUDLY — a batch that is unsplittable (one page) or that
 *              keeps truncating past NOTES_SPLIT_MAX_DEPTH still throws a
 *              real error, so a genuinely unusual page is surfaced rather
 *              than silently degraded or retried forever.
 *   NO REGRESSION — an ordinary batch that never truncates makes exactly as
 *              many calls as before the split logic existed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../aiProxy', () => ({ cachedChatComplete: vi.fn(), AI_REQUEST_TIMEOUT_MS: 1000 }));

import { cachedChatComplete } from '../aiProxy';
import { runNotesExtraction } from '../contentExtraction';

const stop  = (lessons, unit = null) => ({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ unit, lessons }) } }] });
const length = () => ({ choices: [{ finish_reason: 'length', message: { content: '{"unit":null,"lessons":[' } }] }); // deliberately cut off
const badJson = () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"unit":null,"lessons":[{"title":"X",' } }] }); // truncated but labelled 'stop'

const lesson = (title, content = 'c'.repeat(50)) => [{
  title, page_start: 1, page_end: 1, marker_start: 1, marker_end: 1,
  chunks: [{ heading: 'h', content }],
}];

/** `n` distinguishable [[PAGE N]]-marked pages, joined exactly like
 *  extractNotesByManifest's markedSlice does, so splitBatchInHalf's
 *  page-boundary rule has real boundaries to cut at. */
const rawTextFor = (n, padChars = 80) => Array
  .from({ length: n }, (_, i) => `[[PAGE ${i + 1}]]\nPage ${i + 1} body. ${'x'.repeat(padChars)}`)
  .join('\n\n');

beforeEach(() => { vi.clearAllMocks(); });

describe('runNotesExtraction — no regression on an ordinary (non-truncating) upload', () => {
  it('a batch that succeeds first try makes exactly one call, same as before adaptive splitting existed', async () => {
    cachedChatComplete.mockResolvedValueOnce(stop(lesson('Ordinary Chapter')));
    const { lessons } = await runNotesExtraction({
      rawText: rawTextFor(3), examType: 'CBSE Class 11', subject: 'History',
      onProgress: () => {},
    });
    expect(cachedChatComplete).toHaveBeenCalledTimes(1);
    expect(lessons).toHaveLength(1);
    expect(lessons[0].title).toBe('Ordinary Chapter');
  });
});

describe('runNotesExtraction — RECOVERS: a truncated batch is split and retried, not failed', () => {
  it('finish_reason=length on the whole batch: splits once, both halves succeed, no error', async () => {
    cachedChatComplete
      .mockResolvedValueOnce(length())                 // whole 6-page batch: too dense
      .mockResolvedValueOnce(stop(lesson('Half A')))    // first half (~3 pages): fine
      .mockResolvedValueOnce(stop(lesson('Half B')));   // second half (~3 pages): fine

    const { lessons } = await runNotesExtraction({
      rawText: rawTextFor(6), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    });

    expect(cachedChatComplete).toHaveBeenCalledTimes(3);
    expect(lessons.map((l) => l.title).sort()).toEqual(['Half A', 'Half B']);

    // Each half's own CONTENT section (the actual source text sent, not the
    // surrounding prompt scaffolding — which can grow slightly on later
    // calls from the "ALREADY IN PROGRESS" continuation note) is a strict
    // subset of the original — proof the split actually shrank what was
    // sent, not just re-sent the same text and hoped.
    const sourceTextOf = (body) => body.slice(body.indexOf('CONTENT:\n') + 'CONTENT:\n'.length);
    const sentBodies = cachedChatComplete.mock.calls.map((c) => sourceTextOf(c[0].messages[1].content));
    expect(sentBodies[1].length).toBeLessThan(sentBodies[0].length);
    expect(sentBodies[2].length).toBeLessThan(sentBodies[0].length);
  });

  it('recurses more than one level when a half is STILL too dense', async () => {
    cachedChatComplete
      .mockResolvedValueOnce(length())                  // 8 pages: too dense
      .mockResolvedValueOnce(length())                   // first half (~4 pages): still too dense
      .mockResolvedValueOnce(stop(lesson('Quarter A')))   // first quarter (~2 pages): fine
      .mockResolvedValueOnce(stop(lesson('Quarter B')))   // second quarter (~2 pages): fine
      .mockResolvedValueOnce(stop(lesson('Half B')));     // second half (~4 pages): fine

    const { lessons } = await runNotesExtraction({
      rawText: rawTextFor(8), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    });

    expect(cachedChatComplete).toHaveBeenCalledTimes(5);
    expect(lessons.map((l) => l.title).sort()).toEqual(['Half B', 'Quarter A', 'Quarter B']);
  });

  it('an unparseable response with finish_reason=stop is recovered the same way as a labelled length cap', async () => {
    // The exact shape the two Class 11 literature files hit: OpenAI said
    // 'stop' but the JSON was cut off anyway — no 'length' to catch it.
    cachedChatComplete
      .mockResolvedValueOnce(badJson())
      .mockResolvedValueOnce(stop(lesson('Recovered A')))
      .mockResolvedValueOnce(stop(lesson('Recovered B')));

    const { lessons } = await runNotesExtraction({
      rawText: rawTextFor(4), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    });

    expect(cachedChatComplete).toHaveBeenCalledTimes(3);
    expect(lessons.map((l) => l.title).sort()).toEqual(['Recovered A', 'Recovered B']);
  });
});

describe('runNotesExtraction — STILL FAILS LOUDLY: splitting has real limits', () => {
  it('a single page that truncates on its own cannot be split further and fails immediately, without exhausting the depth budget', async () => {
    cachedChatComplete.mockResolvedValueOnce(length());

    await expect(runNotesExtraction({
      rawText: rawTextFor(1), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    })).rejects.toThrow(/single .* page that can't be split any smaller/);

    // Exactly one call — no pointless retries of an unsplittable page.
    expect(cachedChatComplete).toHaveBeenCalledTimes(1);
  });

  it('a batch that is still too dense after NOTES_SPLIT_MAX_DEPTH splits surfaces a real error, not a silent failure', async () => {
    // Every call truncates, however small the excerpt — this is the
    // "genuinely unusual, not just an ordinary dense chapter" case.
    cachedChatComplete.mockResolvedValue(length());

    // 32 pages survives 4 halvings (32 -> 16 -> 8 -> 4 -> 2) with pages still
    // left to split, so this exercises the depth cap, not the single-page cap.
    await expect(runNotesExtraction({
      rawText: rawTextFor(32), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    })).rejects.toThrow(/even after 4 automatic splits/);
  });

  it('a finish_reason the split logic does not own (e.g. content_filter) still fails immediately, unsplit', async () => {
    cachedChatComplete.mockResolvedValueOnce({
      choices: [{ finish_reason: 'content_filter', message: { content: null } }],
    });

    await expect(runNotesExtraction({
      rawText: rawTextFor(4), examType: 'CBSE Class 12', subject: 'Mathematics',
      onProgress: () => {},
    })).rejects.toThrow(/finish_reason='content_filter'/);

    expect(cachedChatComplete).toHaveBeenCalledTimes(1);
  });
});
