import { describe, it, expect } from 'vitest';
import { difficultyFromMarks, distributionMatch, scorePaperAgainstPattern } from '../patternStats';

describe('difficultyFromMarks', () => {
  it('matches the CASE in the chapter_pattern_stats view', () => {
    expect(difficultyFromMarks(1)).toBe('easy');
    expect(difficultyFromMarks(2)).toBe('easy');
    expect(difficultyFromMarks(3)).toBe('medium');
    expect(difficultyFromMarks(4)).toBe('medium');
    expect(difficultyFromMarks(5)).toBe('hard');
    expect(difficultyFromMarks(6)).toBe('hard');
  });
  it('handles the engine-format {correct, incorrect} marks object', () => {
    expect(difficultyFromMarks({ correct: 5, incorrect: 0 })).toBe('hard');
  });
  it('says unknown rather than guessing', () => {
    expect(difficultyFromMarks(null)).toBe('unknown');
    expect(difficultyFromMarks(undefined)).toBe('unknown');
    expect(difficultyFromMarks('abc')).toBe('unknown');
  });
});

describe('distributionMatch', () => {
  it('scores identical distributions 100', () => {
    expect(distributionMatch({ MCQ: 10, Long: 5 }, { MCQ: 20, Long: 10 })).toBe(100);
  });
  it('scores disjoint distributions 0', () => {
    expect(distributionMatch({ MCQ: 10 }, { Long: 10 })).toBe(0);
  });
  it('scores partial overlap in between', () => {
    const s = distributionMatch({ MCQ: 5, Long: 5 }, { MCQ: 10, Long: 0 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(100);
  });
  it('returns null when there is nothing to compare', () => {
    expect(distributionMatch({}, {})).toBeNull();
  });
});

describe('scorePaperAgainstPattern', () => {
  const stats = {
    hasData: true,
    questionCount: 34, chapterCount: 2,
    chapters: [
      { chapter: 'Circles', questionCount: 6 },
      { chapter: 'Triangles', questionCount: 4 },
    ],
    byQuestionType: { MCQ: 6, 'Long Answer': 4 },
    byMarks: { 1: 6, 5: 4 },
    byDifficulty: { easy: 6, hard: 4 },
  };

  it('scores a paper that mirrors the pattern near 100', () => {
    const qs = [
      ...Array(6).fill({ chapter: 'Circles',   type: 'MCQ',         marks: 1 }),
      ...Array(4).fill({ chapter: 'Triangles', type: 'Long Answer', marks: 5 }),
    ];
    const r = scorePaperAgainstPattern(qs, stats);
    expect(r.hasData).toBe(true);
    expect(r.chapter).toBe(100);
    expect(r.type).toBe(100);
    expect(r.marks).toBe(100);
    expect(r.overall).toBe(100);
  });

  it('penalises a paper concentrated on the wrong chapter and type', () => {
    const qs = Array(10).fill({ chapter: 'Circles', type: 'MCQ', marks: 1 });
    const r = scorePaperAgainstPattern(qs, stats);
    expect(r.chapter).toBeLessThan(100);
    expect(r.type).toBeLessThan(100);
    expect(r.overall).toBeLessThan(100);
  });

  // The important one: absence of data must never render as a bad score.
  it('reports hasData:false instead of 0 when there is no pattern', () => {
    const r = scorePaperAgainstPattern(
      [{ chapter: 'X', type: 'MCQ', marks: 1 }],
      { hasData: false, reason: 'No past-year questions uploaded for CBSE Class 11 Physics yet.' },
    );
    expect(r.hasData).toBe(false);
    expect(r.overall).toBeNull();
    expect(r.reason).toMatch(/No past-year questions/);
  });

  it('reports hasData:false for an empty paper rather than scoring it', () => {
    expect(scorePaperAgainstPattern([], stats).hasData).toBe(false);
  });

  it('derives difficulty from marks, reported but excluded from overall', () => {
    const qs = [
      ...Array(6).fill({ chapter: 'Circles',   type: 'MCQ',         marks: 1 }),
      ...Array(4).fill({ chapter: 'Triangles', type: 'Long Answer', marks: 5 }),
    ];
    const r = scorePaperAgainstPattern(qs, stats);
    expect(r.difficulty).toBe(100);
    // overall is the mean of chapter/type/marks only — difficulty would be a
    // fourth copy of the marks signal.
    expect(r.overall).toBe(Math.round((r.chapter + r.type + r.marks) / 3));
  });
});
