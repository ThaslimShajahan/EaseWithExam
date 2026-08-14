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
    const scoped = board.length ? board.filter((s) => chosen.includes(s)) : chosen;

    // A non-empty selection that intersects to nothing means the profile and the
    // catalogue genuinely disagree (a board reorganisation, or a stale profile).
    // Treated as "needs setup" rather than silently showing everything: the
    // student's stated subjects cannot be served, and saying so is honest.
    if (!scoped.length) return { subjects: [], isScoped: false, needsSetup: true };

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
