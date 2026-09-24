-- Adds the RPC the retroactive figure-recompression pass needs
-- (scripts/recompress-figures.mjs). That script re-encodes existing
-- figures/**/*.png objects in the question-papers bucket to WebP under a new
-- content-hashed path, to claw the bucket back under the free-tier storage
-- limit (see cleanup-duplicate-figures.mjs for the sibling dedup pass). Two
-- tables hold the OLD public URL as a plain string, matched by exact
-- equality, not derived at read time:
--
--   content_figures.image_url  (NOT NULL, one row per figure — a single page
--                                image can back several rows, since
--                                uploadFigure() uploads a page once and shares
--                                it across every figure found on it)
--   knowledge_base.figure_url  (nullable, set on chunks bound to one figure)
--
-- Both writes are locked to real verified admins (content_figures via RLS's
-- is_verified_admin(), knowledge_base via RPC-only + assert_verified_admin) —
-- see 20260809030000_verified_identity.sql and 20260810010000. There is no
-- anon-key shortcut, by design; this RPC does not weaken that, it just adds
-- the one operation (bulk URL remap) that lockdown never provided.
--
-- Batched (accepts an array of {old_url,new_url} pairs) rather than one RPC
-- call per figure — content_figures alone would otherwise be up to ~1361
-- round-trips for one script run.
create or replace function public.admin_remap_figure_url(p_caller text, p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_figures_updated   integer := 0;
  v_kb_updated        integer := 0;
  v_pair record;
  v_n integer;
begin
  perform assert_verified_admin(p_caller);

  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'p_pairs must be a JSON array of {old_url,new_url}' using errcode = '22023';
  end if;

  for v_pair in select * from jsonb_to_recordset(p_pairs) as x(old_url text, new_url text)
  loop
    if v_pair.old_url is null or v_pair.new_url is null then
      continue;
    end if;

    update public.content_figures
       set image_url = v_pair.new_url
     where image_url = v_pair.old_url;
    get diagnostics v_n = row_count;
    v_figures_updated := v_figures_updated + v_n;

    update public.knowledge_base
       set figure_url = v_pair.new_url
     where figure_url = v_pair.old_url;
    get diagnostics v_n = row_count;
    v_kb_updated := v_kb_updated + v_n;
  end loop;

  return jsonb_build_object(
    'content_figures_updated', v_figures_updated,
    'knowledge_base_updated',  v_kb_updated
  );
end;
$function$;

comment on function public.admin_remap_figure_url(text, jsonb) is
  'Admin-only. Bulk-repoints content_figures.image_url / knowledge_base.figure_url from an old storage URL to a new one, matched by exact string equality. Built for the retroactive figure-recompression pass (scripts/recompress-figures.mjs) so re-encoded figures do not orphan existing references. Not a general-purpose URL rewriter.';

-- Every PostgREST request runs as `anon` regardless of Firebase sign-in
-- state (Firebase ID tokens carry no Postgres role claim) — grant to
-- `authenticated` alone silently 403s every real caller. assert_verified_admin
-- inside the function body is the actual gate.
grant execute on function public.admin_remap_figure_url(text, jsonb) to anon, authenticated;
