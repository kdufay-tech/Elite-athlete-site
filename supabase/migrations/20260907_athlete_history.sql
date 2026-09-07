-- ============================================================================
-- 20260907_athlete_history.sql
--
-- Monthly rollup of one athlete's record, for the career view that follows an
-- athlete across HS -> college -> pro.
--
-- WHY AGGREGATION AT ALL
--   The app reads only the last 90 days (eight loaders in src/lib/supabase.js),
--   so a multi-year career is invisible to the person who owns it. The career
--   view reads by PAGE; this function exists so the timeline overview costs a
--   few dozen rows instead of pulling years of raw rows to the phone.
--
-- ON `created_at` RATHER THAN `date`
--   Only check_ins.date is a real DATE. workout_logs, nutrition_logs,
--   weight_logs and benchmarks all store `date` as TEXT with no enforced
--   format, so it cannot be trusted for range maths. created_at is a
--   timestamptz on every table.
--
-- READINESS IS DELIBERATELY NOT COMPUTED HERE
--   The formula already exists twice - computeReadiness() in _coach-auth.js and
--   the Postgres version inside coach_roster_page(). A third copy would drift.
--   This returns the raw component averages; the client applies the formula it
--   already owns.
-- ============================================================================

create or replace function public.athlete_history_summary(
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
           round(avg(sleep)::numeric, 1) sl,   round(avg(soreness)::numeric, 1) so
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
         coalesce(ci.n,0), ci.rec, ci.en, ci.sl, ci.so,
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
  'Monthly rollup of one athlete''s record. Called only by netlify/functions/athlete-history.js with the service-role key, which authorises the caller first.';
