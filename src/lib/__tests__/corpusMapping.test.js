/**
 * Stage B: corpus file -> book resolution.
 *
 * Both halves. The workbook case is the one with a real failure mode, so it is
 * asserted from both directions: that Words and Expressions reaches First
 * Flight's chapters, AND that it does not acquire chapter rows of its own or
 * silently collapse the chapter-3 split.
 */
import { describe, it, expect } from 'vitest';
import { resolveCorpusFile, workbookUnitFor, FIRST_FLIGHT_UNITS, BOOKS } from '../corpusMapping';

describe('book resolution', () => {
  it.each([
    ['11 NCRT SC/ENGLISH HORN BILL/kehb101.pdf',        'English',          'Hornbill'],
    ['11 NCRT SC/ENGLISH WOOVEN WORDS/keww101.pdf',     'English',          'Woven Words'],
    ['11 NCRT SC/POLITICAL SCIENCE POLITICAL THEORY/keps101.pdf',    'Political Science', 'Political Theory'],
    ['11 NCRT SC/POLITICAL SCIENCE INDIAN CONSTITUTION AT WORK/keps201.pdf', 'Political Science', 'Constitution at Work'],
    ['11 NCRT SC/SOCIOLOGY/kesy101.pdf',                'Sociology',        'Introducing Sociology'],
    ['11 NCRT SC/SOCIOLOGY UNDERSTANDING SOCIETY/kesy201.pdf', 'Sociology', 'Understanding Society'],
    ['10 NCRT/10 social/HISTORY/jess301.pdf',           'Social Science',   'India and the Contemporary World II'],
    ['NCRT 8/NCRT CLASS 8 SOCIAL/PART 1.pdf',           'Social Science',   'Exploring Society: India and Beyond'],
  ])('%s -> %s / %s', (path, subject, book) => {
    const r = resolveCorpusFile(path);
    expect(r.subject).toBe(subject);
    expect(r.book).toBe(book);
  });

  it('accepts Windows separators', () => {
    expect(resolveCorpusFile('11 NCRT SC\\ENGLISH HORN BILL\\kehb101.pdf').book).toBe('Hornbill');
  });

  /* The two Sociology folders are the ordering trap: "SOCIOLOGY" is a substring
   * of "SOCIOLOGY UNDERSTANDING SOCIETY". Anchored so neither depends on which
   * entry is listed first. */
  it('does not let the shorter Sociology pattern swallow the longer folder', () => {
    expect(resolveCorpusFile('11 NCRT SC/SOCIOLOGY UNDERSTANDING SOCIETY/kesy201.pdf').book)
      .toBe('Understanding Society');
  });

  /* Verified in Stage B from the contents page: Part I is chapters 1-7 ending
   * page 268, Part II is 8-9 starting page 277. Continuous on both counts, so
   * this is the chemistry part1/part2 case and NOT a separate book. */
  it('collapses Accountancy Part I and II to one unlabelled book', () => {
    const p1 = resolveCorpusFile('11 NCRT SC/ACCOUNTANCY/ACC Chapter 01 Introduction to Accounting.pdf');
    const p2 = resolveCorpusFile('11 NCRT SC/accountancy ii/keac201.pdf');
    expect(p1.subject).toBe('Accountancy');
    expect(p2.subject).toBe('Accountancy');
    expect(p1.book).toBeNull();
    expect(p2.book).toBeNull();
  });

  /* Only Fundamentals of Physical Geography is present; India: Physical
   * Environment is absent. Labelling the present book now avoids rewriting
   * chapter_keys — which flashcards and the syllabus tracker point at — when the
   * second book eventually arrives. */
  it('labels Class 11 Geography even though its sibling book is absent', () => {
    expect(resolveCorpusFile('11 NCRT SC/GEOGRAPHY/kegy201.pdf').book)
      .toBe('Fundamentals of Physical Geography');
  });

  it('returns null for STEM and for the deferred Hindi books', () => {
    expect(resolveCorpusFile('11 NCRT SC/PHYSICS 1/keph101.pdf')).toBeNull();
    expect(resolveCorpusFile('10 NCRT/10 maths/jemh101.pdf')).toBeNull();
    expect(resolveCorpusFile('10 NCRT/10 HINDI A/KSHITIJ 2/jhks101.pdf')).toBeNull();
    expect(resolveCorpusFile('11 NCRT SC/HINDI AROH/khar101.pdf')).toBeNull();
  });
});

describe('Words and Expressions II attaches to First Flight', () => {
  const WB = '10 NCRT/ENGLISH/10 ENGLISH word and expression ii/jewe203.pdf';

  it('resolves to First Flight, not to a book of its own', () => {
    const r = resolveCorpusFile(WB);
    expect(r.subject).toBe('English');
    expect(r.book).toBe('First Flight');
    expect(r.attachesTo).toBe('First Flight');
  });

  it('forces content_type to exercise', () => {
    expect(resolveCorpusFile(WB).contentTypeOverride).toBe('exercise');
  });

  /* The half that says why this design was chosen. Option 1 was to give the
   * workbook its own rows; it was rejected because it shows the student every
   * Class 10 English title twice. Assert no entry claims a distinct book. */
  it('creates no second set of Class 10 English chapter names', () => {
    const c10english = BOOKS.filter((b) => b.examType === 'CBSE Class 10' && b.subject === 'English');
    const books = [...new Set(c10english.map((b) => b.book))];
    expect(books.sort()).toEqual(['First Flight', 'Footprints Without Feet']);
    // 3 folders, 2 books — the workbook shares the reader's.
    expect(c10english).toHaveLength(3);
  });

  it('maps each workbook file to its reader unit by ordinal', () => {
    expect(workbookUnitFor('jewe201.pdf').unit).toBe('A Letter to God');
    expect(workbookUnitFor('jewe209.pdf').unit).toBe('The Proposal');
    // Two of the nine carry a stray extra dot in the corpus.
    expect(workbookUnitFor('jewe204..pdf').ordinal).toBe(4);
    expect(workbookUnitFor('jewe209..pdf').unit).toBe('The Proposal');
  });

  it('rejects an out-of-range or unnumbered file rather than guessing', () => {
    expect(workbookUnitFor('jewe2ps.pdf')).toBeNull();
    expect(workbookUnitFor('jewe299.pdf')).toBeNull();
    expect(workbookUnitFor('')).toBeNull();
  });

  /* THE CASE THE ORDINAL MAPPING EXISTS FOR.
   *
   * Unit 3 is one printed chapter ("Two Stories about Flying") that split into
   * two chapter rows. Title matching would have worked for the other eight and
   * failed silently here, and taking chapters[0] would file every Black
   * Aeroplane exercise under His First Flight. */
  it('hands unit 3 BOTH chapters rather than picking one', () => {
    const u3 = workbookUnitFor('jewe203.pdf');
    expect(u3.unit).toBe('Two Stories about Flying');
    expect(u3.chapters).toEqual(['His First Flight', 'Black Aeroplane']);
    expect(u3.chapters).toHaveLength(2);

    // Its printed unit title matches NEITHER chapter row — which is exactly why
    // matching on the title would have failed.
    expect(u3.chapters).not.toContain(u3.unit);
  });

  it('gives every other unit exactly one chapter', () => {
    const multi = FIRST_FLIGHT_UNITS.filter((u) => u.chapters.length > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0].unit).toBe('Two Stories about Flying');
    // 9 printed chapters, 10 chapter rows after the split.
    expect(FIRST_FLIGHT_UNITS).toHaveLength(9);
    expect(FIRST_FLIGHT_UNITS.flatMap((u) => u.chapters)).toHaveLength(10);
  });
});
