-- ═══════════════════════════════════════════════════════════════════
-- Migration 0026 — Admin-editable exam categories (boards/classes/subjects)
-- Run this in: Supabase Dashboard → SQL Editor
--
-- Replaces the hardcoded CATEGORIES object in src/lib/categories.js as the
-- source of truth for which boards, classes, competitive exams, and subjects
-- exist across the whole app. Client reads this table directly (anon key,
-- same pattern as syllabus_nodes) -- only writes go through the admin RPCs.
--
-- Seeded below with every entry currently hardcoded in categories.js, so
-- nothing goes blank the moment this migration runs -- the new Admin >
-- Platform > Categories screen manages this table from here on.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS exam_categories (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_key       text NOT NULL UNIQUE,   -- e.g. 'NEET', 'CBSE Class 8', 'CBSE', 'Class 8'
  label          text NOT NULL,
  category_kind  text NOT NULL CHECK (category_kind IN ('competitive', 'board', 'class', 'board_class')),
  board_key      text,                   -- populated for 'board' / 'board_class' rows
  class_key      text,                   -- populated for 'class' / 'board_class' rows
  group_label    text,                   -- display group, e.g. 'Medical', 'CBSE', 'Kerala State'
  subjects       text[] NOT NULL DEFAULT '{}',
  sort_order     int NOT NULL DEFAULT 0,
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE exam_categories ENABLE ROW LEVEL SECURITY;

-- Public read of active rows only -- every part of the app (student
-- onboarding, Paper Gen, Syllabus Manager, Content Intake, etc.) reads this
-- directly with the anon key, no RPC needed.
CREATE POLICY exam_categories_public_read ON exam_categories
  FOR SELECT USING (is_active = true);

-- Writes are admin-only, via RPCs with the same caller-authorization check
-- every other admin_* RPC in this project uses.
REVOKE INSERT, UPDATE, DELETE ON exam_categories FROM anon, authenticated;

-- ── 1. List everything (admin management screen — includes inactive) ──
CREATE OR REPLACE FUNCTION admin_list_exam_categories(p_caller text)
RETURNS SETOF exam_categories
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT * FROM exam_categories ORDER BY category_kind, sort_order, label;
END;
$$;

-- ── 2. Create or update one entry ──────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_upsert_exam_category(
  p_caller       text,
  p_id           uuid,
  p_exam_key     text,
  p_label        text,
  p_category_kind text,
  p_board_key    text,
  p_class_key    text,
  p_group_label  text,
  p_subjects     text[],
  p_sort_order   int
) RETURNS exam_categories
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row exam_categories;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO exam_categories (exam_key, label, category_kind, board_key, class_key, group_label, subjects, sort_order)
    VALUES (p_exam_key, p_label, p_category_kind, p_board_key, p_class_key, p_group_label, COALESCE(p_subjects, '{}'), COALESCE(p_sort_order, 0))
    ON CONFLICT (exam_key) DO UPDATE SET
      label = EXCLUDED.label, category_kind = EXCLUDED.category_kind, board_key = EXCLUDED.board_key,
      class_key = EXCLUDED.class_key, group_label = EXCLUDED.group_label, subjects = EXCLUDED.subjects,
      sort_order = EXCLUDED.sort_order, is_active = true, updated_at = now()
    RETURNING * INTO v_row;
  ELSE
    UPDATE exam_categories SET
      exam_key = p_exam_key, label = p_label, category_kind = p_category_kind,
      board_key = p_board_key, class_key = p_class_key, group_label = p_group_label,
      subjects = COALESCE(p_subjects, '{}'), sort_order = COALESCE(p_sort_order, 0), updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  RETURN v_row;
END;
$$;

-- ── 3. Soft-delete (deactivate) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION admin_delete_exam_category(p_caller text, p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE exam_categories SET is_active = false, updated_at = now() WHERE id = p_id;
END;
$$;

-- ── Seed data — mirrors src/lib/categories.js CATEGORIES exactly ──────
INSERT INTO exam_categories (exam_key, label, category_kind, board_key, class_key, group_label, subjects, sort_order) VALUES
  ('NEET',         'NEET UG',       'competitive', NULL, NULL, 'Medical',     ARRAY['Physics','Chemistry','Biology'], 1),
  ('JEE Main',     'JEE Main',      'competitive', NULL, NULL, 'Engineering', ARRAY['Physics','Chemistry','Mathematics'], 2),
  ('JEE Advanced', 'JEE Adv.',      'competitive', NULL, NULL, 'Engineering', ARRAY['Physics','Chemistry','Mathematics'], 3),
  ('CUET',         'CUET',          'competitive', NULL, NULL, 'University',  ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','History','Political Science'], 4),
  ('UPSC',         'UPSC CSE',      'competitive', NULL, NULL, 'Government',  ARRAY['History','Geography','Polity','Economics','Science & Technology','Environment','Current Affairs'], 5),
  ('SSC CGL',      'SSC CGL',       'competitive', NULL, NULL, 'Government',  ARRAY['Quantitative Aptitude','English','General Awareness','Reasoning'], 6),
  ('Olympiad',     'Olympiad',      'competitive', NULL, NULL, 'Academic',    ARRAY['Physics','Chemistry','Biology','Mathematics','Astronomy'], 7),

  ('CBSE',         'CBSE Board',    'board', 'CBSE', NULL, 'National Board', ARRAY['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology','Computer Science'], 10),
  ('ICSE',         'ICSE',          'board', 'ICSE', NULL, 'National Board', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics','Geography','Computer Applications'], 11),
  ('State Board',  'State Board',   'board', 'State Board', NULL, 'State Board', ARRAY['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology'], 12),
  ('Kerala State', 'Kerala State',  'board', 'Kerala State', NULL, 'Kerala State', ARRAY['Mathematics','Science','English','Hindi','Social Studies','Physics','Chemistry','Biology'], 13),

  ('CBSE Class 6',  'CBSE Class 6',  'board_class', 'CBSE', '6',  'CBSE', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 20),
  ('CBSE Class 7',  'CBSE Class 7',  'board_class', 'CBSE', '7',  'CBSE', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 21),
  ('CBSE Class 8',  'CBSE Class 8',  'board_class', 'CBSE', '8',  'CBSE', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 22),
  ('CBSE Class 9',  'CBSE Class 9',  'board_class', 'CBSE', '9',  'CBSE', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 23),
  ('CBSE Class 10', 'CBSE Class 10', 'board_class', 'CBSE', '10', 'CBSE', ARRAY['Mathematics','Science','Social Studies','English','Hindi','Sanskrit'], 24),
  ('CBSE Class 11', 'CBSE Class 11', 'board_class', 'CBSE', '11', 'CBSE', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 25),
  ('CBSE Class 12', 'CBSE Class 12', 'board_class', 'CBSE', '12', 'CBSE', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 26),

  ('ICSE Class 6',  'ICSE Class 6',  'board_class', 'ICSE', '6',  'ICSE', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics'], 30),
  ('ICSE Class 7',  'ICSE Class 7',  'board_class', 'ICSE', '7',  'ICSE', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics'], 31),
  ('ICSE Class 8',  'ICSE Class 8',  'board_class', 'ICSE', '8',  'ICSE', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics'], 32),
  ('ICSE Class 9',  'ICSE Class 9',  'board_class', 'ICSE', '9',  'ICSE', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics'], 33),
  ('ICSE Class 10', 'ICSE Class 10', 'board_class', 'ICSE', '10', 'ICSE', ARRAY['Mathematics','Physics','Chemistry','Biology','English','History & Civics','Geography','Computer Applications'], 34),
  ('ICSE Class 11', 'ICSE Class 11', 'board_class', 'ICSE', '11', 'ICSE', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 35),
  ('ICSE Class 12', 'ICSE Class 12', 'board_class', 'ICSE', '12', 'ICSE', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 36),

  ('State Board Class 6',  'State Board Class 6',  'board_class', 'State Board', '6',  'State Board', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 40),
  ('State Board Class 7',  'State Board Class 7',  'board_class', 'State Board', '7',  'State Board', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 41),
  ('State Board Class 8',  'State Board Class 8',  'board_class', 'State Board', '8',  'State Board', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 42),
  ('State Board Class 9',  'State Board Class 9',  'board_class', 'State Board', '9',  'State Board', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 43),
  ('State Board Class 10', 'State Board Class 10', 'board_class', 'State Board', '10', 'State Board', ARRAY['Mathematics','Science','Social Studies','English','Hindi','Sanskrit'], 44),
  ('State Board Class 11', 'State Board Class 11', 'board_class', 'State Board', '11', 'State Board', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 45),
  ('State Board Class 12', 'State Board Class 12', 'board_class', 'State Board', '12', 'State Board', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 46),

  ('Kerala State Class 6',  'Kerala State Class 6',  'board_class', 'Kerala State', '6',  'Kerala State', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 50),
  ('Kerala State Class 7',  'Kerala State Class 7',  'board_class', 'Kerala State', '7',  'Kerala State', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 51),
  ('Kerala State Class 8',  'Kerala State Class 8',  'board_class', 'Kerala State', '8',  'Kerala State', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 52),
  ('Kerala State Class 9',  'Kerala State Class 9',  'board_class', 'Kerala State', '9',  'Kerala State', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 53),
  ('Kerala State Class 10', 'Kerala State Class 10', 'board_class', 'Kerala State', '10', 'Kerala State', ARRAY['Mathematics','Science','Social Studies','English','Hindi','Sanskrit'], 54),
  ('Kerala State Class 11', 'Kerala State Class 11', 'board_class', 'Kerala State', '11', 'Kerala State', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 55),
  ('Kerala State Class 12', 'Kerala State Class 12', 'board_class', 'Kerala State', '12', 'Kerala State', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 56),

  ('Class 6',  'Class 6',  'class', NULL, '6',  'Middle School', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 60),
  ('Class 7',  'Class 7',  'class', NULL, '7',  'Middle School', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 61),
  ('Class 8',  'Class 8',  'class', NULL, '8',  'Middle School', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 62),
  ('Class 9',  'Class 9',  'class', NULL, '9',  'Middle School', ARRAY['Mathematics','Science','Social Studies','English','Hindi'], 63),
  ('Class 10', 'Class 10', 'class', NULL, '10', 'High School',   ARRAY['Mathematics','Science','Social Studies','English','Hindi','Sanskrit'], 64),
  ('Class 11', 'Class 11', 'class', NULL, '11', 'Senior School', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 65),
  ('Class 12', 'Class 12', 'class', NULL, '12', 'Senior School', ARRAY['Physics','Chemistry','Biology','Mathematics','English','Economics','Accountancy','Business Studies','Computer Science'], 66)
ON CONFLICT (exam_key) DO NOTHING;
