/**
 * The partial-syllabus gate, after it gained a subject dimension.
 *
 * Both halves, and here the second half is the whole point of the change:
 *
 *   PERMITTED — Class 8/9 Social Science, whose books are Part 1 only, is
 *               exempted from the closed-list rule.
 *   DENIED    — Class 8/9 Mathematics and Science are NOT exempted, even though
 *               they share an exam_type with Social Science. Those two subjects
 *               have complete syllabi and 148 loaded files behind them, and a
 *               bare 'CBSE Class 8' entry would have quietly loosened the
 *               constraint that stops the model inventing chapter names.
 *
 * The second assertion is the one that would have caught the bug, so it is
 * asserted per subject rather than once.
 */
import { describe, it, expect } from 'vitest';
import { isPartialSyllabus, PARTIAL_SYLLABUS } from '../contentExtraction';

describe('isPartialSyllabus', () => {
  it('exempts the Part 1-only Social Science books', () => {
    expect(isPartialSyllabus('CBSE Class 8', 'Social Science')).toBe(true);
    expect(isPartialSyllabus('CBSE Class 9', 'Social Science')).toBe(true);
  });

  /* THE REGRESSION THIS CHANGE EXISTS TO PREVENT. */
  it.each([
    ['CBSE Class 8', 'Mathematics'],
    ['CBSE Class 8', 'Science'],
    ['CBSE Class 9', 'Mathematics'],
    ['CBSE Class 9', 'Science'],
    ['CBSE Class 8', 'English'],
    ['CBSE Class 9', 'English'],
  ])('does NOT exempt %s %s, which shares the exam type', (examType, subject) => {
    expect(isPartialSyllabus(examType, subject)).toBe(false);
  });

  /* Kerala predates the subject dimension and every one of its subjects is
   * Part 1, so it stays a whole-exam-type entry and must keep behaving as one. */
  it.each(['Mathematics', 'Physics', 'Chemistry', 'Biology'])(
    'still covers Kerala %s from the exam-type entry alone',
    (subject) => {
      expect(isPartialSyllabus('Kerala State Class 10', subject)).toBe(true);
    },
  );

  it('leaves complete syllabi untouched', () => {
    expect(isPartialSyllabus('NEET', 'Physics')).toBe(false);
    expect(isPartialSyllabus('CBSE Class 10', 'Mathematics')).toBe(false);
    expect(isPartialSyllabus('CBSE Class 11', 'Chemistry')).toBe(false);
  });

  it('checks only the exam-type form when no subject is supplied', () => {
    // Honest answer: without a subject there is no way to know that Class 8
    // Social Science is the partial one, so do not claim the whole class is.
    expect(isPartialSyllabus('Kerala State Class 10')).toBe(true);
    expect(isPartialSyllabus('CBSE Class 8')).toBe(false);
  });

  it('keys subject entries as `exam::subject`', () => {
    expect(PARTIAL_SYLLABUS.has('CBSE Class 8::Social Science')).toBe(true);
    // A bare exam-type entry for either class would be the bug.
    expect(PARTIAL_SYLLABUS.has('CBSE Class 8')).toBe(false);
    expect(PARTIAL_SYLLABUS.has('CBSE Class 9')).toBe(false);
  });
});
