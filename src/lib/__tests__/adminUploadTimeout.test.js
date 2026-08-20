import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2026-08-20: the admin content-upload pipeline (notes/PYQ/manifest/vision
 * extraction) must use ADMIN_UPLOAD_TIMEOUT_MS (140s), not the tighter
 * AI_REQUEST_TIMEOUT_MS (90s) default every student-facing call still uses —
 * see aiProxy.js's header on why 90s provably wasn't enough for a legitimately
 * slow (not stuck) dense-chapter extraction. notesAdaptiveSplit.test.js,
 * manifestExtraction.test.js and pdfVision.test.js each assert this for their
 * own call site; this file covers the fourth, runPYQExtraction, which had no
 * existing test harness to extend.
 */
vi.mock('../aiProxy', () => ({
  cachedChatComplete: vi.fn(),
  AI_REQUEST_TIMEOUT_MS: 1000,
  ADMIN_UPLOAD_TIMEOUT_MS: 1000,
}));

import { cachedChatComplete } from '../aiProxy';
import { runPYQExtraction } from '../contentExtraction';

const questionReply = () => ({
  choices: [{
    finish_reason: 'stop',
    message: { content: JSON.stringify({
      paper_title: 'Sample', total_marks: 1,
      questions: [{ question_text: 'What is 2+2?', options: ['3', '4', '5', '6'], correct_answer: 'B', marks: 1, type: 'MCQ' }],
    }) },
  }],
});

beforeEach(() => vi.clearAllMocks());

describe('runPYQExtraction — admin-upload timeout wiring', () => {
  it('passes ADMIN_UPLOAD_TIMEOUT_MS, not the tighter student-facing default', async () => {
    cachedChatComplete.mockResolvedValueOnce(questionReply());
    await runPYQExtraction({
      rawText: 'Q1. What is 2+2? (a) 3 (b) 4 (c) 5 (d) 6',
      examType: 'CBSE Class 10', subject: 'Mathematics', year: '2024', onProgress: () => {},
    });
    const [, opts] = cachedChatComplete.mock.calls[0];
    expect(opts.timeoutMs).toBe(1000); // mocked ADMIN_UPLOAD_TIMEOUT_MS above
    expect(opts.feature).toBe('pyq-extraction');
  });
});
