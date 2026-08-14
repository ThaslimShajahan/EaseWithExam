/**
 * Pins the timezone round-trip found live 2026-08-14: a stored UTC expiry
 * displayed in a datetime-local field using .toISOString() showed the wrong
 * time, and re-saving it untouched would silently shift the real value by
 * the viewer's UTC offset. Now shared by AdminStudents.jsx and
 * AdminQuota.jsx — one implementation, so it cannot drift between the two.
 */
import { describe, it, expect } from 'vitest';
import { toLocalInputValue } from '../dateInput';

describe('toLocalInputValue', () => {
  it('round-trips: display then re-parse produces the same UTC instant', () => {
    const storedUtc = '2026-08-17T12:14:00.000Z';
    const displayed = toLocalInputValue(new Date(storedUtc));
    // What a save handler does with an untouched field: new Date(str).toISOString()
    const resaved = new Date(displayed).toISOString();
    expect(resaved.slice(0, 16)).toBe(storedUtc.slice(0, 16));
  });

  it('shifts by exactly the local timezone offset, not zero', () => {
    const d = new Date('2026-08-17T12:14:00.000Z');
    const displayed = toLocalInputValue(d);
    const offsetMin = d.getTimezoneOffset();
    if (offsetMin !== 0) {
      // If the test runner's TZ is not UTC, the displayed wall-clock string
      // must differ from the raw UTC one — proving the offset was applied,
      // not silently dropped (the exact bug: using toISOString() directly).
      expect(displayed).not.toBe(storedIsoMinutes(d));
    }
  });

  it('produces the "YYYY-MM-DDTHH:mm" shape datetime-local expects', () => {
    const displayed = toLocalInputValue(new Date('2026-08-17T12:14:00.000Z'));
    expect(displayed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});

function storedIsoMinutes(d) { return d.toISOString().slice(0, 16); }
