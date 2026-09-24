-- Owner decisions, 2026-09-25 (data only):
--
-- 1. EaseWithExam serves Class 8–12. The CBSE and Kerala State Class 6/7
--    exam_categories rows are DEACTIVATED, not deleted (ICSE / State Board 6/7
--    were already inactive). Checked first, aggregates only: no student has
--    class_level 6 or 7 (live: 8 ×9, 10 ×1, 12 ×2, none ×2) and no content,
--    notes, syllabus nodes or manifests are tagged Class 6/7.
--    Inactive rows are invisible to students: exam_categories' public read
--    policy is is_active = true, and _student_exam_contexts only matches
--    active rows. The admin board editor no longer regenerates (and so no
--    longer re-activates) Class 6/7 rows; onboarding already offered 8–12.
--
-- 2. Kerala State Class 8–10 gain Malayalam. It is a "no content" subject
--    (subjects.content_bearing = false), so allowed_subjects_for_caller never
--    offers it to students; the owner also wants it hidden explicitly, which
--    is set after deploy through admin_set_subject_hidden (audited), not here.

update public.exam_categories
   set is_active = false, updated_at = now()
 where exam_key in ('CBSE Class 6', 'CBSE Class 7', 'Kerala State Class 6', 'Kerala State Class 7')
   and is_active;

update public.exam_categories
   set subjects = array_append(subjects, 'Malayalam'), updated_at = now()
 where exam_key in ('Kerala State Class 8', 'Kerala State Class 9', 'Kerala State Class 10')
   and not ('Malayalam' = any (subjects));

-- Audit, matching what admin_set_subject_hidden writes for its own changes.
insert into public.changelog (entity_type, entity_id, action, actor_uid, actor_role, diff, note)
select 'exam_category', k, 'update', null, 'system', d::jsonb, n
from (values
  ('CBSE Class 6',          '{"field":"is_active","before":true,"after":false}', 'Deactivated: EaseWithExam serves Class 8–12 only (migration 20260925010000)'),
  ('CBSE Class 7',          '{"field":"is_active","before":true,"after":false}', 'Deactivated: EaseWithExam serves Class 8–12 only (migration 20260925010000)'),
  ('Kerala State Class 6',  '{"field":"is_active","before":true,"after":false}', 'Deactivated: EaseWithExam serves Class 8–12 only (migration 20260925010000)'),
  ('Kerala State Class 7',  '{"field":"is_active","before":true,"after":false}', 'Deactivated: EaseWithExam serves Class 8–12 only (migration 20260925010000)'),
  ('Kerala State Class 8',  '{"field":"subjects","added":"Malayalam"}', 'Added Malayalam (no-content subject) (migration 20260925010000)'),
  ('Kerala State Class 9',  '{"field":"subjects","added":"Malayalam"}', 'Added Malayalam (no-content subject) (migration 20260925010000)'),
  ('Kerala State Class 10', '{"field":"subjects","added":"Malayalam"}', 'Added Malayalam (no-content subject) (migration 20260925010000)')
) as v(k, d, n);
