/**
 * Both-halves cover for subject scoping.
 *
 * PERMITTED — a student with a selection sees exactly their own subjects.
 * DENIED    — a student who should have one and doesn't gets the setup prompt,
 *             never an unscoped catalogue and never an empty picker.
 *
 * The third case is the one most likely to be got wrong by a later change:
 * classes 8-10 have no streams, so "no selection" is CORRECT there and must keep
 * showing the full board list. Prompting them would point at a step that does
 * not exist and lock every junior student out of every subject picker.
 */
import { describe, it, expect } from 'vitest';
import { resolveStudentSubjects, isStreamClass } from '../studentSubjects';

const CBSE_12 = ['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology',
                 'Accountancy', 'Business Studies', 'Economics', 'Psychology', 'Political Science'];
const CBSE_8  = ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Sanskrit'];

// The real Class 12 profile in the live DB at the time of writing.
const SCIENCE_12 = ['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology'];

describe('isStreamClass', () => {
  it('is true only for 11 and 12', () => {
    expect(isStreamClass('11')).toBe(true);
    expect(isStreamClass('12')).toBe(true);
    ['8', '9', '10', 'REPEATER', '', null, undefined].forEach((c) => {
      expect(isStreamClass(c), String(c)).toBe(false);
    });
  });
});

describe('PERMITTED — a student with a selection', () => {
  it('sees exactly their own subjects, not the catalogue', () => {
    const r = resolveStudentSubjects({
      profileSubjects: SCIENCE_12, boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(r.subjects).toEqual(['English', 'Physics', 'Chemistry', 'Mathematics', 'Biology']);
    expect(r.isScoped).toBe(true);
    expect(r.needsSetup).toBe(false);
  });

  it('does NOT see other streams\' subjects — the actual reported bug', () => {
    const { subjects } = resolveStudentSubjects({
      profileSubjects: SCIENCE_12, boardSubjects: CBSE_12, classLevel: '12',
    });
    ['Accountancy', 'Business Studies', 'Economics', 'Psychology', 'Political Science']
      .forEach((s) => expect(subjects).not.toContain(s));
  });

  it('keeps BOARD ordering, so pickers are stable across screens', () => {
    const { subjects } = resolveStudentSubjects({
      profileSubjects: ['Biology', 'English', 'Physics'], boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(subjects).toEqual(['English', 'Physics', 'Biology']);
  });

  it('drops a subject the board no longer offers, rather than showing a dead entry', () => {
    const { subjects } = resolveStudentSubjects({
      profileSubjects: [...SCIENCE_12, 'Retired Subject'], boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(subjects).not.toContain('Retired Subject');
    expect(subjects).toHaveLength(5);
  });

  it('falls back to the profile list while the board list is still loading', () => {
    // An empty picker that fills in a moment later reads as a bug.
    const r = resolveStudentSubjects({
      profileSubjects: SCIENCE_12, boardSubjects: [], classLevel: '12',
    });
    expect(r.subjects).toEqual(SCIENCE_12);
    expect(r.isScoped).toBe(true);
  });
});

describe('DENIED — 11/12 with no selection gets the prompt, not a catalogue', () => {
  it('returns needsSetup and NO subjects', () => {
    const r = resolveStudentSubjects({
      profileSubjects: null, boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(r.needsSetup).toBe(true);
    expect(r.subjects).toEqual([]);
    expect(r.isScoped).toBe(false);
  });

  it('an empty array is the same as null', () => {
    expect(resolveStudentSubjects({ profileSubjects: [], boardSubjects: CBSE_12, classLevel: '11' }).needsSetup).toBe(true);
  });

  it('a selection that intersects to nothing is a prompt, not a silent catalogue', () => {
    // Profile and catalogue genuinely disagree. Showing everything would look
    // intentional; saying so is honest.
    const r = resolveStudentSubjects({
      profileSubjects: ['Latin', 'Astrophysics'], boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(r.needsSetup).toBe(true);
    expect(r.subjects).toEqual([]);
  });
});

describe('Classes 8-10 — no streams exist, so nothing is missing', () => {
  it('shows the full board list and does NOT prompt', () => {
    const r = resolveStudentSubjects({
      profileSubjects: null, boardSubjects: CBSE_8, classLevel: '8',
    });
    expect(r.subjects).toEqual(CBSE_8);
    expect(r.needsSetup).toBe(false);   // prompting would point at a step that does not exist
    expect(r.isScoped).toBe(false);     // honest: this is the catalogue, not a selection
  });

  it('every junior class behaves the same', () => {
    ['8', '9', '10'].forEach((cls) => {
      const r = resolveStudentSubjects({ profileSubjects: [], boardSubjects: CBSE_8, classLevel: cls });
      expect(r.subjects, cls).toEqual(CBSE_8);
      expect(r.needsSetup, cls).toBe(false);
    });
  });

  it('a junior student WITH subjects still gets them scoped', () => {
    const r = resolveStudentSubjects({
      profileSubjects: ['Mathematics', 'Science'], boardSubjects: CBSE_8, classLevel: '9',
    });
    expect(r.subjects).toEqual(['Mathematics', 'Science']);
    expect(r.isScoped).toBe(true);
  });
});

describe('never crashes, never silently empty', () => {
  it('tolerates junk input', () => {
    expect(() => resolveStudentSubjects({})).not.toThrow();
    expect(resolveStudentSubjects({}).subjects).toEqual([]);
    expect(resolveStudentSubjects({ profileSubjects: [null], boardSubjects: [undefined], classLevel: null }).subjects).toEqual([]);
  });

  it('an unknown class with no board list prompts nothing and shows nothing to guess at', () => {
    const r = resolveStudentSubjects({ profileSubjects: null, boardSubjects: [], classLevel: 'REPEATER' });
    expect(r.subjects).toEqual([]);
    expect(r.needsSetup).toBe(false);
  });
});
