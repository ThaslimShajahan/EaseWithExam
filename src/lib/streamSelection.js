/**
 * Class 11/12 stream & subject selection — pure logic, no React, so the two
 * rules the owner explicitly flagged as "must be real code, not a note" have
 * a direct test proving them:
 *
 *   1. The optional-6th pool must exclude whatever was already picked in the
 *      stream's choice_slots, at render time. A stored config cannot know
 *      that (see stream_configs.optional_slots' column comment,
 *      20260813040000) — this is where that filtering actually happens.
 *   2. Kerala Commerce/Humanities' named_combinations are empty by design
 *      (no fabricated block names). The confirm screen must render a defined
 *      "no name" state — the resolved subjects plainly, no badge, no
 *      placeholder — never crash and never show an invented name.
 *
 * Every function here reads stream_configs / board_language_config DATA; none
 * of them ever compare a board_key against a literal string like 'CBSE' or
 * 'Kerala State'. That is the whole point of the unified shape (see
 * 20260813040000's header comment) — a third board fits by adding rows, not
 * by touching this file.
 */

/** '11' or '12' -> '11-12'. Anything else -> null, meaning "no stream step
 *  for this class" — Classes 8-10 fall out here, not via a board/class
 *  special-case elsewhere. */
export function classTierFor(classLevel) {
  return classLevel === '11' || classLevel === '12' ? '11-12' : null;
}

/** Whether the stream step applies at all, purely from what data exists for
 *  this board+tier — never from a hardcoded board list. A board with no
 *  stream_configs rows for this tier (e.g. ICSE, State Board today) simply
 *  doesn't trigger the step, no code change needed when that data arrives. */
export function hasStreamsFor(streamConfigs, boardKey, classLevel) {
  const tier = classTierFor(classLevel);
  if (!tier) return false;
  return streamConfigs.some((s) => s.board_key === boardKey && s.class_tier === tier);
}

/** Kerala shape (choice_language_slot present) vs CBSE shape (null) — the UI
 *  branches on THIS, never on board_key. */
export function needsLanguageChoice(boardLanguageConfig) {
  return boardLanguageConfig?.choice_language_slot != null;
}

/** A choice slot where the pool size equals the pick count has nothing left
 *  to choose — CBSE Commerce's 4-of-4 core is the real example. The UI must
 *  auto-select and skip the tap-through, not render a no-op multi-select. */
export function isAutoSelectAll(slot) {
  return Array.isArray(slot?.choose_from) && slot.choose_from.length === slot.count;
}

/**
 * THE FIRST EXPLICIT REQUIREMENT. Excludes subjects already picked in any
 * choice_slots selection from the optional-6th pool, so e.g. a Humanities
 * student who picked Psychology as one of their 4 core subjects does not
 * also see Psychology offered as the optional 6th — they are the same
 * subject, and picking it twice would double-count nothing but confuse the
 * student into thinking it's two different choices.
 */
export function availableOptionalSubjects(streamConfig, chosenSlotSubjects) {
  const chosen = new Set(chosenSlotSubjects ?? []);
  const pool = streamConfig?.optional_slots?.[0]?.choose_from ?? [];
  return pool.filter((subject) => !chosen.has(subject));
}

/**
 * THE SECOND EXPLICIT REQUIREMENT. If the resolved (mandatory + chosen)
 * subject set for this stream exactly matches a named_combinations entry,
 * return that name for a badge. Kerala Commerce/Humanities have an empty
 * named_combinations array by design (see 20260813040000's column comment —
 * no fabricated DHSE block names), so this correctly returns null for them,
 * every time, rather than guessing or erroring on an empty array.
 */
export function matchedCombinationName(streamConfig, chosenSlotSubjects) {
  const combos = streamConfig?.named_combinations ?? [];
  if (!combos.length) return null;
  const resolved = new Set([...(streamConfig.stream_mandatory ?? []), ...(chosenSlotSubjects ?? [])]);
  const hit = combos.find((c) => {
    const want = c.resulting_subjects ?? [];
    return want.length === resolved.size && want.every((s) => resolved.has(s));
  });
  return hit?.name ?? null;
}

/**
 * The final flat subject list — languages + stream_mandatory + chosen slot
 * subjects + the optional 6th if the student took it. This is what gets
 * written to users.subjects (see 20260813050000's column comment: nothing
 * reads it yet, Phase 4 wires readers to prefer it over the board-level
 * lookup). Order is deterministic: languages first, then locked subjects,
 * then choices, then the optional pick last — matches how the confirm screen
 * presents them.
 */
export function flattenSubjects({ boardLanguageConfig, languageChoice, streamConfig, chosenSlotSubjects, optional6th }) {
  const languages = [
    ...(boardLanguageConfig?.mandatory_languages ?? []),
    ...(languageChoice ? [languageChoice] : []),
  ];
  return [
    ...languages,
    ...(streamConfig?.stream_mandatory ?? []),
    ...(chosenSlotSubjects ?? []),
    ...(optional6th ? [optional6th] : []),
  ];
}

/** The structured record saved to users.academic_track. */
export function buildAcademicTrack({ boardKey, streamKey, languageChoice, chosenSlotSubjects, optional6th }) {
  const track = {
    board: boardKey,
    stream: streamKey,
    chosen_slot_subjects: chosenSlotSubjects ?? [],
  };
  if (languageChoice) track.language_choice = languageChoice;
  if (optional6th) track.optional_6th = optional6th;
  return track;
}
