-- Adds 'delete' and 'export' to changelog.action's whitelist so the new
-- admin_delete_chapter_manifest (genuine hard DELETE, distinct from the
-- existing 'delete_request' convention used elsewhere for soft/status-change
-- deletes) and the new "Backup all data" export feature can log an audit
-- entry whose action name says plainly what happened, instead of overloading
-- an existing value. Confirmed live via `supabase db query --linked` against
-- pg_constraint before writing this — the existing 13-value list below is
-- copied verbatim from the live `changelog_action_check` definition, not
-- guessed from src/lib/changelog.js, so this ALTER cannot accidentally drop
-- a value already in use.
alter table public.changelog drop constraint changelog_action_check;
alter table public.changelog add constraint changelog_action_check
  check (action = any (array[
    'create', 'update', 'publish', 'archive', 'delete_request', 'approve',
    'reject', 'restore', 'backfill', 'seed', 'bulk_delete', 'embed_failed',
    'wipe', 'delete', 'export'
  ]));
