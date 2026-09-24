-- Rollback for 20260925000000_exam_subject_rules_and_daily_challenge.sql
--
-- ORDER: restore the previous frontend bundle FIRST, then run this — the old
-- bundle reads/writes daily_challenges and daily_challenge_attempts directly.
-- This deliberately re-opens those tables (anon read/write); use only to
-- recover from an outage.
--
-- Left in place on purpose: the new columns on exam_categories (dropping
-- hidden_subjects would silently UN-hide subjects an admin hid) and the new
-- RPCs (unused by the old bundle). The history RPCs keep their identity checks.

create policy public_all_dc on public.daily_challenges for all using (true) with check (true);
grant all on public.daily_challenges to anon, authenticated;

create policy public_all_dca on public.daily_challenge_attempts for all using (true) with check (true);
grant all on public.daily_challenge_attempts to anon, authenticated;
