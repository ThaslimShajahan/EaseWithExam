import { describe, it, expect, vi } from 'vitest';

vi.mock('../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      limit:  vi.fn().mockResolvedValue({ data: [] }),
    })),
    rpc: vi.fn().mockResolvedValue({ data: null }),
  },
  getTopicFrequency: vi.fn().mockResolvedValue([]),
}));

vi.mock('../aiProxy', () => ({
  chatComplete: vi.fn(),
  embedText:    vi.fn(),
}));

vi.mock('../featureFlags', () => ({
  getFeatureFlag: vi.fn().mockResolvedValue(false),
  FLAGS: { BLUEPRINT_V2: 'blueprint_v2_enabled' },
}));

vi.mock('../syllabus', () => ({
  getChapters: vi.fn().mockResolvedValue([]),
}));

import { PAPER_PATTERNS, toEngineFormat, ambiguousOptionsReason } from '../questionGen';
import { getExamPattern } from '../examPattern';

// questionGen.js and examPattern.js import from each other (examPattern reads
// PAPER_PATTERNS; questionGen reads getExamPattern so admin-uploaded
// paper_templates overrides actually reach paper generation). This test's
// mere existence — importing both and calling into the cycle — is itself the
// regression check that the circular import resolves cleanly at runtime and
// not just at build time.
describe('questionGen <-> examPattern circular import', () => {
  it('resolves getExamPattern through the cycle without throwing', () => {
    const pattern = getExamPattern('CBSE Class 8');
    expect(pattern).toBeTruthy();
    expect(pattern.totalQ).toBe(34);
  });
});

// Every CBSE-style pattern's totalQ/totalMarks must equal the sum of its own
// section counts/marks — these fields used to drift out of sync (e.g. Class 8
// stated 39 questions while its sections only summed to 34), producing a
// misleading question count in the UI and, worse, contradictory instructions
// in the AI generation prompt.
describe('PAPER_PATTERNS internal consistency', () => {
  for (const [name, pattern] of Object.entries(PAPER_PATTERNS)) {
    const sectionEntries = Object.entries(pattern.sections ?? {})
      .filter(([, s]) => typeof s.count === 'number' && typeof s.marks === 'number');
    if (!sectionEntries.length) continue; // NEET/JEE use a different shape — not this check's concern

    it(`${name}: totalQ and totalMarks match the sum of its sections`, () => {
      const qSum = sectionEntries.reduce((sum, [, s]) => sum + s.count, 0);
      const mSum = sectionEntries.reduce((sum, [, s]) => sum + s.count * s.marks, 0);
      expect(qSum).toBe(pattern.totalQ);
      expect(mSum).toBe(pattern.totalMarks);
    });
  }
});

/* ── Diagram / figure passthrough ───────────────────────────────
 * Physics ray diagrams, Chemistry bonding structures and Maths graphs all
 * arrive as either an attached `image_url` (admin-uploaded or DALL-E
 * generated) or an AI-written `diagram_description`. toEngineFormat is the
 * single boundary every generated question crosses on its way to the exam
 * engine and to published_tests, so if it drops these fields the figure is
 * gone everywhere downstream with no error.
 */
describe('toEngineFormat — figures', () => {
  const base = { question: 'Identify the part labelled A.', options: ['A. x', 'B. y', 'C. z', 'D. w'], answer: 'A' };

  it('preserves an attached image_url', () => {
    const [q] = toEngineFormat([{ ...base, image_url: 'https://cdn.example/fig1.png' }], 'Physics', 'NEET');
    expect(q.image_url).toBe('https://cdn.example/fig1.png');
  });

  it('preserves diagram_description when no image is attached', () => {
    const [q] = toEngineFormat([{ ...base, diagram_description: 'Ray diagram of a convex lens' }], 'Physics', 'NEET');
    expect(q.image_url).toBeNull();
    expect(q.diagram_description).toBe('Ray diagram of a convex lens');
  });

  it('nulls both when the question has no figure', () => {
    const [q] = toEngineFormat([base], 'Chemistry', 'NEET');
    expect(q.image_url).toBeNull();
    expect(q.diagram_description).toBeNull();
  });

  it('keeps figures on descriptive questions too (not just MCQs)', () => {
    const [q] = toEngineFormat(
      [{ question: 'Draw and explain.', type: 'Long Answer', image_url: 'https://cdn.example/bond.png' }],
      'Chemistry', 'CBSE Class 12',
    );
    expect(q.image_url).toBe('https://cdn.example/bond.png');
    expect(q.options).toBeNull();
  });
});

/* ── ambiguousOptionsReason — the reported bug: "which of these is a
 * perfect square? 64, 50, 72, 81" keyed only 64, but 81 (9^2) is also a
 * perfect square. Neither keyContradictsExplanation nor the semantic
 * verifier can catch this — both only ask "is the keyed option correct",
 * never "is it the ONLY correct one". This is the check that does. */
describe('ambiguousOptionsReason', () => {
  it('flags the exact reported bug: two perfect squares, only one keyed', () => {
    const reason = ambiguousOptionsReason(
      'Which of the following numbers is a perfect square?',
      ['64', '50', '72', '81'],
      0, // keyed: 64
    );
    expect(reason).toMatch(/81/);
    expect(reason).toMatch(/perfect square/);
  });

  it('passes clean when exactly one option satisfies the category', () => {
    const reason = ambiguousOptionsReason(
      'Which of the following numbers is a perfect square?',
      ['64', '50', '72', '48'],
      0,
    );
    expect(reason).toBeNull();
  });

  it('covers perfect cube, prime, even, odd', () => {
    expect(ambiguousOptionsReason('Which is a perfect cube?', ['27', '8', '10', '12'], 0)).toMatch(/8/);
    expect(ambiguousOptionsReason('Which of these is a prime number?', ['9', '15', '7', '11'], 2)).toMatch(/11/);
    expect(ambiguousOptionsReason('Which of these is an even number?', ['3', '4', '6', '9'], 1)).toMatch(/6/);
    expect(ambiguousOptionsReason('Which of these is an odd number?', ['2', '4', '7', '9'], 2)).toMatch(/9/);
  });

  it('handles "multiple of N" with the N extracted from the question', () => {
    const reason = ambiguousOptionsReason('Which of the following is a multiple of 7?', ['14', '21', '15', '9'], 0);
    expect(reason).toMatch(/21/);
  });

  it('flips the expected direction for negated phrasing ("is NOT a perfect square")', () => {
    // 50, 72, 48 are all non-squares — three valid answers to a question
    // that should only have one, so this must still fire even negated.
    const reason = ambiguousOptionsReason(
      'Which of the following is NOT a perfect square?',
      ['64', '50', '72', '48'],
      1, // keyed: 50
    );
    expect(reason).toMatch(/perfect square/);
  });

  it('is not fooled by a genuinely unique negated answer', () => {
    const reason = ambiguousOptionsReason(
      'Which of the following is NOT a perfect square?',
      ['64', '81', '49', '48'],
      3, // keyed: 48, the only non-square
    );
    expect(reason).toBeNull();
  });

  it('returns null — not a guess — when options are not plain numbers', () => {
    expect(ambiguousOptionsReason('Which is a perfect square?', ['sixty-four', 'fifty', 'seventy-two', 'eighty-one'], 0))
      .toBeNull();
  });

  it('returns null when the question matches no checkable category', () => {
    expect(ambiguousOptionsReason('What is the capital of France?', ['Paris', 'London', 'Berlin', 'Madrid'], 0))
      .toBeNull();
  });

  it('never blames the keyed option itself — that is a different check\'s job', () => {
    // Key (50) is not even a perfect square, and no OTHER option is either —
    // this function has nothing to say about that; it only compares options
    // against each other, never judges the key in isolation.
    const reason = ambiguousOptionsReason('Which of the following is a perfect square?', ['50', '48', '72', '12'], 0);
    expect(reason).toBeNull();
  });
});

describe('toEngineFormat — flags ambiguous options via needs_review', () => {
  it('flags the reported perfect-square question end to end', () => {
    const [q] = toEngineFormat(
      [{
        question: 'Which of the following numbers is a perfect square?',
        options: ['A. 64', 'B. 50', 'C. 72', 'D. 81'],
        answer: 'A',
        explanation: '64 = 8 squared, so A is correct.',
      }],
      'Mathematics', 'CBSE Class 8',
    );
    expect(q.needs_review).toBe(true);
    expect(q.review_reason).toMatch(/81/);
  });
});
