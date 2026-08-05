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

import { PAPER_PATTERNS } from '../questionGen';
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
