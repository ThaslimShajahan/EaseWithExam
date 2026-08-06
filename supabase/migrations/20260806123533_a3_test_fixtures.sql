-- Temporary A3 verification fixtures — cleaned up in a follow-up migration.
insert into public.admins (uid, email, name, role, is_active)
values ('__a3_platform_admin__', 'a3admin@test.local', 'A3 Test Admin', 'admin', true);

insert into public.coaching_centres (id, name, city, status)
values
  ('11111111-1111-1111-1111-111111111111', '__A3_TEST_CENTRE_A__', 'Mumbai', 'active'),
  ('22222222-2222-2222-2222-222222222222', '__A3_TEST_CENTRE_B__', 'Delhi', 'active');

insert into public.coaching_admins (uid, email, name, role, centre_id, is_active)
values
  ('__a3_coach_a__', 'coachA@test.local', 'Coach A', 'centre_admin', '11111111-1111-1111-1111-111111111111', true),
  ('__a3_coach_b__', 'coachB@test.local', 'Coach B', 'centre_admin', '22222222-2222-2222-2222-222222222222', true);
