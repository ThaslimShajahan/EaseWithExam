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

/* ────────────────────────────────────────────────────────────────────────
 * Admin-editor validation (Phase 3).
 *
 * Lives here, not in the admin component, for the same reason the two rules
 * above do: a stored config that violates these is not a cosmetic problem,
 * it breaks the student flow at render time. Keeping them as pure functions
 * means the rules are testable without mounting a React tree, and the
 * onboarding reader and the admin writer are validating against exactly one
 * definition rather than two that can drift.
 *
 * The split between `errors` and `warnings` is deliberate and was specified:
 * a slot asking for more subjects than its pool can supply is unsatisfiable
 * and MUST block the save; a named_combination that doesn't line up with the
 * config is a data-entry smell that must WARN and still save — Kerala
 * Commerce/Humanities legitimately ship zero named combinations, and an admin
 * mid-edit may well save a combination before adding the subject it refers
 * to. Blocking there would make correct end states unreachable.
 * ──────────────────────────────────────────────────────────────────────── */

/** One choice/optional slot. Shared by both slot kinds — they have the same
 *  shape, they differ only in whether the student may skip them. */
function validateSlot(slot, index, kind) {
  const errors = [];
  const where = `${kind} slot ${index + 1}`;
  const pool = Array.isArray(slot?.choose_from) ? slot.choose_from : [];
  const count = Number(slot?.count);

  if (!slot?.slot_key?.trim()) errors.push(`${where}: slot key is required.`);
  if (!Number.isInteger(count) || count < 1) {
    errors.push(`${where}: pick count must be a whole number of at least 1.`);
  } else if (count > pool.length) {
    // The unsatisfiable case — the whole reason this validation exists.
    errors.push(`${where}: asks the student to pick ${count} but the pool only has ${pool.length}.`);
  }
  if (pool.length === 0) errors.push(`${where}: needs at least one subject in the pool.`);
  if (new Set(pool).size !== pool.length) errors.push(`${where}: the pool has duplicate subjects.`);

  return errors;
}

/**
 * Validates a stream_configs draft before it's sent to
 * admin_upsert_stream_config. Returns { errors, warnings } — save is blocked
 * only on `errors`.
 */
export function validateStreamConfigDraft(draft) {
  const errors = [];
  const warnings = [];

  if (!draft?.board_key?.trim()) errors.push('Board is required.');
  if (!draft?.label?.trim()) errors.push('Label is required.');
  if (!['science', 'commerce', 'humanities'].includes(draft?.stream_key)) {
    // Mirrors the RPC's own CHECK so the admin sees it as a field error
    // rather than as a raw 22023 from Postgres after a round trip.
    errors.push('Stream must be science, commerce or humanities.');
  }

  const mandatory = Array.isArray(draft?.stream_mandatory) ? draft.stream_mandatory : [];
  if (new Set(mandatory).size !== mandatory.length) errors.push('Locked subjects contain a duplicate.');

  const choiceSlots = Array.isArray(draft?.choice_slots) ? draft.choice_slots : [];
  if (choiceSlots.length === 0) errors.push('At least one choice slot is required.');
  choiceSlots.forEach((s, i) => errors.push(...validateSlot(s, i, 'Choice')));

  const optionalSlots = Array.isArray(draft?.optional_slots) ? draft.optional_slots : [];
  optionalSlots.forEach((s, i) => errors.push(...validateSlot(s, i, 'Optional')));

  // A subject that is both locked and choosable is contradictory: the student
  // would be offered a pick they already have.
  const lockedSet = new Set(mandatory);
  choiceSlots.forEach((s, i) => {
    const overlap = (s?.choose_from ?? []).filter((x) => lockedSet.has(x));
    if (overlap.length) {
      errors.push(`Choice slot ${i + 1}: ${overlap.join(', ')} ${overlap.length > 1 ? 'are' : 'is'} already a locked subject.`);
    }
  });

  // Warn-only, per the rule above.
  const combos = Array.isArray(draft?.named_combinations) ? draft.named_combinations : [];
  combos.forEach((c, i) => {
    const where = `Named combination ${i + 1}`;
    if (!c?.name?.trim()) { warnings.push(`${where}: has no name.`); return; }
    const resulting = Array.isArray(c?.resulting_subjects) ? c.resulting_subjects : [];
    if (resulting.length === 0) { warnings.push(`${where} ("${c.name}"): lists no subjects.`); return; }

    const missingLocked = mandatory.filter((m) => !resulting.includes(m));
    if (missingLocked.length) {
      warnings.push(`${where} ("${c.name}"): doesn't include locked subject${missingLocked.length > 1 ? 's' : ''} ${missingLocked.join(', ')}.`);
    }
    // Anything in the combination that is neither locked nor offered by any
    // slot can never be produced by a real student selection, so the badge
    // would never appear.
    const offered = new Set([
      ...mandatory,
      ...choiceSlots.flatMap((s) => s?.choose_from ?? []),
      ...optionalSlots.flatMap((s) => s?.choose_from ?? []),
    ]);
    const unreachable = resulting.filter((s) => !offered.has(s));
    if (unreachable.length) {
      warnings.push(`${where} ("${c.name}"): ${unreachable.join(', ')} ${unreachable.length > 1 ? 'are' : 'is'} not locked or in any pool — this combination can never match.`);
    }
  });

  return { errors, warnings };
}

/**
 * Validates a board_language_config draft. The nullable choice slot is the
 * point of care: CBSE stores null and MUST keep storing null (needsLanguageChoice
 * branches on exactly that), so "no choice" has to be representable rather
 * than coerced into an empty slot object.
 */
export function validateBoardLanguageDraft(draft) {
  const errors = [];
  const warnings = [];

  if (!draft?.board_key?.trim()) errors.push('Board is required.');

  const mandatory = Array.isArray(draft?.mandatory_languages) ? draft.mandatory_languages : [];
  if (mandatory.length === 0) warnings.push('No mandatory language — students on this board will be asked for none.');
  if (new Set(mandatory).size !== mandatory.length) errors.push('Mandatory languages contain a duplicate.');

  const slot = draft?.choice_language_slot;
  if (slot != null) {
    errors.push(...validateSlot(slot, 0, 'Language choice'));
    const overlap = (slot?.choose_from ?? []).filter((x) => mandatory.includes(x));
    if (overlap.length) {
      errors.push(`Language choice slot: ${overlap.join(', ')} ${overlap.length > 1 ? 'are' : 'is'} already mandatory.`);
    }
  }

  return { errors, warnings };
}
