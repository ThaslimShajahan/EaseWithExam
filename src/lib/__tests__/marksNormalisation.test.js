/**
 * `pyq_questions.marks` is an INTEGER column, and savePYQRows used to pass the
 * model's value into it untouched. A Class X maths model paper returned 0.5 and
 * Postgres rejected the entire multi-row insert:
 *
 *   invalid input syntax for type integer: "0.5"   (SQLSTATE 22P02)
 *
 * ~40 questions were lost to one field. These pin the coercion that prevents
 * it, and — just as important — pin that every adjustment is REPORTED rather
 * than applied silently.
 */
import { describe, it, expect } from 'vitest';
import { normaliseMarks, MAX_PLAUSIBLE_QUESTION_MARKS } from '../contentExtraction';

describe('normaliseMarks — values that are already fine', () => {
  // Every mark currently in production is one of these; none may be touched.
  it.each([1, 2, 3, 4, 5])('passes %i through unchanged and silently', (n) => {
    expect(normaliseMarks(n)).toEqual({ value: n, note: null });
  });

  it('treats a missing mark as blank, not as an error', () => {
    for (const raw of [null, undefined, '']) {
      expect(normaliseMarks(raw)).toEqual({ value: null, note: null });
    }
  });

  it('accepts an integer sent as a string', () => {
    expect(normaliseMarks('3')).toEqual({ value: 3, note: null });
  });
});

describe('normaliseMarks — the reported failure', () => {
  // THE BUG. This exact value killed 00_Std_X_ModelQn_Maths_Set-A_Eng.pdf.
  it('coerces 0.5 to an integer the column accepts', () => {
    const r = normaliseMarks(0.5);
    expect(Number.isInteger(r.value)).toBe(true);
    expect(r.value).toBe(1);
  });

  // Rounding down would make a real half-mark question worth nothing.
  it('never rounds a positive mark down to zero', () => {
    for (const raw of [0.1, 0.25, 0.4, 0.5]) {
      expect(normaliseMarks(raw).value).toBeGreaterThanOrEqual(1);
    }
  });

  it('reports every adjustment it makes', () => {
    expect(normaliseMarks(0.5).note).toMatch(/0\.5 → 1/);
    expect(normaliseMarks(2.5).note).toMatch(/2\.5 → 3/);
  });

  it('rounds to nearest, not toward zero', () => {
    expect(normaliseMarks(3.4).value).toBe(3);
    expect(normaliseMarks(3.6).value).toBe(4);
  });

  // Indian board papers and their marking schemes print these directly.
  it.each([
    ['½',  1],
    ['1½', 2],
    ['¼',  1],
    ['¾',  1],
  ])('reads the fraction glyph %s as %i', (raw, expected) => {
    expect(normaliseMarks(raw).value).toBe(expected);
  });
});

describe('normaliseMarks — values that must not reach the column', () => {
  // A question worth 0 or -1 is not a question; storing it would corrupt every
  // total that sums this column (chapter_pattern_stats, published paper marks).
  it.each([0, -1, -0.5])('leaves %p blank and says why', (raw) => {
    const r = normaliseMarks(raw);
    expect(r.value).toBeNull();
    expect(r.note).toMatch(/non-positive/);
  });

  // The usual model artefact: the paper's total_marks leaking into a question.
  it('rejects an implausible per-question mark', () => {
    const r = normaliseMarks(80);
    expect(r.value).toBeNull();
    expect(r.note).toMatch(/implausible/);
    expect(normaliseMarks(MAX_PLAUSIBLE_QUESTION_MARKS).value).toBe(MAX_PLAUSIBLE_QUESTION_MARKS);
  });

  it.each(['', ' ', 'two', 'N/A', '—', {}, []])('leaves unreadable input %p blank', (raw) => {
    expect(normaliseMarks(raw).value).toBeNull();
  });

  // The contract the insert depends on: whatever goes in, what comes out is
  // either null or something Postgres will accept as an int4.
  it('always yields null or a safe integer, for any input', () => {
    const inputs = [
      0.5, 1, 4.75, -3, 0, 999, NaN, Infinity, -Infinity, '½', '2.5', 'abc',
      null, undefined, '', {}, [], true, false, '1e3', '0.0001',
    ];
    for (const raw of inputs) {
      const { value } = normaliseMarks(raw);
      if (value === null) continue;
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(MAX_PLAUSIBLE_QUESTION_MARKS);
    }
  });
});
