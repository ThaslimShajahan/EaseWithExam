/**
 * Pins the rounding bug found live 2026-08-14: a grant expiring in 13 minutes
 * displayed "1 day left" because the previous logic used Math.ceil() on the
 * raw days figure — any remainder above 0 rounded UP to a full day. Also
 * confirms the day-bucket boundary matches send_expiry_reminders()' own
 * floor() math, so the badge and the actual reminder schedule never disagree
 * about what "1 day left" means.
 */
import { describe, it, expect } from 'vitest';
import { formatCountdown } from '../ExpiryBadge';

const future = (ms) => new Date(Date.now() + ms).toISOString();

describe('formatCountdown', () => {
  it('THE REPORTED BUG: 13 minutes left must read as minutes/hours, never "1 day"', () => {
    expect(formatCountdown(future(13 * 60_000))).toBe('1 hour left');
  });

  it('drops to hours for anything under a day, matching send_expiry_reminders() floor() semantics', () => {
    expect(formatCountdown(future(23 * 3_600_000))).toBe('23 hours left');
    expect(formatCountdown(future(90 * 60_000))).toBe('1 hour left');    // 1h30m floors to 1h, not 2
  });

  it('never shows "0 hours" — a live-but-imminent grant still reads as at least 1', () => {
    expect(formatCountdown(future(30_000))).toBe('1 hour left');
  });

  it('shows whole days once >=24h remain, floored not ceiled', () => {
    expect(formatCountdown(future(2 * 86_400_000))).toBe('2 days left');
    // 2 days + 1 hour must still floor to 2, not round up to 3.
    expect(formatCountdown(future(2 * 86_400_000 + 3_600_000))).toBe('2 days left');
  });

  it('pluralises correctly at the day/hour boundary', () => {
    expect(formatCountdown(future(1 * 86_400_000 + 60_000))).toBe('1 day left');
    expect(formatCountdown(future(3 * 3_600_000))).toBe('3 hours left');
  });

  it('an already-passed expiry reads as ending now, not a negative count', () => {
    expect(formatCountdown(future(-60_000))).toBe('ending now');
    expect(formatCountdown(future(0))).toBe('ending now');
  });
});
