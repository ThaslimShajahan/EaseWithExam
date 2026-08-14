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
import { resolveStudentSubjects, resolveStudentSubjectsForExam, isStreamClass } from '../studentSubjects';

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

  it('a PARTIAL match prompts rather than serving the subset that lines up', () => {
    // Owner decision: never guess when uncertain. 5 of 6 matching is ambiguous —
    // we cannot tell whether the 6th was dropped, renamed, or belongs to a board
    // list that is still being set up. Serving the 5 would be a best-effort guess
    // presented as an answer, and would silently omit a subject the student may
    // still study.
    const r = resolveStudentSubjects({
      profileSubjects: [...SCIENCE_12, 'Retired Subject'], boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(r.needsSetup).toBe(true);
    expect(r.subjects).toEqual([]);
    expect(r.isScoped).toBe(false);
  });

  it('an EXACT match is served, so the strict rule does not block the normal case', () => {
    const r = resolveStudentSubjects({
      profileSubjects: SCIENCE_12, boardSubjects: CBSE_12, classLevel: '12',
    });
    expect(r.needsSetup).toBe(false);
    expect(r.subjects).toHaveLength(5);
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

  it('Classes 6 and 7 are handled, though onboarding does not currently offer them', () => {
    // exam_categories carries Class 6 and 7 (4 rows each) but
    // onboarding_category_display does not, so no student can select them today.
    // The resolver keys on "is this a stream class", not on an enumerated list,
    // so they take the junior path by construction — full board list, no prompt,
    // no crash — if they are ever enabled.
    ['6', '7'].forEach((cls) => {
      const r = resolveStudentSubjects({ profileSubjects: null, boardSubjects: CBSE_8, classLevel: cls });
      expect(r.subjects, cls).toEqual(CBSE_8);
      expect(r.needsSetup, cls).toBe(false);
    });
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

describe('resolveStudentSubjectsForExam — competitive exam types (2026-08-14 fix)', () => {
  const NEET_SUBJECTS = ['Physics', 'Chemistry', 'Biology'];

  it('the actual reported bug: a NEET+CBSE-12 student was permanently blocked', () => {
    // The real live profile at the time: target_exam 'BOTH' -> competitive
    // 'NEET' as examType, subjects === SCIENCE_12 (their CBSE stream list,
    // English and Mathematics included). Run through the OLD path
    // (resolveStudentSubjects, no competitive awareness) this was blocked:
    const old = resolveStudentSubjects({
      profileSubjects: SCIENCE_12, boardSubjects: NEET_SUBJECTS, classLevel: '12',
    });
    expect(old.needsSetup).toBe(true); // ← the bug, pinned so it can't silently return

    // The fix: same inputs, told this examType is competitive.
    const fixed = resolveStudentSubjectsForExam({
      profileSubjects: SCIENCE_12, boardSubjects: NEET_SUBJECTS, classLevel: '12', isCompetitive: true,
    });
    expect(fixed.needsSetup).toBe(false);
    expect(fixed.subjects).toEqual(NEET_SUBJECTS);
    expect(fixed.isScoped).toBe(true);
  });

  it('never blocks a competitive exam type, however profile.subjects and the catalog relate', () => {
    [
      { profileSubjects: null,              label: 'no profile selection at all' },
      { profileSubjects: [],                label: 'empty profile selection' },
      { profileSubjects: ['Latin'],         label: 'a profile subject unrelated to the exam' },
      { profileSubjects: NEET_SUBJECTS,     label: 'an exact match' },
    ].forEach(({ profileSubjects, label }) => {
      const r = resolveStudentSubjectsForExam({
        profileSubjects, boardSubjects: NEET_SUBJECTS, classLevel: '12', isCompetitive: true,
      });
      expect(r.needsSetup, label).toBe(false);
      expect(r.subjects, label).toEqual(NEET_SUBJECTS);
    });
  });

  it('board/school exam types are unaffected — still delegate to resolveStudentSubjects', () => {
    const r = resolveStudentSubjectsForExam({
      profileSubjects: SCIENCE_12, boardSubjects: CBSE_12, classLevel: '12', isCompetitive: false,
    });
    expect(r).toEqual(resolveStudentSubjects({ profileSubjects: SCIENCE_12, boardSubjects: CBSE_12, classLevel: '12' }));
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
