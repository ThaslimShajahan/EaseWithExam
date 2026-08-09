import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  EXAM_TYPE_GROUPS,
  BOARDS,
  CLASS_LEVELS,
  getSubjectsForExam,
  getAllExamTypes,
  resolveBoard,
  getSchoolExamType,
  getCompetitiveExamType,
  getExamContexts,
  buildExamType,
  isRelevantToStudent,
  isExamTag,
  prettyExamTag,
  normalizeExamType,
} from '../categories';

describe('CATEGORIES', () => {
  it('has correct subjects for NEET', () => {
    expect(CATEGORIES['NEET'].subjects).toEqual(['Physics', 'Chemistry', 'Biology']);
  });

  it('has correct subjects for JEE Main', () => {
    expect(CATEGORIES['JEE Main'].subjects).toEqual(['Physics', 'Chemistry', 'Mathematics']);
  });

  it('marks competitive exams with type "competitive"', () => {
    expect(CATEGORIES['NEET'].type).toBe('competitive');
    expect(CATEGORIES['JEE Main'].type).toBe('competitive');
    expect(CATEGORIES['CUET'].type).toBe('competitive');
  });

  it('marks board exams with type "board"', () => {
    expect(CATEGORIES['CBSE'].type).toBe('board');
    expect(CATEGORIES['ICSE'].type).toBe('board');
  });

  it('marks school classes with type "school"', () => {
    expect(CATEGORIES['Class 10'].type).toBe('school');
    expect(CATEGORIES['Class 12'].type).toBe('school');
  });

  it('every entry has a label, type, group, and subjects array', () => {
    Object.entries(CATEGORIES).forEach(([key, cat]) => {
      expect(cat.label, key).toBeTruthy();
      expect(cat.type, key).toMatch(/^(competitive|board|school)$/);
      expect(cat.group, key).toBeTruthy();
      expect(Array.isArray(cat.subjects), key).toBe(true);
      expect(cat.subjects.length, key).toBeGreaterThan(0);
    });
  });
});

describe('getSubjectsForExam', () => {
  it('returns subjects for a known exam', () => {
    expect(getSubjectsForExam('NEET')).toEqual(['Physics', 'Chemistry', 'Biology']);
  });

  it('returns a default array for an unknown exam', () => {
    expect(getSubjectsForExam('UNKNOWN_EXAM')).toEqual(['Mathematics', 'Science', 'English']);
  });

  it('handles CBSE board', () => {
    const subjects = getSubjectsForExam('CBSE');
    expect(subjects).toContain('Mathematics');
    expect(subjects).toContain('Science');
  });
});

describe('getAllExamTypes', () => {
  it('returns an array of strings', () => {
    const types = getAllExamTypes();
    expect(Array.isArray(types)).toBe(true);
    expect(types.length).toBeGreaterThan(10);
    types.forEach((t) => expect(typeof t).toBe('string'));
  });

  it('includes competitive and board entries', () => {
    const types = getAllExamTypes();
    expect(types).toContain('NEET');
    expect(types).toContain('JEE Main');
    expect(types).toContain('CBSE');
    expect(types).toContain('Class 10');
  });
});

describe('BOARDS and CLASS_LEVELS constants', () => {
  it('BOARDS contains the three national boards', () => {
    expect(BOARDS).toContain('CBSE');
    expect(BOARDS).toContain('ICSE');
    expect(BOARDS).toContain('State Board');
  });

  it('CLASS_LEVELS covers 8-12', () => {
    expect(CLASS_LEVELS).toEqual(expect.arrayContaining(['8', '9', '10', '11', '12']));
  });
});

describe('EXAM_TYPE_GROUPS', () => {
  it('has three groups', () => {
    expect(EXAM_TYPE_GROUPS).toHaveLength(3);
  });

  it('each group has label, icon, and items', () => {
    EXAM_TYPE_GROUPS.forEach((g) => {
      expect(g.label).toBeTruthy();
      expect(g.icon).toBeTruthy();
      expect(Array.isArray(g.items)).toBe(true);
    });
  });
});

/* ── Profile → exam context resolution ─────────────────────────
 * Regression cover for the three bugs this flow rebuild fixed:
 *   1. buildExamType() preferred the board+class combo over the student's
 *      stated competitive goal, so 8 of 15 live users who picked NEET were
 *      being served "CBSE Class 8" content everywhere.
 *   2. 'KERALA_STATE' never matched BOARDS' 'Kerala State' (underscore vs
 *      space), so state-board students resolved to no combo at all — in
 *      buildExamType AND, separately, in isRelevantToStudent.
 *   3. Kerala State tags failed the exam-tag test, so they never produced a
 *      content filter and leaked through as fake chapter names.
 */
describe('exam context resolution', () => {
  const neetStudent   = { target_exam: 'NEET', syllabus: 'CBSE',         class_level: '12' };
  const boardStudent  = { target_exam: 'NONE', syllabus: 'CBSE',         class_level: '10' };
  const keralaStudent = { target_exam: 'NONE', syllabus: 'KERALA_STATE', class_level: '10' };
  const repeater      = { target_exam: 'NEET', syllabus: 'CBSE',         class_level: 'REPEATER' };

  it('resolveBoard maps the onboarding key to the BOARDS display name', () => {
    expect(resolveBoard('CBSE')).toBe('CBSE');
    expect(resolveBoard('KERALA_STATE')).toBe('Kerala State');
    expect(resolveBoard('NA')).toBeNull();
    expect(resolveBoard(undefined)).toBeNull();
  });

  it('keeps BOTH contexts for a competitive student', () => {
    expect(getCompetitiveExamType(neetStudent)).toBe('NEET');
    expect(getSchoolExamType(neetStudent)).toBe('CBSE Class 12');
    expect(getExamContexts(neetStudent)).toEqual(['NEET', 'CBSE Class 12']);
  });

  it('buildExamType prefers the competitive goal over board+class', () => {
    // Was 'CBSE Class 12' — the stated NEET goal was silently discarded.
    expect(buildExamType('NEET', 'CBSE', '12')).toBe('NEET');
  });

  it('board-only students resolve to their board+class combo', () => {
    expect(getCompetitiveExamType(boardStudent)).toBeNull();
    expect(getSchoolExamType(boardStudent)).toBe('CBSE Class 10');
    expect(buildExamType('NONE', 'CBSE', '10')).toBe('CBSE Class 10');
  });

  it('resolves Kerala State despite the underscore key', () => {
    expect(getSchoolExamType(keralaStudent)).toBe('Kerala State Class 10');
    expect(buildExamType('NONE', 'KERALA_STATE', '10')).toBe('Kerala State Class 10');
  });

  it('a repeater has no school context but keeps the competitive one', () => {
    expect(getSchoolExamType(repeater)).toBeNull();
    expect(getCompetitiveExamType(repeater)).toBe('NEET');
    expect(buildExamType('NEET', 'CBSE', 'REPEATER')).toBe('NEET');
  });

  it('legacy CLASS_* targets still resolve', () => {
    expect(getCompetitiveExamType({ target_exam: 'CLASS_10' })).toBeNull();
    expect(buildExamType('CLASS_10', 'CBSE', '10')).toBe('CBSE Class 10');
    // 'Class 8-9' never existed as a CATEGORIES key.
    expect(normalizeExamType('CLASS_8_9')).toBe('Class 9');
  });
});

describe('isRelevantToStudent', () => {
  const neetStudent   = { target_exam: 'NEET', syllabus: 'CBSE',         class_level: '12' };
  const boardStudent  = { target_exam: 'NONE', syllabus: 'CBSE',         class_level: '10' };
  const keralaStudent = { target_exam: 'NONE', syllabus: 'KERALA_STATE', class_level: '10' };

  it('matches a competitive student on BOTH their contexts', () => {
    expect(isRelevantToStudent('NEET', neetStudent)).toBe(true);
    expect(isRelevantToStudent('CBSE Class 12', neetStudent)).toBe(true);
    expect(isRelevantToStudent('CBSE Class 9', neetStudent)).toBe(false);
  });

  it('does not show competitive content to a board-only student', () => {
    expect(isRelevantToStudent('NEET', boardStudent)).toBe(false);
    expect(isRelevantToStudent('CBSE Class 10', boardStudent)).toBe(true);
  });

  it('matches Kerala State content to a Kerala State student', () => {
    // Compared 'Kerala State' === 'KERALA_STATE' before, so this was false and
    // those students saw none of their own board content.
    expect(isRelevantToStudent('Kerala State Class 10', keralaStudent)).toBe(true);
    expect(isRelevantToStudent('CBSE Class 10', keralaStudent)).toBe(false);
  });
});

describe('exam tags', () => {
  it('recognises every board in BOARDS, not just a hardcoded few', () => {
    expect(isExamTag('cbse_class_8')).toBe(true);
    expect(isExamTag('kerala_state_class_10')).toBe(true);  // was false
    expect(isExamTag('neet')).toBe(true);
    expect(isExamTag('jee_main')).toBe(true);
  });

  it('does not treat an ordinary chapter tag as an exam tag', () => {
    expect(isExamTag('Wit and Wisdom')).toBe(false);
    expect(isExamTag('')).toBe(false);
  });

  it('pretty-prints board tags with correct casing', () => {
    expect(prettyExamTag('cbse_class_8')).toBe('CBSE Class 8');
    expect(prettyExamTag('kerala_state_class_10')).toBe('Kerala State Class 10');
    expect(prettyExamTag('neet')).toBe('NEET');
  });
});
