/**
 * Which exam_type values a logical exam should READ content from.
 *
 * WHY THIS EXISTS
 * NEET's syllabus IS Class 11 + 12 Physics, Chemistry and Biology, and the
 * corpus is loaded under exam_type 'CBSE Class 11' — the right content, tagged
 * for a different exam. Everything joins on exam_type, so a NEET query would
 * otherwise see none of it: Blueprint V2 would compute a NEET allocation with no
 * NEET knowledge base behind it, and type-filtered retrieval would return
 * nothing at all.
 *
 * WHY NOT JUST RE-TAG THE CORPUS AS NEET
 * Because SUBJECT is what separates NEET from JEE, and it does it for free.
 * NEET is Physics/Chemistry/Biology; JEE is Physics/Chemistry/Mathematics.
 * Every retrieval filters subject as well as exam_type, so one Class 11 corpus
 * serves both — Class 11 Mathematics never reaches NEET, Biology never reaches
 * JEE. Re-tagging Phy/Chem/Bio as NEET would leave JEE with nothing, strand
 * Class 11 Mathematics, and destroy the CBSE Class 11 identity for board users.
 *
 * SCOPE — READ SIDE ONLY
 * This widens what a query can SEE. It must never be used when WRITING: a NEET
 * PYQ is stored with exam_type 'NEET', full stop. Nothing here re-tags a row.
 * Correspondingly, syllabus_nodes / pyq_questions / topic_frequency /
 * chapter_pattern_stats are NOT routed through this — NEET owns its own rows in
 * all of those.
 *
 * The one-exam-resolves-to-several pattern already exists in this codebase:
 * examTypeCandidates() in syllabus.js does it for 'CBSE Class 10' -> 'CBSE'.
 *
 * Deliberately dependency-free — supabase.js imports this, and putting it in
 * syllabus.js (which imports supabase.js) would close an import cycle.
 */

/**
 * Corpus an exam draws on beyond its own tag. Class 12 is listed even though
 * NOTHING is loaded under it yet: an empty extra filter value costs nothing, and
 * this is the single place that has to change when Class 12 lands.
 */
const CORPUS_FALLBACK = {
  'NEET':         ['CBSE Class 11', 'CBSE Class 12'],
  'JEE Main':     ['CBSE Class 11', 'CBSE Class 12'],
  'JEE Advanced': ['CBSE Class 11', 'CBSE Class 12'],
};

/**
 * Returns the exam_type values a read should match, or null for "no filter".
 *
 * Always includes examType itself first, so NEET-tagged content (a NEET PYQ
 * promoted into the knowledge base, say) still wins on its own tag.
 *
 * @param   {string|null|undefined} examType
 * @returns {string[]|null}
 */
export function examTypesFor(examType) {
  if (!examType) return null;               // null = don't filter, matches the RPC
  const extra = CORPUS_FALLBACK[examType];
  return extra ? [examType, ...extra] : [examType];
}

/** True when this exam reads from another exam's corpus — useful for logging
 *  a retrieval that succeeded only because of the widening. */
export function borrowsCorpus(examType) {
  return Boolean(examType && CORPUS_FALLBACK[examType]);
}
