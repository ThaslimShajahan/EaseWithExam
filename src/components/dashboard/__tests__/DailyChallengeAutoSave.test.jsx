/**
 * Daily Mini Test auto-save (2026-09-25). daily_challenge_attempts was empty
 * because no student ever pressed "Finish challenge": each answer is revealed
 * as it is picked, so after the last one the test looks done. The attempt is
 * now saved the moment the last question is answered.
 *
 * Pins: saves without any button press, exactly once; a failed save shows the
 * error and "Try saving again" (and is not silently retried); the score only
 * shows once the save succeeded; milestone notifications only on a first save.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const lib = vi.hoisted(() => ({
  getTodayChallenge: vi.fn(),
  generateDailyChallenge: vi.fn(),
  saveChallengeAnswer: vi.fn(),
  getTodayAttempt: vi.fn(),
}));
const gam = vi.hoisted(() => ({ announceXpMilestones: vi.fn() }));
const notif = vi.hoisted(() => ({ createNotification: vi.fn(() => Promise.resolve()) }));

vi.mock('../../../lib/dailyChallenge', () => ({ ...lib, DailyChallengeUnavailable: class extends Error {} }));
vi.mock('../../../lib/gamification', () => gam);
vi.mock('../../../lib/notifications', () => notif);
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'stu-1' }, userProfile: { target_exam: 'NONE', syllabus: 'CBSE', class_level: '8', subjects: [] } }),
}));
vi.mock('../../ui/MathText', () => ({ default: ({ text }) => text }));
vi.mock('react-router-dom', () => ({ Link: ({ children }) => children }));
// No animations: AnimatePresence mode="wait" would hold the next question back
// until the previous one's exit animation finishes, which jsdom never runs.
vi.mock('framer-motion', async () => {
  const React = await import('react');
  const strip = ({ initial, animate, exit, transition, layout, whileHover, whileTap, ...rest }) => rest;
  const motion = new Proxy({}, { get: (_, tag) => React.forwardRef((props, ref) => React.createElement(tag, { ...strip(props), ref })) });
  return { motion, AnimatePresence: ({ children }) => React.createElement(React.Fragment, null, children) };
});

const { default: DailyChallenge } = await import('../DailyChallenge');

const CHALLENGE = {
  id: 'ch-1', exam_type: 'CBSE Class 8', subject: 'Science', chapter: 'Cells', correct_answer: 'paper',
  options: [
    { type: 'MCQ', q: 'Q1', opts: ['A. one', 'B. two'], answer: 'A' },
    { type: 'MCQ', q: 'Q2', opts: ['A. one', 'B. two'], answer: 'B' },
  ],
};

let container, root;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const buttons = () => [...container.querySelectorAll('button')];
const byText = (t) => buttons().find((b) => b.textContent.includes(t));
const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

async function answerAll() {
  await click(byText('A.'));          // Q1
  await click(byText('Next'));
  await click(byText('B.'));          // Q2 — the last one
  await flush();
}

beforeEach(async () => {
  vi.clearAllMocks();
  lib.getTodayChallenge.mockResolvedValue(CHALLENGE);
  lib.getTodayAttempt.mockResolvedValue(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<DailyChallenge />); });
  await flush();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Daily Mini Test auto-save', () => {
  it('saves the attempt when the last question is answered, without pressing Finish', async () => {
    lib.saveChallengeAnswer.mockResolvedValue({ saved: true, first_save: true, xp_awarded: 20, gamification: { xp: 20, streak_days: 1 } });
    await answerAll();

    expect(lib.saveChallengeAnswer).toHaveBeenCalledTimes(1);
    expect(lib.saveChallengeAnswer).toHaveBeenCalledWith('ch-1', 'stu-1', JSON.stringify({ 0: 'A', 1: 'B' }), true);
    expect(container.textContent).not.toContain('Finish challenge');   // score summary shown
    expect(gam.announceXpMilestones).toHaveBeenCalledWith('stu-1', { xp: 20, streak_days: 1 }, 20);
    expect(notif.createNotification).toHaveBeenCalledTimes(1);
  });

  it('does not save before the last question is answered', async () => {
    await click(byText('A.'));
    await flush();
    expect(lib.saveChallengeAnswer).not.toHaveBeenCalled();
  });

  it('on failure shows the error and "Try saving again", does not auto-retry, and the button retries', async () => {
    lib.saveChallengeAnswer.mockRejectedValueOnce(new Error('network down'));
    await answerAll();

    expect(lib.saveChallengeAnswer).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]').textContent).toContain('network down');
    expect(byText('Try saving again')).toBeTruthy();
    expect(gam.announceXpMilestones).not.toHaveBeenCalled();
    expect(notif.createNotification).not.toHaveBeenCalled();

    await flush();
    expect(lib.saveChallengeAnswer).toHaveBeenCalledTimes(1);          // no silent retry loop

    lib.saveChallengeAnswer.mockResolvedValueOnce({ saved: true, first_save: true, xp_awarded: 20, gamification: { xp: 40 } });
    await click(byText('Try saving again'));
    await flush();
    expect(lib.saveChallengeAnswer).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(notif.createNotification).toHaveBeenCalledTimes(1);
  });

  it('a re-save of an already-rewarded attempt announces nothing', async () => {
    lib.saveChallengeAnswer.mockResolvedValue({ saved: true, first_save: false, xp_awarded: 0, gamification: null });
    await answerAll();
    expect(lib.saveChallengeAnswer).toHaveBeenCalledTimes(1);
    expect(gam.announceXpMilestones).not.toHaveBeenCalled();
    expect(notif.createNotification).not.toHaveBeenCalled();
  });
});

describe('restored attempt', () => {
  it('a test already saved today is shown as done and never re-saved', async () => {
    act(() => root.unmount());
    lib.getTodayAttempt.mockResolvedValue({ selected_option: JSON.stringify({ 0: 'A', 1: 'B' }) });
    root = createRoot(container);
    await act(async () => { root.render(<DailyChallenge />); });
    await flush();
    expect(lib.saveChallengeAnswer).not.toHaveBeenCalled();
  });
});
