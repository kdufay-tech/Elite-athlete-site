-- ============================================================================
-- 20260908_athlete_history_mood.sql
--
-- Adds avg_mood to athlete_history_summary().
--
-- WHY
--   The career view shows readiness per month. The readiness formula - the one
--   in _coach-auth.computeReadiness() and again inside coach_roster_page() - is
--     recovery*0.30 + min(sleep/optimal,1)*10*0.25 + energy*0.20
--     + mood*0.15 + (10-soreness)*0.10
--   The original rollup returned every component EXCEPT mood. Computing
--   readiness without it would drop the 0.15 term, and the career view would
--   quietly disagree with the coach roster and the progress tab for the same
--   athlete on the same month. Same formula everywhere or the number is a lie.
--
-- WHY DROP RATHER THAN REPLACE
--   The RETURNS TABLE signature changes, and Postgres will not let CREATE OR
--   REPLACE alter a set-returning function's return type.
--
-- VERIFIED
--   Applied 2026-09-08. pg_get_function_result() contains avg_mood, and a live
--   call for the test athlete returned 2026-09-01: 2 check-ins, avg_recovery
--   7.5, avg_mood 8.0.
-- ============================================================================

drop function if exists public.athlete_history_summary(uuid, timestamptz, timestamptz);

create function public.athlete_history_summary(
  p_user_id uuid,
  p_from    timestamptz,
  p_to      timestamptz
)
returns table (
  month           date,
  check_ins       bigint,
  avg_recovery    numeric,
  avg_energy      numeric,
  avg_sleep       numeric,
  avg_soreness    numeric,
  avg_mood        numeric,
  sessions        bigint,
  total_volume    numeric,
  weight_entries  bigint,
  avg_weight      numeric,
  nutrition_days  bigint,
  avg_calories    numeric,
  benchmarks      bigint,
  notes           bigint,
  journals        bigint
)
language sql
stable
as $$
  with m as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  ),
  ci as (
    select date_trunc('month', created_at)::date mo, count(*) n,
           round(avg(recovery)::numeric, 1) rec, round(avg(energy)::numeric, 1) en,
           round(avg(sleep)::numeric, 1) sl,   round(avg(soreness)::numeric, 1) so,
           round(avg(mood)::numeric, 1) mood
    from check_ins where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  wl as (
    select date_trunc('month', created_at)::date mo,
           count(distinct date) n, round(sum(total_vol)::numeric, 0) vol
    from workout_logs where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  wt as (
    select date_trunc('month', created_at)::date mo, count(*) n, round(avg(weight)::numeric, 1) w
    from weight_logs where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  nu as (
    select date_trunc('month', created_at)::date mo, count(*) n, round(avg(calories)::numeric, 0) cal
    from nutrition_logs where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  bm as (
    select date_trunc('month', created_at)::date mo, count(*) n
    from benchmarks where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  pn as (
    select date_trunc('month', created_at)::date mo, count(*) n
    from progress_notes where user_id = p_user_id and created_at between p_from and p_to group by 1
  ),
  je as (
    select date_trunc('month', created_at)::date mo, count(*) n
    from journal_entries where user_id = p_user_id and created_at between p_from and p_to group by 1
  )
  select m.month,
         coalesce(ci.n,0), ci.rec, ci.en, ci.sl, ci.so, ci.mood,
         coalesce(wl.n,0), coalesce(wl.vol,0),
         coalesce(wt.n,0), wt.w,
         coalesce(nu.n,0), nu.cal,
         coalesce(bm.n,0), coalesce(pn.n,0), coalesce(je.n,0)
  from m
  left join ci on ci.mo = m.month
  left join wl on wl.mo = m.month
  left join wt on wt.mo = m.month
  left join nu on nu.mo = m.month
  left join bm on bm.mo = m.month
  left join pn on pn.mo = m.month
  left join je on je.mo = m.month
  order by m.month desc;
$$;

comment on function public.athlete_history_summary is
  'Monthly rollup of one athlete''s record. Called only by netlify/functions/athlete-history.js with the service-role key, which authorises the caller first. avg_mood added 2026-09-08 so the client can apply the shared readiness formula.';
