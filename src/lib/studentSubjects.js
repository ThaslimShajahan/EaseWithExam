/**
 * Which subjects a given student should actually see.
 *
 * Every student-facing subject picker used to show the whole board catalogue for
 * a class — so a CBSE Class 12 Science student was offered Accountancy,
 * Psychology and Political Science alongside their own five. Nothing read the
 * stream selection that onboarding captured; `academic_track` was referenced in
 * exactly zero files under src/pages and src/components.
 *
 * SOURCE OF TRUTH: `users.subjects`, the resolved list onboarding writes.
 * Deliberately NOT re-derived from stream_configs at read time. Onboarding
 * already combines stream_mandatory + the student's chosen slot subjects + their
 * language into that column; re-computing it here would be a second
 * implementation of the same rule, free to drift from what was actually saved.
 * A protection that exists on one path and not another is precisely the bug
 * class this codebase has already paid for once.
 *
 * The trade-off, stated because it is real: if an admin later edits a stream's
 * subjects, existing students keep the list captured at onboarding until they
 * change their selection. That is the correct default — a student's timetable
 * does not change because an admin edited a config — but it means stream_configs
 * edits are not retroactive.
 */

/** Classes where a stream selection exists at all. Below this, a board simply
 *  has one subject list and there is nothing for a student to choose. */
const STREAM_CLASSES = new Set(['11', '12']);

export const isStreamClass = (classLevel) => STREAM_CLASSES.has(String(classLevel ?? '').trim());

/**
 * @param {object}   args
 * @param {string[]} args.profileSubjects  users.subjects — the resolved selection
 * @param {string[]} args.boardSubjects    every subject the board offers this class
 * @param {string}   args.classLevel
 * @returns {{ subjects: string[], isScoped: boolean, needsSetup: boolean }}
 *
 *   isScoped   — the list is this student's own, not the whole catalogue
 *   needsSetup — the student SHOULD have a selection and does not; the caller
 *                must show the setup prompt rather than any subject list
 */
export function resolveStudentSubjects({ profileSubjects, boardSubjects, classLevel }) {
  const board  = (boardSubjects ?? []).filter(Boolean);
  const chosen = (profileSubjects ?? []).filter(Boolean);

  if (chosen.length) {
    // Intersect rather than trust the profile outright: a subject removed from
    // the board's catalogue must not linger on old profiles as a picker entry
    // with no content behind it. Board order is kept so the UI ordering is
    // stable and matches every other screen.
    //
    // If the board list has not loaded yet (empty), fall back to the profile's
    // own list rather than briefly rendering nothing — an empty picker that
    // fills in a moment later reads as a bug.
    // Board list not loaded yet: fall back to the profile's own list rather than
    // briefly rendering nothing. An empty picker that fills in a moment later
    // reads as a bug, and no comparison is meaningful against an empty board.
    if (!board.length) return { subjects: chosen, isScoped: true, needsSetup: false };

    const scoped  = board.filter((s) => chosen.includes(s));
    const missing = chosen.filter((s) => !board.includes(s));

    // ANY mismatch -> prompt. Not just a total mismatch.
    //
    // Owner decision, and the strict reading is deliberate: a partial match is
    // ambiguous, and resolving ambiguity by quietly serving the subset that
    // happens to line up is a best-effort guess dressed as an answer. A legacy
    // profile carrying 5 valid subjects and 1 the board no longer offers is
    // exactly the case — we cannot tell whether the 6th was dropped, renamed, or
    // is simply absent from a board list that has not finished being set up.
    //
    // The cost is real and worth stating: a student is blocked from the picker
    // until they re-select, even when only one subject fails to match. That is
    // acceptable because re-selecting is an action actually available to them
    // (11-12 have a stream selection), and because the alternative is a picker
    // that silently omits a subject they still study — a wrong answer with no
    // signal that anything is wrong.
    if (missing.length) return { subjects: [], isScoped: false, needsSetup: true };

    return { subjects: scoped, isScoped: true, needsSetup: false };
  }

  // No selection recorded. What that MEANS depends entirely on the class.
  if (isStreamClass(classLevel)) {
    // 11-12 without a selection: genuinely incomplete. Show the prompt, never a
    // catalogue that would look intentional but isn't (owner decision).
    return { subjects: [], isScoped: false, needsSetup: true };
  }

  // Classes 8-10 have no streams, so there is no selection to make and nothing
  // is missing. The board list IS this student's subject list — showing it is
  // correct, not a fallback, and prompting them to "complete" a step that does
  // not exist would be a dead end.
  return { subjects: board, isScoped: false, needsSetup: false };
}

/**
 * Same job as resolveStudentSubjects, but for a caller that may be asking on
 * behalf of a COMPETITIVE exam type (NEET, JEE Main, ...) rather than a
 * board/school one. Competitive exam types need a fundamentally different
 * rule, not just a different boardSubjects list:
 *
 * A competitive exam's subject list is FIXED by the exam itself — every NEET
 * student takes exactly Physics/Chemistry/Biology; there is no per-student
 * "selection" to validate, unlike a school stream. But profile.subjects holds
 * the student's SCHOOL stream list (onboarding combines stream_mandatory +
 * chosen electives there), which for a CBSE Class 12 Science student includes
 * English and Mathematics too. Running that broader school list through
 * resolveStudentSubjects' strict reconciliation against NEET's narrower fixed
 * catalog always finds English/Mathematics "missing" and always blocks —
 * for every student with a competitive target, not an edge case. Found
 * 2026-08-14 against the one real profile with subjects set in prod at the
 * time: target_exam 'BOTH' (-> competitive 'NEET'), subjects ['English',
 * 'Physics','Chemistry','Mathematics','Biology'] (== SCIENCE_12 in the test
 * file) — permanently needsSetup:true, with no self-service fix available
 * (Profile has no subject editor; SubjectSetupPrompt's link is a dead end).
 *
 * isCompetitive is supplied by the caller (lib/categories.js's getExamType)
 * rather than decided in here, so this file stays framework/DB-free and
 * unit-testable exactly like resolveStudentSubjects above.
 */
export function resolveStudentSubjectsForExam({ profileSubjects, boardSubjects, classLevel, isCompetitive }) {
  if (isCompetitive) {
    return { subjects: (boardSubjects ?? []).filter(Boolean), isScoped: true, needsSetup: false };
  }
  return resolveStudentSubjects({ profileSubjects, boardSubjects, classLevel });
}
