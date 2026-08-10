import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../aiProxy', () => ({ chatComplete: vi.fn() }));
vi.mock('../featureFlags', () => ({
  getFeatureFlag: vi.fn().mockResolvedValue(false),
  FLAGS: { ANSWER_VERIFICATION_OFF: 'answer_verification_off' },
}));

import { chatComplete } from '../aiProxy';
import { getFeatureFlag } from '../featureFlags';
import {
  isVerifiable, firstNumber, numericAgrees, verifyOne, verifyQuestions,
} from '../answerVerification';

const mcq = (over = {}) => ({
  question: 'What is 2 + 2?',
  type: 'MCQ',
  options: ['A. 3', 'B. 4', 'C. 5', 'D. 6'],
  correctOption: 1,
  ...over,
});
const numerical = (over = {}) => ({
  question: 'Work done?', type: 'Numerical', correctAnswer: '20 J', ...over,
});
const reply = (obj) => ({ choices: [{ message: { content: JSON.stringify(obj) } }] });

beforeEach(() => { vi.clearAllMocks(); getFeatureFlag.mockResolvedValue(false); });

describe('isVerifiable', () => {
  it('accepts a well-formed MCQ and a numerical with an answer', () => {
    expect(isVerifiable(mcq())).toBe(true);
    expect(isVerifiable(numerical())).toBe(true);
  });

  it('rejects descriptive types and incomplete questions', () => {
    expect(isVerifiable({ question: 'Explain X', type: 'Long Answer' })).toBe(false);
    expect(isVerifiable(mcq({ correctOption: null }))).toBe(false);
    expect(isVerifiable(mcq({ correctOption: 9 }))).toBe(false);   // beyond options
    expect(isVerifiable(numerical({ correctAnswer: '' }))).toBe(false);
    expect(isVerifiable(null)).toBe(false);
  });
});

describe('firstNumber', () => {
  it('pulls the leading value through units and formatting', () => {
    expect(firstNumber('20 J')).toBe(20);
    expect(firstNumber('-9.8 m/s^2')).toBe(-9.8);
    expect(firstNumber('1,250 N')).toBe(1250);
    expect(firstNumber('−5')).toBe(-5);         // unicode minus
    expect(firstNumber(42)).toBe(42);
  });

  // Regression: the first numerical benchmark withheld a sound question because
  // the verifier answered "1/3" against a key of "0.333333" — same value, read
  // as 1 vs 0.333.
  it('evaluates simple fractions rather than taking the numerator', () => {
    expect(firstNumber('1/3')).toBeCloseTo(0.3333, 4);
    expect(firstNumber('-3/4')).toBeCloseTo(-0.75, 6);
    expect(firstNumber('22/7 approx')).toBeCloseTo(22 / 7, 6);
  });

  it('does not treat a date or a divide-by-zero as a fraction', () => {
    expect(firstNumber('1/3/2024')).toBe(1);   // a date, not a third
    expect(firstNumber('5/0')).toBe(5);
  });

  it('returns null when there is no number', () => {
    expect(firstNumber('none of these')).toBeNull();
    expect(firstNumber('')).toBeNull();
    expect(firstNumber(null)).toBeNull();
  });
});

describe('numericAgrees', () => {
  it('accepts rounding differences but not real ones', () => {
    expect(numericAgrees('9.8', '9.81')).toBe(true);
    expect(numericAgrees('20 J', '20')).toBe(true);
    expect(numericAgrees('20 J', '50 J')).toBe(false);
  });

  it('returns null — not false — when a side has no number to compare', () => {
    expect(numericAgrees('twenty', '20')).toBeNull();
    expect(numericAgrees('20', '')).toBeNull();
  });

  it('accepts a fraction against its decimal — the false positive that was found', () => {
    expect(numericAgrees('1/3', '0.333333')).toBe(true);
    expect(numericAgrees('0.5', '1/2')).toBe(true);
    expect(numericAgrees('1/3', '0.5')).toBe(false);
  });

  it('treats zero-vs-zero as agreement without dividing by zero', () => {
    expect(numericAgrees('0', '0')).toBe(true);
  });
});

describe('verifyOne', () => {
  it('agrees when the verifier picks the keyed option', async () => {
    chatComplete.mockResolvedValue(reply({ answer: 'B', confidence: 'high' }));
    await expect(verifyOne(mcq())).resolves.toMatchObject({ status: 'agree' });
  });

  it('disagrees when the verifier picks a different option', async () => {
    chatComplete.mockResolvedValue(reply({ answer: 'C' }));
    const v = await verifyOne(mcq());
    expect(v.status).toBe('disagree');
    expect(v.reason).toMatch(/chose C.*key says B/);
  });

  it('flags when the verifier says no option matches — the Q2/Q3 failure mode', async () => {
    chatComplete.mockResolvedValue(reply({ answer: 'A', none_match: true }));
    const v = await verifyOne(mcq());
    expect(v.status).toBe('disagree');
    expect(v.reason).toMatch(/matching no option/);
  });

  it('never sends the stored key, explanation or answer to the model', async () => {
    // Distinctive sentinels: if any of these reach the prompt, the verifier is
    // agreeing with the key rather than re-deriving, and the measured recall
    // would be fiction.
    chatComplete.mockResolvedValue(reply({ answer: 'B' }));
    await verifyOne(mcq({
      explanation: 'SENTINEL_EXPLANATION_TEXT',
      review_reason: 'SENTINEL_REVIEW_REASON',
    }));
    const sent = JSON.stringify(chatComplete.mock.calls[0][0]);
    expect(sent).not.toMatch(/correctOption/);
    expect(sent).not.toMatch(/SENTINEL_EXPLANATION_TEXT/);
    expect(sent).not.toMatch(/SENTINEL_REVIEW_REASON/);

    chatComplete.mockClear();
    chatComplete.mockResolvedValue(reply({ answer: '20 J' }));
    await verifyOne(numerical({ correctAnswer: 'SENTINEL_9999 J' }));
    const sentNum = JSON.stringify(chatComplete.mock.calls[0][0]);
    expect(sentNum).not.toMatch(/SENTINEL_9999/);
  });

  it('compares numericals by value, not string', async () => {
    chatComplete.mockResolvedValue(reply({ answer: '20.0 joules' }));
    await expect(verifyOne(numerical())).resolves.toMatchObject({ status: 'agree' });

    chatComplete.mockResolvedValue(reply({ answer: '50 J' }));
    await expect(verifyOne(numerical())).resolves.toMatchObject({ status: 'disagree' });
  });

  it('reports an error rather than throwing on a bad response', async () => {
    chatComplete.mockResolvedValue({ choices: [{ message: { content: 'not json' } }] });
    await expect(verifyOne(mcq())).resolves.toMatchObject({ status: 'error' });

    chatComplete.mockResolvedValue(reply({ answer: 'Z' }));
    await expect(verifyOne(mcq())).resolves.toMatchObject({ status: 'error' });
  });

  it('propagates AbortError so a cancelled generation stops', async () => {
    const err = new Error('aborted'); err.name = 'AbortError';
    chatComplete.mockRejectedValue(err);
    await expect(verifyOne(mcq())).rejects.toThrow('aborted');
  });
});

describe('verifyQuestions', () => {
  it('flags only the disagreeing question and leaves the rest untouched', async () => {
    chatComplete
      .mockResolvedValueOnce(reply({ answer: 'B' }))   // agrees
      .mockResolvedValueOnce(reply({ answer: 'D' }));  // disagrees
    const { questions, stats } = await verifyQuestions([mcq(), mcq()]);
    expect(questions[0].needs_review).toBeFalsy();
    expect(questions[1].needs_review).toBe(true);
    expect(stats).toMatchObject({ checked: 2, agreed: 1, flagged: 1 });
  });

  it('keeps the free cross-check reason alongside its own', async () => {
    chatComplete.mockResolvedValue(reply({ answer: 'D' }));
    const seeded = mcq({ needs_review: true, review_reason: 'cross-check said so' });
    const { questions } = await verifyQuestions([seeded]);
    expect(questions[0].review_reason).toMatch(/cross-check said so/);
    expect(questions[0].review_reason).toMatch(/verifier chose D/);
  });

  it('fails OPEN — an API error leaves the question servable', async () => {
    chatComplete.mockRejectedValue(new Error('500 upstream'));
    const { questions, stats } = await verifyQuestions([mcq()]);
    expect(questions[0].needs_review).toBeFalsy();
    expect(stats).toMatchObject({ errored: 1, flagged: 0 });
  });

  it('skips descriptive questions without calling the model', async () => {
    const { stats } = await verifyQuestions([{ question: 'Explain', type: 'Long Answer' }]);
    expect(chatComplete).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ skipped: 1, checked: 0 });
  });

  it('does nothing at all when the opt-out flag is on', async () => {
    getFeatureFlag.mockResolvedValue(true);
    const { questions, stats } = await verifyQuestions([mcq()]);
    expect(chatComplete).not.toHaveBeenCalled();
    expect(questions[0].needs_review).toBeFalsy();
    expect(stats.disabled).toBe(true);
  });

  it('handles an empty batch without calling anything', async () => {
    const { stats } = await verifyQuestions([]);
    expect(chatComplete).not.toHaveBeenCalled();
    expect(stats.total).toBe(0);
  });
});
