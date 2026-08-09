import { describe, it, expect } from 'vitest';
import { matchSyllabusChapter } from '../contentExtraction';

const MATHS10 = [
  'Real Numbers', 'Polynomials', 'Pair of Linear Equations in Two Variables',
  'Quadratic Equations', 'Arithmetic Progressions', 'Triangles', 'Coordinate Geometry',
  'Introduction to Trigonometry', 'Some Applications of Trigonometry', 'Circles',
  'Areas Related to Circles', 'Surface Areas and Volumes', 'Statistics',
  'Probability — A Theoretical Approach',
];
const SCIENCE10 = [
  'Chemical Reactions and Equations', 'Acids, Bases and Salts', 'Metals and Non-metals',
  'Carbon and its Compounds', 'Life Processes', 'Control and Coordination',
  'How do Organisms Reproduce?', 'Heredity', 'Light – Reflection and Refraction',
  'The Human Eye and the Colourful World', 'Electricity',
  'Magnetic Effects of Electric Current', 'Our Environment',
];

describe('matchSyllabusChapter', () => {
  it('matches exactly', () => {
    expect(matchSyllabusChapter('Real Numbers', MATHS10)).toBe('Real Numbers');
  });

  it('matches on containment', () => {
    expect(matchSyllabusChapter('Circles', MATHS10)).toBe('Circles');
    expect(matchSyllabusChapter('Statistics', MATHS10)).toBe('Statistics');
  });

  // The measured near-misses that produced phantom chapters on real papers.
  it('recovers near-misses via token overlap', () => {
    expect(matchSyllabusChapter('Human Eye and Colourful World', SCIENCE10))
      .toBe('The Human Eye and the Colourful World');
    // "trigonometric" vs "trigonometry" — needs prefix matching, not stemming.
    expect(matchSyllabusChapter('Trigonometric Identities', MATHS10))
      .toBe('Introduction to Trigonometry');
    // Two shared tokens (organism + reproduc*) clears the threshold comfortably.
    expect(matchSyllabusChapter('Reproduction in Organisms', SCIENCE10))
      .toBe('How do Organisms Reproduce?');
  });

  // Documents a real limit rather than pretending it away. This IS a rename of
  // "How do Organisms Reproduce?", but with only one shared token it scores
  // 0.20 — below "Chemical Bonding" against "Chemical Reactions and Equations"
  // (0.25), which would be a genuinely wrong snap. No purely lexical rule
  // separates them, so the backstop declines both. The closed chapter list in
  // runPYQExtraction is what handles this class.
  it('leaves a rename it cannot distinguish from a wrong snap', () => {
    expect(matchSyllabusChapter('Human Reproduction', SCIENCE10)).toBe('Human Reproduction');
  });

  // A wrong snap is worse than no snap: it attributes a question to a chapter
  // it does not test, and that is invisible downstream.
  it('refuses to snap a chapter that genuinely is not in the list', () => {
    expect(matchSyllabusChapter('Simple Interest', MATHS10)).toBe('Simple Interest');
    expect(matchSyllabusChapter('Exponents and Powers', MATHS10)).toBe('Exponents and Powers');
    expect(matchSyllabusChapter('Chemical Bonding', SCIENCE10)).toBe('Chemical Bonding');
  });

  it('passes through when there is nothing to match against', () => {
    expect(matchSyllabusChapter('Anything', [])).toBe('Anything');
    expect(matchSyllabusChapter('', MATHS10)).toBe('');
    expect(matchSyllabusChapter(null, MATHS10)).toBeNull();
  });
});
