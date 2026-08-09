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

import { PAPER_PATTERNS, toEngineFormat } from '../questionGen';
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
