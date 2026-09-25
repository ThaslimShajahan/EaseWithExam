import { describe, it, expect } from 'vitest';
import { boardLabel, examLabel, studentDisplayName } from '../displayLabels';

describe('boardLabel', () => {
  it('uses the onboarding catalogue titles', () => {
    expect(boardLabel('KERALA_STATE')).toBe('Kerala State');
    expect(boardLabel('CBSE')).toBe('CBSE');
  });
  it('humanises unknown keys instead of showing them raw; acronyms stay', () => {
    expect(boardLabel('TAMIL_NADU_STATE')).toBe('Tamil Nadu State');
    expect(boardLabel('ICSE')).toBe('ICSE');
  });
  it('empty for no board', () => {
    expect(boardLabel(null)).toBe('');
    expect(boardLabel('')).toBe('');
  });
});

describe('examLabel', () => {
  it('uses catalogue titles', () => {
    expect(examLabel('JEE_ADVANCED')).toBe('JEE Advanced');
    expect(examLabel('NEET')).toBe('NEET UG');
  });
});

describe('studentDisplayName: name → mobile → email → "Unnamed student"', () => {
  it('prefers the name', () => {
    expect(studentDisplayName({ name: 'Asha', phone_number: '+91980', email: 'a@b.c' })).toBe('Asha');
  });
  it('phone signup without a name → full mobile number', () => {
    expect(studentDisplayName({ name: '  ', phone_number: '+919812345678', email: null })).toBe('+919812345678');
  });
  it('Google signup without a name → email', () => {
    expect(studentDisplayName({ name: null, phone_number: '', email: 'student@example.com' })).toBe('student@example.com');
  });
  it('nothing at all → Unnamed student', () => {
    expect(studentDisplayName({})).toBe('Unnamed student');
    expect(studentDisplayName(null)).toBe('Unnamed student');
  });
});
