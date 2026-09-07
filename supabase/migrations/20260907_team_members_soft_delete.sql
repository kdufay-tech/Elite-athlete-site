-- ============================================================================
-- 20260907_team_members_soft_delete.sql
--
-- Stop destroying roster history.
--
-- BEFORE
--   coach-team.js 'leave' and 'remove' both issued a hard DELETE. Once an
--   athlete left, there was no record they had ever been on the team - so an
--   athlete's career ("Luella HS 2023-26, then State U") did not exist as data.
--   That is exactly the narrative a college or pro coach wants, and exactly
--   what was being thrown away.
--
-- AFTER
--   status='departed' + left_at. Nothing is deleted.
--
-- SAFE BECAUSE EVERY READER ALREADY FILTERS
--   Audited before writing this. Every REST read pins status=eq.active:
--     _coach-auth.coachOwnsAthlete, _seat-sync, coach-program,
--     coach-team (join cap, invite cap, list, mine)
--   and all four SQL functions do the same:
--     coach_roster_page, coach_roster_summary,
--     coach_readiness_series, coach_team_series
--   So departed rows are invisible to rosters, readiness and billing. In
--   particular _seat-sync counts status='active', so a departure correctly
--   stops costing $4.99/month.
--
-- REJOINING
--   team_members has UNIQUE (team_id, athlete_id), and the join path upserts
--   with resolution=merge-duplicates. A returning athlete therefore reactivates
--   their existing row rather than failing on the constraint. The payload now
--   sets left_at=null so the old departure does not linger.
--
-- KNOWN LIMITATION
--   One row per (team, athlete) means joined_at is the FIRST join and left_at
--   the MOST RECENT departure. An athlete who leaves and returns has one span,
--   not two. Per-stint history would need a separate table; this is enough to
--   answer "who was on this roster, and when".
-- ============================================================================

alter table public.team_members add column if not exists left_at timestamptz;

create index if not exists team_members_status_idx
  on public.team_members (coach_id, status);

comment on column public.team_members.left_at is
  'Set when status becomes departed. Rows are never deleted - roster history is what makes an athlete career portable across HS/college/pro.';
