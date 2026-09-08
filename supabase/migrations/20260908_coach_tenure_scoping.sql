-- ============================================================================
-- 20260908_coach_tenure_scoping.sql
--
-- A coach may read an athlete's record only for the period they actually
-- coached them. Before that period: monthly summary only. After departure:
-- nothing.
--
-- THE GAP THIS CLOSES
--   coach_readiness_series built its `allowed` set from
--     tm.coach_id = p_coach AND tm.status = 'active'
--   and windowed the data by current_date - p_days, with p_days capped at 365.
--   Nothing referenced joined_at. So a coach could ask for days=365 on any
--   current athlete and receive a full year of readiness - including every day
--   BEFORE that athlete joined their program. For a transfer that is the
--   previous school's record. Soft-delete (20260907) means the volume of
--   pre-tenure data behind that call only grows.
--
-- THE RULE
--   tenure = [joined_at, now()] for an ACTIVE membership.
--     within tenure  -> full detail (raw rows, daily series, counts)
--     before tenure  -> monthly aggregate ONLY: the readiness components and
--                       training volume. No counts, no weight, no nutrition,
--                       no raw rows, no daily granularity.
--     after departure-> nothing. status = 'active' remains the gate, so a
--                       departed athlete's record closes to that coach
--                       entirely. Deliberate: departure has to mean something.
--
-- MULTIPLE MEMBERSHIPS
--   An athlete can sit on two of the same coach's teams. Tenure takes the
--   EARLIEST joined_at across them - the coach has legitimately been coaching
--   the athlete since the first of those dates.
--
-- WHY READINESS IS NOT COMPUTED HERE
--   The formula already exists in _coach-auth.computeReadiness(),
--   coach_roster_page(), coach_readiness_series() and the client. This function
--   returns the raw monthly components and lets the client apply the shared
--   helper, exactly as athlete_history_summary() does. No new copy to drift.
-- ============================================================================

-- ── 1. Clamp the existing daily series to tenure ───────────────────────────
create or replace function public.coach_readiness_series(
  p_coach uuid, p_athletes uuid[], p_days integer default 30
)
returns table(athlete_id uuid, d date, readiness numeric)
language sql stable security definer set search_path to ''
as $function$
with rng as (select greatest(1, least(coalesce(p_days, 30), 365)) as n),
allowed as (
  -- joined_at now travels with the athlete so the window can be clamped to it.
  select tm.athlete_id, min(tm.joined_at)::date as since
  from public.team_members tm
  where tm.coach_id = p_coach and tm.status = 'active'
    and tm.athlete_id = any(p_athletes)
  group by tm.athlete_id
),
src as (
  select c.user_id, c.date, c.recovery, c.sleep, c.energy, c.mood, c.soreness,
         case when lower(coalesce(p.sport,'')) in ('football','basketball') then 9 else 8 end as opt
  from public.check_ins c
  join allowed a on a.athlete_id = c.user_id
  left join public.profiles p on p.user_id = c.user_id
  where c.date >= current_date - ((select n from rng) + 7)
    and c.date >= a.since          -- TENURE CLAMP
),
rolled as (
  select user_id, date, opt,
    avg(recovery) over w as r, avg(sleep) over w as s, avg(energy) over w as e,
    avg(mood) over w as m, avg(soreness) over w as so
  from src
  window w as (partition by user_id order by date rows between 2 preceding and current row)
)
select user_id, date,
  round(least(10, r*0.30 + least(s/opt,1)*10*0.25 + e*0.20 + m*0.15 + (10-so)*0.10), 1)
from rolled
where date >= current_date - (select n from rng)
order by user_id, date;
$function$;

comment on function public.coach_readiness_series is
  'Daily readiness for athletes on a coach''s roster, clamped to the coach''s tenure (min joined_at). Before 2026-09-08 this returned up to 365 days regardless of when the athlete joined, exposing a transfer''s previous-school record.';

-- ── 2. Monthly career view, tenure-aware ───────────────────────────────────
create or replace function public.coach_athlete_history(
  p_coach   uuid,
  p_athlete uuid,
  p_from    timestamptz,
  p_to      timestamptz
)
returns table (
  month          date,
  within_tenure  boolean,
  avg_recovery   numeric,
  avg_energy     numeric,
  avg_sleep      numeric,
  avg_soreness   numeric,
  avg_mood       numeric,
  total_volume   numeric,
  check_ins      bigint,
  sessions       bigint,
  avg_weight     numeric,
  benchmarks     bigint
)
language sql stable security definer set search_path to ''
as $function$
with ten as (
  -- Structural authorisation: no ACTIVE membership, no rows. status='active'
  -- is what closes the record when an athlete departs.
  select min(tm.joined_at) as since
  from public.team_members tm
  where tm.coach_id = p_coach and tm.athlete_id = p_athlete and tm.status = 'active'
),
m as (
  select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  where exists (select 1 from ten where since is not null)
),
ci as (
  select date_trunc('month', created_at)::date mo, count(*) n,
         round(avg(recovery)::numeric,1) rec, round(avg(energy)::numeric,1) en,
         round(avg(sleep)::numeric,1) sl, round(avg(soreness)::numeric,1) so,
         round(avg(mood)::numeric,1) mood
  from public.check_ins
  where user_id = p_athlete and created_at between p_from and p_to group by 1
),
wl as (
  select date_trunc('month', created_at)::date mo,
         count(distinct date) n, round(sum(total_vol)::numeric,0) vol
  from public.workout_logs
  where user_id = p_athlete and created_at between p_from and p_to group by 1
),
wt as (
  select date_trunc('month', created_at)::date mo, round(avg(weight)::numeric,1) w
  from public.weight_logs
  where user_id = p_athlete and created_at between p_from and p_to group by 1
),
bm as (
  select date_trunc('month', created_at)::date mo, count(*) n
  from public.benchmarks
  where user_id = p_athlete and created_at between p_from and p_to group by 1
)
select
  m.month,
  (m.month >= date_trunc('month', (select since from ten))::date) as within_tenure,
  -- Readiness components and volume are returned for EVERY month, tenure or
  -- not - that is the agreed pre-tenure summary.
  ci.rec, ci.en, ci.sl, ci.so, ci.mood,
  coalesce(wl.vol, 0),
  -- Everything below is detail, and is withheld before tenure begins.
  case when m.month >= date_trunc('month', (select since from ten))::date then coalesce(ci.n,0) end,
  case when m.month >= date_trunc('month', (select since from ten))::date then coalesce(wl.n,0) end,
  case when m.month >= date_trunc('month', (select since from ten))::date then wt.w end,
  case when m.month >= date_trunc('month', (select since from ten))::date then coalesce(bm.n,0) end
from m
left join ci on ci.mo = m.month
left join wl on wl.mo = m.month
left join wt on wt.mo = m.month
left join bm on bm.mo = m.month
order by m.month desc;
$function$;

comment on function public.coach_athlete_history is
  'Monthly record of one athlete for one coach. Authorised structurally: an ACTIVE team_members row for (coach, athlete) or zero rows returned. Months before the coach''s tenure carry readiness components and volume ONLY - counts, weight and benchmarks are null. Called by netlify/functions/coach-history.js.';
