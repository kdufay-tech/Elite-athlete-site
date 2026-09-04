-- 20260904_coach_phase1_functions.sql
-- Coach Pro Phase 1 — server-side readiness aggregation. Applied 2026-09-04.
--
-- WHY THESE EXIST
-- The Phase 0 roster endpoint built a PostgREST `user_id=in.(...)` filter from every
-- athlete id and reduced raw check-ins in JavaScript. At 500 athletes that URL is
-- ~18KB (past what proxies accept) and the payload was 45,000 rows to compute 500
-- numbers. These functions move the work into Postgres so payload tracks PAGE size,
-- not roster size.
--
-- MEASURED (500 athletes, 45,000 check-ins, load-test schema, since dropped):
--   coach_roster_page, 50 rows ............ 15 ms, index-only, 0 heap fetches
--   series with window bounded to range ... 24 ms  (19,000 rows scanned)
--   series with window UNBOUNDED .......... 129 ms (365,000 rows scanned)
-- The bound matters more than the speed: unbounded, a 30-day chart scans the
-- athlete's entire history, so cost grows with ACCOUNT AGE rather than with the
-- range requested. Bounded, year three costs the same as week one.
--
-- SECURITY
-- All three are SECURITY DEFINER (they must read across users) with search_path
-- pinned to ''. Execute is REVOKED from anon/authenticated and granted only to
-- service_role: the anon key ships inside the app bundle, so a client must never be
-- able to invoke these with someone else's coach id. The Netlify functions verify
-- the caller's JWT and derive p_coach from it. Authorization is also structural —
-- every function joins team_members on the caller's coach_id before reading
-- anything.
--
-- The readiness formula mirrors src/App.jsx exactly (trailing-3 window, sleep capped
-- at sport-optimal) so coach and athlete never see contradicting numbers.

-- ── PAGINATED ROSTER ─────────────────────────────────────────────────
create or replace function public.coach_roster_page(
  p_coach  uuid,
  p_team   uuid    default null,
  p_limit  integer default 50,
  p_offset integer default 0,
  p_search text    default null
)
returns table (
  athlete_id uuid, team_id uuid, team_name text,
  name text, sport text, "position" text,
  readiness numeric, days_since integer, check_in_count bigint,
  last_date date, last_recovery integer, last_energy integer,
  last_sleep numeric, last_soreness integer, last_mood integer, last_notes text,
  at_risk boolean, total_count bigint
)
language sql stable security definer set search_path = ''
as $$
with roster as (
  select tm.athlete_id, tm.team_id, t.name as team_name,
         coalesce(p.name, 'Athlete')       as ath_name,
         coalesce(p.sport, tm.sport)       as ath_sport,
         coalesce(p.position, tm.position) as ath_position
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  left join public.profiles p on p.user_id = tm.athlete_id
  where tm.coach_id = p_coach
    and tm.status = 'active'
    and (p_team is null or tm.team_id = p_team)
    and (p_search is null or p_search = ''
         or coalesce(p.name, '') ilike '%' || p_search || '%'
         or coalesce(p.position, '') ilike '%' || p_search || '%')
),
counted as (select count(*)::bigint as total from roster),
enriched as (
  select r.*,
         l.date as l_date, l.recovery as l_recovery, l.energy as l_energy,
         l.sleep as l_sleep, l.soreness as l_soreness, l.mood as l_mood, l.notes as l_notes,
         a.avg_recovery, a.avg_sleep, a.avg_energy, a.avg_mood, a.avg_soreness,
         coalesce(n.cnt, 0) as cnt
  from roster r
  left join lateral (
    select c.date, c.recovery, c.energy, c.sleep, c.soreness, c.mood, c.notes
    from public.check_ins c where c.user_id = r.athlete_id
    order by c.date desc limit 1
  ) l on true
  left join lateral (
    select avg(s.recovery)::numeric as avg_recovery, avg(s.sleep)::numeric as avg_sleep,
           avg(s.energy)::numeric as avg_energy, avg(s.mood)::numeric as avg_mood,
           avg(s.soreness)::numeric as avg_soreness
    from (select c2.recovery, c2.sleep, c2.energy, c2.mood, c2.soreness
          from public.check_ins c2 where c2.user_id = r.athlete_id
          order by c2.date desc limit 3) s
  ) a on true
  left join lateral (
    select count(*)::bigint as cnt from public.check_ins c3 where c3.user_id = r.athlete_id
  ) n on true
),
calc as (
  select e.*,
    case when e.avg_recovery is null then null else
      round(least(10,
          e.avg_recovery * 0.30
        + least(e.avg_sleep / (case when lower(coalesce(e.ath_sport,'')) in ('football','basketball')
                                    then 9 else 8 end), 1) * 10 * 0.25
        + e.avg_energy * 0.20
        + e.avg_mood   * 0.15
        + (10 - e.avg_soreness) * 0.10
      ), 1)
    end as readiness_calc,
    case when e.l_date is null then null else (current_date - e.l_date) end as days_since_calc
  from enriched e
)
select
  c.athlete_id, c.team_id, c.team_name, c.ath_name, c.ath_sport, c.ath_position,
  c.readiness_calc, c.days_since_calc, c.cnt,
  c.l_date, c.l_recovery, c.l_energy, c.l_sleep, c.l_soreness, c.l_mood, c.l_notes,
  (c.days_since_calc is null or c.days_since_calc >= 3
   or (c.readiness_calc is not null and c.readiness_calc < 5)) as at_risk,
  (select total from counted)
from calc c
order by
  (c.days_since_calc is null or c.days_since_calc >= 3
   or (c.readiness_calc is not null and c.readiness_calc < 5)) desc,
  c.readiness_calc asc nulls first,
  c.ath_name asc
limit  greatest(1, least(coalesce(p_limit, 50), 200))
offset greatest(0, coalesce(p_offset, 0));
$$;

-- ── PER-ATHLETE READINESS SERIES ─────────────────────────────────────
create or replace function public.coach_readiness_series(
  p_coach uuid, p_athletes uuid[], p_days integer default 30
)
returns table (athlete_id uuid, d date, readiness numeric)
language sql stable security definer set search_path = ''
as $$
with rng as (select greatest(1, least(coalesce(p_days, 30), 365)) as n),
allowed as (
  select distinct tm.athlete_id from public.team_members tm
  where tm.coach_id = p_coach and tm.status = 'active' and tm.athlete_id = any(p_athletes)
),
src as (
  select c.user_id, c.date, c.recovery, c.sleep, c.energy, c.mood, c.soreness,
         case when lower(coalesce(p.sport,'')) in ('football','basketball') then 9 else 8 end as opt
  from public.check_ins c
  join allowed a on a.athlete_id = c.user_id
  left join public.profiles p on p.user_id = c.user_id
  -- bound the window INPUT; +7 days of lead-in gives the trailing-3 its context
  where c.date >= current_date - ((select n from rng) + 7)
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
$$;

-- ── TEAM AGGREGATE SERIES ────────────────────────────────────────────
-- One row per day regardless of roster size.
create or replace function public.coach_team_series(
  p_coach uuid, p_team uuid default null, p_days integer default 30
)
returns table (d date, avg_readiness numeric, checked_in integer, roster_size integer, compliance numeric)
language sql stable security definer set search_path = ''
as $$
with rng as (select greatest(1, least(coalesce(p_days, 30), 365)) as n),
roster as (
  select distinct tm.athlete_id from public.team_members tm
  where tm.coach_id = p_coach and tm.status = 'active'
    and (p_team is null or tm.team_id = p_team)
),
n as (select count(*)::integer as sz from roster),
days as (select generate_series(current_date - (select n from rng), current_date, interval '1 day')::date as d),
src as (
  select c.user_id, c.date, c.recovery, c.sleep, c.energy, c.mood, c.soreness,
         case when lower(coalesce(p.sport,'')) in ('football','basketball') then 9 else 8 end as opt
  from public.check_ins c
  join roster r on r.athlete_id = c.user_id
  left join public.profiles p on p.user_id = c.user_id
  where c.date >= current_date - ((select n from rng) + 7)
),
rolled as (
  select user_id, date, opt,
    avg(recovery) over w as r, avg(sleep) over w as s, avg(energy) over w as e,
    avg(mood) over w as m, avg(soreness) over w as so
  from src
  window w as (partition by user_id order by date rows between 2 preceding and current row)
),
scored as (
  select user_id, date,
    round(least(10, r*0.30 + least(s/opt,1)*10*0.25 + e*0.20 + m*0.15 + (10-so)*0.10), 1) as rd
  from rolled
)
select dy.d,
       round(avg(sc.rd), 1),
       count(sc.user_id)::integer,
       (select sz from n),
       case when (select sz from n) = 0 then 0
            else round(count(sc.user_id)::numeric * 100 / (select sz from n), 1) end
from days dy
left join scored sc on sc.date = dy.d
group by dy.d
order by dy.d;
$$;

-- ── WHOLE-ROSTER SUMMARY ─────────────────────────────────────────────
-- One row for the entire roster. Without this the coach UI would show an at-risk
-- count for the CURRENT PAGE only — on a 500-athlete roster that understates risk,
-- and it is the one number a coach has to be able to trust.
create or replace function public.coach_roster_summary(
  p_coach uuid,
  p_team  uuid default null
)
returns table (
  total integer, at_risk integer, avg_readiness numeric,
  checked_in_today integer, never_checked_in integer
)
language sql stable security definer set search_path = ''
as $$
with roster as (
  select tm.athlete_id, coalesce(p.sport, tm.sport) as sport
  from public.team_members tm
  left join public.profiles p on p.user_id = tm.athlete_id
  where tm.coach_id = p_coach and tm.status = 'active'
    and (p_team is null or tm.team_id = p_team)
),
calc as (
  select r.athlete_id, l.date as last_date,
    case when a.avg_recovery is null then null else
      round(least(10,
          a.avg_recovery * 0.30
        + least(a.avg_sleep / (case when lower(coalesce(r.sport,'')) in ('football','basketball')
                                    then 9 else 8 end), 1) * 10 * 0.25
        + a.avg_energy * 0.20
        + a.avg_mood   * 0.15
        + (10 - a.avg_soreness) * 0.10
      ), 1)
    end as readiness
  from roster r
  left join lateral (
    select c.date from public.check_ins c where c.user_id = r.athlete_id
    order by c.date desc limit 1
  ) l on true
  left join lateral (
    select avg(s.recovery)::numeric avg_recovery, avg(s.sleep)::numeric avg_sleep,
           avg(s.energy)::numeric avg_energy, avg(s.mood)::numeric avg_mood,
           avg(s.soreness)::numeric avg_soreness
    from (select c2.recovery, c2.sleep, c2.energy, c2.mood, c2.soreness
          from public.check_ins c2 where c2.user_id = r.athlete_id
          order by c2.date desc limit 3) s
  ) a on true
)
select
  count(*)::integer,
  count(*) filter (
    where last_date is null
       or (current_date - last_date) >= 3
       or (readiness is not null and readiness < 5)
  )::integer,
  round(avg(readiness), 1),
  count(*) filter (where last_date = current_date)::integer,
  count(*) filter (where last_date is null)::integer
from calc;
$$;

-- ── GRANTS ───────────────────────────────────────────────────────────
revoke all on function public.coach_roster_summary(uuid, uuid)                       from public, anon, authenticated;
grant  execute on function public.coach_roster_summary(uuid, uuid)                   to service_role;
revoke all on function public.coach_roster_page(uuid, uuid, integer, integer, text) from public, anon, authenticated;
revoke all on function public.coach_readiness_series(uuid, uuid[], integer)          from public, anon, authenticated;
revoke all on function public.coach_team_series(uuid, uuid, integer)                 from public, anon, authenticated;

grant execute on function public.coach_roster_page(uuid, uuid, integer, integer, text) to service_role;
grant execute on function public.coach_readiness_series(uuid, uuid[], integer)          to service_role;
grant execute on function public.coach_team_series(uuid, uuid, integer)                 to service_role;
