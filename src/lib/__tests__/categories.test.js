import { describe, it, expect } from 'vitest';
import {
  CATEGORIES,
  EXAM_TYPE_GROUPS,
  BOARDS,
  CLASS_LEVELS,
  getSubjectsForExam,
  getAllExamTypes,
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
