-- ============================================================================
-- 20260908_share_record_view.sql
--
-- Atomic view recording for recruiting shares.
--
-- THE BUG THIS FIXES
--   share-view.js recorded a view with a read-then-write, deliberately NOT
--   awaited so a counter could never block the page:
--       fetch(...select=view_count).then(rows => fetch(...PATCH...)).catch()
--   That is browser thinking inside a serverless function. Once the handler
--   returns its Response the runtime freezes the container, and any promise
--   still in flight is killed. The write never happened: a confirmed coach
--   visit on 2026-09-08 left view_count at 0 and last_viewed_at null.
--
--   The read-then-write was also a lost-update race - two coaches opening at
--   once would both read N and both write N+1.
--
--   One awaited RPC fixes both: atomic in the database, and complete before
--   the response returns. Cost is roughly 100ms, which is worth paying for
--   the athlete-facing question this feature exists to answer - "has the
--   coach actually looked at my profile yet?"
-- ============================================================================

create or replace function public.share_grant_record_view(p_id uuid)
returns void
language sql
volatile
security definer
set search_path to ''
as $function$
  update public.share_grants
  set view_count = view_count + 1,
      last_viewed_at = now()
  where id = p_id;
$function$;

comment on function public.share_grant_record_view is
  'Atomically records a share view. Replaces a read-then-write in share-view.js: that was two round trips with a lost-update race, and it was fire-and-forget, so the serverless runtime froze the container on return and the write never landed at all - view_count stayed 0 through a confirmed coach visit on 2026-09-08.';
