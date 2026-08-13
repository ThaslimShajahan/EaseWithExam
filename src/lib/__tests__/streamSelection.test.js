import { describe, it, expect } from 'vitest';
import {
  classTierFor, hasStreamsFor, needsLanguageChoice, isAutoSelectAll,
  availableOptionalSubjects, matchedCombinationName, flattenSubjects, buildAcademicTrack,
} from '../streamSelection';

/* Fixtures are the ACTUAL rows verified live in 20260813040000/stream_configs
 * seeding (see docs/REBUILD_HANDOFF.md s12), not invented shapes. */

// Physics/Chemistry moved to stream_mandatory on owner instruction after
// Phase 2 shipped (real-world CBSE Science policy: these two are compulsory
// at most schools, unlike Commerce/Humanities' genuinely free pool) — the
// choice slot shrank from "pick 4 of 5" to "pick 2 of the remaining 3" so
// the total non-language subject count stays 4.
const cbseScience = {
  board_key: 'CBSE', class_tier: '11-12', stream_key: 'science',
  stream_mandatory: ['Physics', 'Chemistry'],
  choice_slots: [{ slot_key: 'elective', count: 2, choose_from: ['Mathematics', 'Biology', 'Computer Science'] }],
  optional_slots: [{ slot_key: 'sixth', count: 1, choose_from: ['Physical Education', 'Fine Arts', 'Informatics Practices', 'Legal Studies', 'Psychology', 'Home Science'] }],
  named_combinations: [],
};
const cbseCommerce = {
  board_key: 'CBSE', class_tier: '11-12', stream_key: 'commerce',
  stream_mandatory: [],
  choice_slots: [{ slot_key: 'core4', count: 4, choose_from: ['Accountancy', 'Business Studies', 'Economics', 'Applied Mathematics'] }],
  optional_slots: [{ slot_key: 'sixth', count: 1, choose_from: ['Physical Education', 'Fine Arts', 'Informatics Practices', 'Legal Studies', 'Psychology', 'Home Science'] }],
  named_combinations: [],
};
const cbseHumanities = {
  board_key: 'CBSE', class_tier: '11-12', stream_key: 'humanities',
  stream_mandatory: [],
  choice_slots: [{ slot_key: 'core4', count: 4, choose_from: ['History', 'Political Science', 'Geography', 'Sociology', 'Psychology', 'Economics'] }],
  optional_slots: [{ slot_key: 'sixth', count: 1, choose_from: ['Physical Education', 'Fine Arts', 'Informatics Practices', 'Legal Studies', 'Psychology', 'Home Science'] }],
  named_combinations: [],
};
const keralaScience = {
  board_key: 'Kerala State', class_tier: '11-12', stream_key: 'science',
  stream_mandatory: ['Physics', 'Chemistry', 'Mathematics'],
  choice_slots: [{ slot_key: 'course_code', count: 1, choose_from: ['Biology', 'Computer Science'] }],
  optional_slots: [],
  named_combinations: [
    { name: 'Course Code 1', resulting_subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'] },
    { name: 'Course Code 5', resulting_subjects: ['Physics', 'Chemistry', 'Mathematics', 'Computer Science'] },
  ],
};
const keralaCommerce = {
  board_key: 'Kerala State', class_tier: '11-12', stream_key: 'commerce',
  stream_mandatory: ['Business Studies', 'Accountancy', 'Economics'],
  choice_slots: [{ slot_key: 'elective', count: 1, choose_from: ['Computer Applications', 'Mathematics', 'Statistics', 'Political Science'] }],
  optional_slots: [],
  named_combinations: [],
};
const allConfigs = [cbseScience, cbseCommerce, cbseHumanities, keralaScience, keralaCommerce];

const cbseLang = { board_key: 'CBSE', mandatory_languages: ['English Core'], choice_language_slot: null };
const keralaLang = { board_key: 'Kerala State', mandatory_languages: ['English'], choice_language_slot: { slot_key: 'second_language', count: 1, choose_from: ['Malayalam', 'Hindi', 'Arabic', 'Urdu', 'Sanskrit', 'Syriac'] } };

describe('classTierFor / hasStreamsFor — Classes 8-10 must never trigger the step', () => {
  it('11 and 12 map to the 11-12 tier', () => {
    expect(classTierFor('11')).toBe('11-12');
    expect(classTierFor('12')).toBe('11-12');
  });
  it('8, 9, 10 map to null — no stream step, ever', () => {
    expect(classTierFor('8')).toBeNull();
    expect(classTierFor('9')).toBeNull();
    expect(classTierFor('10')).toBeNull();
  });
  it('hasStreamsFor is purely data-driven, not a board-name check', () => {
    expect(hasStreamsFor(allConfigs, 'CBSE', '11')).toBe(true);
    expect(hasStreamsFor(allConfigs, 'CBSE', '8')).toBe(false);
    expect(hasStreamsFor(allConfigs, 'ICSE', '11')).toBe(false); // no rows seeded for ICSE yet
  });
});

describe('needsLanguageChoice — branches on data, not board_key', () => {
  it('CBSE: no second-language choice', () => { expect(needsLanguageChoice(cbseLang)).toBe(false); });
  it('Kerala: has a second-language choice', () => { expect(needsLanguageChoice(keralaLang)).toBe(true); });
});

describe('CBSE Science: Physics/Chemistry are locked, not pool options', () => {
  it('stream_mandatory contains exactly Physics and Chemistry', () => {
    expect(cbseScience.stream_mandatory).toEqual(['Physics', 'Chemistry']);
  });
  it('the choice pool no longer offers Physics or Chemistry as a pick', () => {
    expect(cbseScience.choice_slots[0].choose_from).not.toContain('Physics');
    expect(cbseScience.choice_slots[0].choose_from).not.toContain('Chemistry');
  });
  it('the choice slot shrank to 2 (locking 2 subjects out of 4 leaves 2 more to pick)', () => {
    expect(cbseScience.choice_slots[0].count).toBe(2);
  });
});

describe('isAutoSelectAll — CBSE Commerce is the real 4-of-4 case', () => {
  it('Commerce pool size equals count: auto-select', () => {
    expect(isAutoSelectAll(cbseCommerce.choice_slots[0])).toBe(true);
  });
  it('Science pool is larger than count: real choice required', () => {
    expect(isAutoSelectAll(cbseScience.choice_slots[0])).toBe(false);
  });
});

describe('availableOptionalSubjects — REQUIREMENT: exclude already-chosen subjects', () => {
  it('Psychology picked as a Humanities core subject does not also appear as the optional 6th', () => {
    const available = availableOptionalSubjects(cbseHumanities, ['History', 'Political Science', 'Geography', 'Psychology']);
    expect(available).not.toContain('Psychology');
    expect(available).toEqual(['Physical Education', 'Fine Arts', 'Informatics Practices', 'Legal Studies', 'Home Science']);
  });
  it('a Science student who did not pick Psychology still sees it as an optional-6th option', () => {
    const available = availableOptionalSubjects(cbseScience, ['Mathematics', 'Biology']);
    expect(available).toContain('Psychology');
  });
  it('Kerala streams have no optional pool at all', () => {
    expect(availableOptionalSubjects(keralaScience, ['Biology'])).toEqual([]);
  });
});

describe('matchedCombinationName — REQUIREMENT: empty named_combinations never crashes, never invents a name', () => {
  it('Kerala Science: a real match returns its name', () => {
    expect(matchedCombinationName(keralaScience, ['Biology'])).toBe('Course Code 1');
    expect(matchedCombinationName(keralaScience, ['Computer Science'])).toBe('Course Code 5');
  });
  it('Kerala Commerce: empty named_combinations returns null, not a crash or invented name', () => {
    expect(matchedCombinationName(keralaCommerce, ['Mathematics'])).toBeNull();
  });
  it('CBSE streams also have empty named_combinations today: null, not a badge', () => {
    expect(matchedCombinationName(cbseScience, ['Mathematics', 'Biology'])).toBeNull();
  });
});

describe('flattenSubjects — the resolved list, in the order the confirm screen presents it', () => {
  it('CBSE Science, no optional 6th taken — Physics/Chemistry come from stream_mandatory, not chosenSlotSubjects', () => {
    expect(flattenSubjects({
      boardLanguageConfig: cbseLang, languageChoice: null, streamConfig: cbseScience,
      chosenSlotSubjects: ['Mathematics', 'Biology'], optional6th: null,
    })).toEqual(['English Core', 'Physics', 'Chemistry', 'Mathematics', 'Biology']);
  });
  it('CBSE Science WITH the optional 6th', () => {
    expect(flattenSubjects({
      boardLanguageConfig: cbseLang, languageChoice: null, streamConfig: cbseScience,
      chosenSlotSubjects: ['Mathematics', 'Biology'], optional6th: 'Psychology',
    })).toEqual(['English Core', 'Physics', 'Chemistry', 'Mathematics', 'Biology', 'Psychology']);
  });
  it('Kerala Science: two languages + three locked + one chosen, no optional slot', () => {
    expect(flattenSubjects({
      boardLanguageConfig: keralaLang, languageChoice: 'Malayalam', streamConfig: keralaScience,
      chosenSlotSubjects: ['Biology'], optional6th: null,
    })).toEqual(['English', 'Malayalam', 'Physics', 'Chemistry', 'Mathematics', 'Biology']);
  });
});

describe('buildAcademicTrack — omits optional keys rather than storing them as null', () => {
  it('CBSE: no language_choice key at all (CBSE has none)', () => {
    const track = buildAcademicTrack({ boardKey: 'CBSE', streamKey: 'science', languageChoice: null, chosenSlotSubjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'], optional6th: null });
    expect(track).toEqual({ board: 'CBSE', stream: 'science', chosen_slot_subjects: ['Physics', 'Chemistry', 'Mathematics', 'Biology'] });
    expect('language_choice' in track).toBe(false);
    expect('optional_6th' in track).toBe(false);
  });
  it('Kerala: language_choice present, optional_6th absent (Kerala has no optional slot)', () => {
    const track = buildAcademicTrack({ boardKey: 'Kerala State', streamKey: 'science', languageChoice: 'Malayalam', chosenSlotSubjects: ['Biology'], optional6th: null });
    expect(track.language_choice).toBe('Malayalam');
    expect('optional_6th' in track).toBe(false);
  });
  it('CBSE with the optional 6th taken', () => {
    const track = buildAcademicTrack({ boardKey: 'CBSE', streamKey: 'humanities', languageChoice: null, chosenSlotSubjects: ['History', 'Political Science', 'Geography', 'Sociology'], optional6th: 'Legal Studies' });
    expect(track.optional_6th).toBe('Legal Studies');
  });
});
