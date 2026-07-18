-- Run in: Supabase Dashboard → SQL Editor
-- The SQL Editor runs as the database owner, which bypasses the RLS policy
-- that was silently blocking the app's "Clear All Data" button from
-- deleting exam_blueprints (anon key) -- direct SQL doesn't have that problem.

-- ── Content tables — safe, matches what "Clear All Data" already does ──
DELETE FROM exam_blueprints;   -- the one still stuck at 6 rows
DELETE FROM knowledge_base;
DELETE FROM question_cache;
DELETE FROM pyq_questions;
DELETE FROM published_tests;
DELETE FROM topic_frequency;
DELETE FROM question_papers;
DELETE FROM study_notes;

-- ── Syllabus structure — NOT included above on purpose ──────────────────
-- This is why Syllabus and Content Map still show subjects/chapters: that's
-- your board/class/subject/chapter structure (937 rows), not uploaded
-- content. You confirmed earlier you wanted this KEPT. Only uncomment the
-- line below if you actually want to wipe it too — you'd then need to
-- rebuild every board/class/subject/chapter from scratch (or use the
-- Fetch/AI auto-fill in Admin > Syllabus again) before Paper Gen,
-- Flashcards, Practice, etc. have anything to work with.

-- DELETE FROM syllabus_nodes;
