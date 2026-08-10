import { describe, it, expect, vi } from 'vitest';
import {
  parseAnswerLetter, hasOrderedOptions, shuffleOptions,
  keyContradictsExplanation, toEngineFormat,
} from '../questionGen';

describe('parseAnswerLetter', () => {
  it('parses A-D in any casing or with trailing text', () => {
    expect(parseAnswerLetter('A')).toBe(0);
    expect(parseAnswerLetter('c')).toBe(2);
    expect(parseAnswerLetter('B) 42')).toBe(1);
  });

  // The whole point of the change: these used to become 0, i.e. a
  // confidently-scored "A".
  it('returns null rather than 0 for a missing or unusable key', () => {
    expect(parseAnswerLetter(undefined)).toBeNull();
    expect(parseAnswerLetter(null)).toBeNull();
    expect(parseAnswerLetter('')).toBeNull();
    expect(parseAnswerLetter('E')).toBeNull();
    expect(parseAnswerLetter('42')).toBeNull();
  });
});

describe('hasOrderedOptions', () => {
  it('protects Assertion-Reason ladders', () => {
    expect(hasOrderedOptions('Assertion-Reason', ['x', 'y'])).toBe(true);
    expect(hasOrderedOptions('MCQ', ['Both A and R are true', 'A is true'])).toBe(true);
  });
  it('protects "all/none of the above"', () => {
    expect(hasOrderedOptions('MCQ', ['2', '4', 'None of the above'])).toBe(true);
  });
  it('allows ordinary options to shuffle', () => {
    expect(hasOrderedOptions('MCQ', ['12 cm', '13 cm', '5 cm', '10 cm'])).toBe(false);
  });
});

describe('shuffleOptions', () => {
  it('keeps the key pointing at the same option text', () => {
    const options = ['w', 'x', 'y', 'z'];
    for (let i = 0; i < 50; i++) {
      const r = shuffleOptions(options, 2);
      expect(r.options).toHaveLength(4);
      expect([...r.options].sort()).toEqual(['w', 'x', 'y', 'z']);
      expect(r.options[r.keyIdx]).toBe('y');
    }
  });
});

describe('keyContradictsExplanation', () => {
  // The measured Q14: explanation computes 28, key points at 30.
  it('flags a numeric key sharing nothing with its explanation', () => {
    expect(keyContradictsExplanation('30', 'Sum = 20 x 5 = 100. Remaining = 18 x 4 = 72. Removed = 100 - 72 = 28.')).toBeTruthy();
  });
  it('passes when the key appears in the working', () => {
    expect(keyContradictsExplanation('28', 'Sum = 100, remaining 72, removed = 28.')).toBeNull();
    expect(keyContradictsExplanation('1540 m^3', 'V = pi r^2 h = pi x 7^2 x 10 = 1540')).toBeNull();
  });
  it('stays quiet when there is nothing numeric to compare', () => {
    expect(keyContradictsExplanation('Newton', 'The SI unit of force is the Newton.')).toBeNull();
    expect(keyContradictsExplanation('42', 'No digits here at all.')).toBeNull();
  });
});

describe('toEngineFormat answer-key handling', () => {
  const mcq = (over = {}) => ({
    question: 'Q?', type: 'MCQ', options: ['1 m', '2 m', '3 m', '4 m'],
    answer: 'B', explanation: 'Working gives 2 m.', ...over,
  });

  it('drops a question whose key cannot be parsed instead of scoring it as A', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = toEngineFormat([mcq({ answer: undefined })], 'Physics', 'CBSE Class 11');
    expect(out).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('drops a key that points past the end of the options', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(toEngineFormat([mcq({ answer: 'D', options: ['1', '2'] })], 'Physics', 'CBSE Class 11')).toHaveLength(0);
    warn.mockRestore();
  });

  it('keeps the key on the right option through shuffling', () => {
    for (let i = 0; i < 30; i++) {
      const [q] = toEngineFormat([mcq()], 'Physics', 'CBSE Class 11');
      expect(q.options[q.correctOption]).toBe('2 m');
    }
  });

  it('does not shuffle an Assertion-Reason ladder', () => {
    const opts = ['Both A and R are true, and R explains A', 'Both true, R does not explain A', 'A true, R false', 'A false'];
    const [q] = toEngineFormat([{ question: 'Q?', type: 'Assertion-Reason', options: opts, answer: 'A', explanation: 'x' }], 'Maths', 'CBSE Class 10');
    expect(q.options).toEqual(opts);
    expect(q.correctOption).toBe(0);
  });

  it('flags — but does not drop — a key contradicting its explanation', () => {
    const [q] = toEngineFormat(
      [mcq({ options: ['28', '30', '32', '34'], answer: 'B', explanation: 'Sum 100, remaining 72, removed = 28.' })],
      'Maths', 'CBSE Class 10',
    );
    expect(q.needs_review).toBe(true);
    expect(q.review_reason).toMatch(/shares no value/);
  });

  it('leaves a sound question unflagged', () => {
    const [q] = toEngineFormat([mcq()], 'Physics', 'CBSE Class 11');
    expect(q.needs_review).toBe(false);
  });
});

/* NTA-style numeric answer keys — added after the NEET PYQ load found that the
 * 2025 paper's 180 answers were all published as "(1)".."(4)" and parsed as
 * null under a letters-only map. */
describe('parseAnswerLetter — numeric NTA keys', () => {
  it('maps bare digits 1-4 onto option indexes', () => {
    expect(parseAnswerLetter('1')).toBe(0);
    expect(parseAnswerLetter('2')).toBe(1);
    expect(parseAnswerLetter('3')).toBe(2);
    expect(parseAnswerLetter('4')).toBe(3);
  });

  it('handles the bracketed form NEET keys actually print', () => {
    expect(parseAnswerLetter('(1)')).toBe(0);
    expect(parseAnswerLetter('(4)')).toBe(3);
    expect(parseAnswerLetter('3)')).toBe(2);
    expect(parseAnswerLetter('2.')).toBe(1);
  });

  it('still handles letters, including bracketed and prefixed forms', () => {
    expect(parseAnswerLetter('A')).toBe(0);
    expect(parseAnswerLetter('(C)')).toBe(2);
    expect(parseAnswerLetter('Ans: B')).toBe(1);
    expect(parseAnswerLetter('d')).toBe(3);
  });

  it('rejects out-of-range and junk rather than defaulting to 0', () => {
    expect(parseAnswerLetter('5')).toBeNull();
    expect(parseAnswerLetter('0')).toBeNull();
    expect(parseAnswerLetter('BONUS')).toBeNull();
    expect(parseAnswerLetter('')).toBeNull();
    expect(parseAnswerLetter(null)).toBeNull();
  });
});
