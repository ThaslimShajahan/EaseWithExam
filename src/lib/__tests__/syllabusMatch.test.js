import { describe, it, expect } from 'vitest';
import { matchSyllabusChapter, matchSyllabusChapterKeyed } from '../contentExtraction';

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

/* Phase 2 PYQ slice (docs/REBUILD_HANDOFF.md): matchSyllabusChapterKeyed()
 * shares the exact matching algorithm above (same fixtures, same measured
 * cases) but operates on real {key, name} rows and returns null — never the
 * raw guess — on no confident match, since PYQ's reject-per-question
 * behaviour needs to know a match genuinely failed. */
const MATHS10_KEYED = MATHS10.map((name, i) => ({ key: `c10_maths_ch${String(i + 1).padStart(2, '0')}`, name }));
const SCIENCE10_KEYED = SCIENCE10.map((name, i) => ({ key: `c10_science_ch${String(i + 1).padStart(2, '0')}`, name }));

describe('matchSyllabusChapterKeyed', () => {
  it('matches exactly and returns the real chapter_key alongside the name', () => {
    expect(matchSyllabusChapterKeyed('Real Numbers', MATHS10_KEYED))
      .toEqual({ key: 'c10_maths_ch01', name: 'Real Numbers' });
  });

  it('recovers the same near-misses as the unkeyed matcher, with the key attached', () => {
    expect(matchSyllabusChapterKeyed('Human Eye and Colourful World', SCIENCE10_KEYED))
      .toEqual({ key: 'c10_science_ch10', name: 'The Human Eye and the Colourful World' });
    expect(matchSyllabusChapterKeyed('Trigonometric Identities', MATHS10_KEYED))
      .toEqual({ key: 'c10_maths_ch08', name: 'Introduction to Trigonometry' });
  });

  // The behaviour that actually differs from matchSyllabusChapter: no
  // confident match returns null, not the raw guess — this is what lets the
  // PYQ save path reject the individual question instead of silently writing
  // an unconstrained chapter name.
  it('REJECT: returns null rather than the raw guess when nothing matches confidently', () => {
    expect(matchSyllabusChapterKeyed('Simple Interest', MATHS10_KEYED)).toBeNull();
    expect(matchSyllabusChapterKeyed('Chemical Bonding', SCIENCE10_KEYED)).toBeNull();
    expect(matchSyllabusChapterKeyed('Human Reproduction', SCIENCE10_KEYED)).toBeNull(); // same undistinguishable-rename case as above
  });

  it('REJECT: null/empty guess or empty chapter list, never throws', () => {
    expect(matchSyllabusChapterKeyed('Anything', [])).toBeNull();
    expect(matchSyllabusChapterKeyed('', MATHS10_KEYED)).toBeNull();
    expect(matchSyllabusChapterKeyed(null, MATHS10_KEYED)).toBeNull();
  });
});
