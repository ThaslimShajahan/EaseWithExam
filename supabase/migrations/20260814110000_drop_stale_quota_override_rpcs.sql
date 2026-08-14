-- Drops the STALE overload of admin_set_quota_override and the redundant
-- admin_delete_quota_override, both discovered live while auditing the
-- "show name not raw uid" request (item 3).
--
-- WHAT WAS WRONG
-- admin_set_quota_override already existed (20260811200000_p05_batch1_mutations.sql,
-- 8 days before tonight's per-student grant redesign) with the signature
--   (text,text,integer,integer,integer,text,text,integer,integer,integer)
-- Tonight's 20260814080000 used CREATE OR REPLACE with a DIFFERENT signature
--   (text,text,integer,integer,integer,integer,integer,integer,timestamptz,text)
-- Different parameter count/types/order means Postgres could not recognise
-- these as "the same function" to replace in place -- it created a SECOND
-- overload instead. Confirmed live via pg_proc: both signatures existed
-- simultaneously.
--
-- WHY THAT WAS A REAL SAFETY BYPASS, NOT COSMETIC
-- AdminQuota.jsx's override form calls this RPC with named parameters
-- (p_ai, p_veda, p_mock, p_expires_at as free text). Those names only exist
-- on the OLD overload, so PostgREST resolved every call from that screen to
-- the OLD, unsafe version -- which accepts a null or blank expiry (a
-- permanent override, the exact "second unlimited-forever switch" tonight's
-- redesign exists to prevent), does no future-date check, and has never
-- heard of reminder_stage, so a grant made through this screen would never
-- enter the expiry-reminder schedule at all.
--
-- THE FIX
-- Drop the old overload outright, rather than trying to reconcile the two --
-- there is only ever supposed to be one admin_set_quota_override, and the
-- one built and verified tonight (required future expires_at, resets
-- reminder_stage on re-grant) is the one every caller must use.
--
-- admin_delete_quota_override (same 20260811200000 migration) is dropped for
-- the same reason it is redundant: admin_clear_quota_override
-- (20260814080000) does the exact same delete, and having two names for one
-- action is exactly the kind of duplication that let the write-side bug
-- happen in the first place. AdminQuota.jsx is updated to call the
-- surviving one.

drop function if exists public.admin_set_quota_override(
  text, text, integer, integer, integer, text, text, integer, integer, integer
);

drop function if exists public.admin_delete_quota_override(text, text);

-- Confirms exactly one admin_set_quota_override signature remains -- the safe
-- one -- so this migration fails loudly if the drop above did not target the
-- row it was meant to (rather than silently leaving two).
do $$
declare v_count int;
begin
  select count(*) into v_count from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_set_quota_override';
  if v_count <> 1 then
    raise exception 'Expected exactly 1 admin_set_quota_override signature after cleanup, found %', v_count;
  end if;
end $$;
