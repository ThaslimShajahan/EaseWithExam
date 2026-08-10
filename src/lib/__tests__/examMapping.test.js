import { describe, it, expect } from 'vitest';
import { examTypesFor, borrowsCorpus } from '../examMapping';

describe('examTypesFor', () => {
  it('returns null for a missing exam type, so the RPC treats it as no filter', () => {
    expect(examTypesFor(null)).toBeNull();
    expect(examTypesFor(undefined)).toBeNull();
    expect(examTypesFor('')).toBeNull();
  });

  it('leaves a board exam alone — CBSE Class 10 owns all its own content', () => {
    expect(examTypesFor('CBSE Class 10')).toEqual(['CBSE Class 10']);
    expect(examTypesFor('CBSE Class 11')).toEqual(['CBSE Class 11']);
  });

  it('widens NEET onto the Class 11+12 corpus, itself first', () => {
    expect(examTypesFor('NEET')).toEqual(['NEET', 'CBSE Class 11', 'CBSE Class 12']);
  });

  it('widens both JEE papers the same way', () => {
    expect(examTypesFor('JEE Main')).toEqual(['JEE Main', 'CBSE Class 11', 'CBSE Class 12']);
    expect(examTypesFor('JEE Advanced')).toEqual(['JEE Advanced', 'CBSE Class 11', 'CBSE Class 12']);
  });

  it('always lists the exam itself first, so its own tagged content ranks in', () => {
    for (const e of ['NEET', 'JEE Main', 'JEE Advanced', 'CBSE Class 10']) {
      expect(examTypesFor(e)[0]).toBe(e);
    }
  });

  it('is exact-match, not fuzzy — an unknown exam is never silently widened', () => {
    expect(examTypesFor('neet')).toEqual(['neet']);
    expect(examTypesFor('NEET 2022')).toEqual(['NEET 2022']);
    expect(examTypesFor('Kerala State Class 10')).toEqual(['Kerala State Class 10']);
  });

  it('does not mutate the shared fallback list between calls', () => {
    const first = examTypesFor('NEET');
    first.push('MUTATED');
    expect(examTypesFor('NEET')).toEqual(['NEET', 'CBSE Class 11', 'CBSE Class 12']);
  });
});

describe('borrowsCorpus', () => {
  it('is true only for exams that read another exam_type', () => {
    expect(borrowsCorpus('NEET')).toBe(true);
    expect(borrowsCorpus('JEE Main')).toBe(true);
    expect(borrowsCorpus('CBSE Class 10')).toBe(false);
    expect(borrowsCorpus(null)).toBe(false);
  });
});
