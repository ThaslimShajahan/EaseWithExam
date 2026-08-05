-- ═══════════════════════════════════════════════════════════════════
-- Migration 0039 — Fix admin_list_exam_categories to respect soft-delete
--
-- Bug: admin_delete_exam_category soft-deletes (sets is_active = false),
-- and the public read policy correctly hides inactive rows from the rest
-- of the app — but admin_list_exam_categories (used by the Admin >
-- Categories screen itself) selected ALL rows with no is_active filter,
-- so a "deleted" category kept showing up in the admin's own list even
-- though it was already correctly hidden everywhere else.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_list_exam_categories(p_caller text)
RETURNS SETOF exam_categories
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM admins WHERE uid = p_caller AND is_active = true) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  RETURN QUERY SELECT * FROM exam_categories WHERE is_active = true ORDER BY category_kind, sort_order, label;
END;
$$;
