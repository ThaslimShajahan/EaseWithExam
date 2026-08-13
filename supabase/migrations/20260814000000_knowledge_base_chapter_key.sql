-- Content-engine rebuild, Phase 2 slice, task 1 of 4
-- (docs/REBUILD_HANDOFF.md — Phase 2 scoping approved 2026-08-14).
--
-- Adds the column the ordinal-anchored identity system (Phase 1,
-- src/lib/chapterIdentity.js) actually writes to. Phase 1 built the engine and
-- the chapter_manifests table; nothing in knowledge_base could hold the result
-- yet. `chapter` (text) stays untouched as the human-readable label — a chunk
-- keeps both: chapter_key is identity, chapter is the manifest entry's title
-- (or an alias, see chapterIdentity.js:aliasFor), same split as
-- chapter_manifests.entries[].title vs .ordinal.
--
-- Nullable and additive: every existing row (there are 0 post-wipe, but the
-- column must not assume that) keeps working with chapter_key = null, meaning
-- "written before this system existed" — not "unknown", a real distinction
-- worth preserving rather than backfilling with a guess.
--
-- No FK to chapter_manifests, deliberately. Identity is DERIVED from an
-- approved manifest at write time (decideAssignments + chapterKeyFor), not
-- live-joined to one afterward — matches the "closed-set selection, not open
-- reference" design. A manifest can be superseded (chapter_manifests' own
-- partial-unique-index behaviour) without invalidating chapter_keys already
-- written from an earlier approved version of it.

alter table public.knowledge_base
  add column if not exists chapter_key text;

comment on column public.knowledge_base.chapter_key is
  'Ordinal-anchored, book-scoped chapter identity (chapterKeyFor(), e.g. '
  'c11_hornbill_ch07) — see src/lib/chapterIdentity.js. NULL for rows written '
  'before this system existed. Distinct from `chapter` (text label, mutable, '
  'may carry an alias) — chapter_key is identity, chapter is display. See '
  'docs/REBUILD_HANDOFF.md Phase 2.';

-- Chapter-scoped reads (Study Notes browsing, PYQ resolution once that phase
-- lands) will filter by (exam_type, subject, chapter_key) the same way
-- syllabus_nodes' own unique index is shaped — index it now rather than
-- discover the need under load later.
create index if not exists kb_exam_subject_chapter_key_idx
  on public.knowledge_base (exam_type, subject, chapter_key)
  where chapter_key is not null;
