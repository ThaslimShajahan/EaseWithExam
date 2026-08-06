-- Clean up A3 verification fixtures. Deleting the two test centres cascades
-- to coaching_students, coaching_assignments, and centre_published_tests.
delete from public.coaching_centres where name in ('__A3_TEST_CENTRE_A__', '__A3_TEST_CENTRE_B__');
delete from public.coaching_admins where uid in ('__a3_coach_a__', '__a3_coach_b__');
delete from public.admins where uid = '__a3_platform_admin__';
