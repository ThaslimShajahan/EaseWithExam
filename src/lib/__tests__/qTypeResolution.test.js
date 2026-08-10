import { describe, it, expect } from 'vitest';
import { defaultQTypesFor, EXAM_QTYPES } from '../examPattern';

/**
 * These two behaviours are a PAIR. Making generateQuestionPaper honour an
 * explicit qTypes selection is only safe because defaultQTypesFor resolves the
 * combined 'CBSE Class 10' form — a direct EXAM_QTYPES lookup misses it and
 * falls back to ['MCQ'], which would have collapsed every Exam Center CBSE
 * paper to MCQ-only the moment the generator stopped overriding the caller.
 */
describe('defaultQTypesFor', () => {
  it('resolves the combined board+class form — the regression this guards', () => {
    // The exact values that were silently missing before.
    expect(defaultQTypesFor('CBSE Class 10')).toEqual(EXAM_QTYPES['Class 10']);
    expect(defaultQTypesFor('CBSE Class 12')).toEqual(EXAM_QTYPES['Class 12']);
    expect(defaultQTypesFor('CBSE Class 10')).not.toEqual(['MCQ']);
  });

  it('includes the written sections for a board paper, not just MCQ', () => {
    const t = defaultQTypesFor('CBSE Class 10');
    expect(t).toContain('Short Answer');
    expect(t).toContain('Long Answer');
  });

  it('prefers the class-specific entry over the board one', () => {
    // Class 8 legitimately omits Assertion-Reason; plain 'CBSE' includes it.
    expect(defaultQTypesFor('CBSE Class 8')).toEqual(EXAM_QTYPES['Class 8']);
    expect(defaultQTypesFor('CBSE Class 8')).not.toContain('Assertion-Reason');
  });

  it('still resolves exact keys and other boards', () => {
    expect(defaultQTypesFor('NEET')).toEqual(['MCQ', 'Assertion-Reason']);
    expect(defaultQTypesFor('JEE Main')).toEqual(['MCQ', 'Numerical']);
    expect(defaultQTypesFor('ICSE Class 10')).toEqual(EXAM_QTYPES['Class 10']);
    expect(defaultQTypesFor('Kerala State Class 10')).toEqual(EXAM_QTYPES['Class 10']);
  });

  it('falls back to MCQ only for a genuinely unknown exam', () => {
    expect(defaultQTypesFor('Some Unknown Exam')).toEqual(['MCQ']);
    expect(defaultQTypesFor('')).toEqual(['MCQ']);
    expect(defaultQTypesFor(null)).toEqual(['MCQ']);
  });

  it('never returns an empty list, which would make the generator default', () => {
    for (const e of ['NEET', 'CBSE Class 10', 'ICSE Class 9', 'nonsense', null]) {
      expect(defaultQTypesFor(e).length).toBeGreaterThan(0);
    }
  });
});
