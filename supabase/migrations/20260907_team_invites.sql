-- ============================================================================
-- 20260907_team_invites.sql
--
-- Per-athlete invite codes, plus controls on the shared team code.
--
-- WHY
--   Until now a team had ONE join code: permanent, unrotatable, no approval
--   step, no roster cap. Anyone holding it was on the roster the moment they
--   typed it. That was tolerable while a roster cost nothing.
--
--   It stopped being tolerable on 2026-09-07, when per-athlete billing went in
--   ($4.99/month per active athlete on top of the $899/year subscription). A
--   code posted in a group chat or screenshotted is now an uncapped recurring
--   charge on the coach's card, with no way to rotate it and no gate to stop it.
--
-- WHAT THIS ADDS
--   1. team_invites - single-use codes, one per athlete, revocable, expiring.
--   2. teams.join_code_enabled - the shared open code is now OPT-IN and
--      defaults to FALSE. Coaches turn it on for a squad in a room and off
--      again afterwards; teams.join_code can also be rotated.
--   3. teams.level - drives the roster cap, since a cap is also a spend
--      ceiling: hs 55, college 150, pro 250, youth 500.
--      Vocabulary matches profiles.level (hs/college/pro) plus 'youth'.
-- ============================================================================

create table if not exists public.team_invites (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete cascade,
  coach_id    uuid not null,
  code        text not null unique,
  label       text,                                   -- coach's own note, e.g. "Marcus - QB"
  status      text not null default 'pending',        -- pending | redeemed | revoked
  expires_at  timestamptz,
  redeemed_at timestamptz,
  redeemed_by uuid,
  created_at  timestamptz not null default now()
);

create index if not exists team_invites_code_idx    on public.team_invites (code);
create index if not exists team_invites_coach_idx   on public.team_invites (coach_id, status);
create index if not exists team_invites_team_idx    on public.team_invites (team_id, status);

-- Reached only through Netlify functions using the service-role key, which
-- bypasses RLS. Enabled with no policies so nothing else can read or write it.
alter table public.team_invites enable row level security;

alter table public.teams add column if not exists join_code_enabled boolean not null default false;
alter table public.teams add column if not exists level text;

comment on column public.teams.join_code_enabled is
  'Shared open join code accepted? Defaults FALSE - per-athlete invites are the norm since seats are billed.';
comment on column public.teams.level is
  'hs | college | pro | youth. Drives the roster cap, which is also a monthly spend ceiling.';
