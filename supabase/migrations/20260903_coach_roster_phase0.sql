-- 20260903_coach_roster_phase0.sql
-- Coach Roster Phase 0: teams + team_members
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sport text,
  join_code text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  coach_id uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  sport text,
  position text,
  status text not null default 'active',
  joined_at timestamptz not null default now(),
  unique (team_id, athlete_id)
);

create index if not exists team_members_coach_idx   on public.team_members(coach_id);
create index if not exists team_members_athlete_idx on public.team_members(athlete_id);
create index if not exists teams_coach_idx          on public.teams(coach_id);
create index if not exists teams_join_code_idx      on public.teams(join_code);

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_coach_all on public.teams;
create policy teams_coach_all on public.teams
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

drop policy if exists tm_coach_select   on public.team_members;
drop policy if exists tm_athlete_select on public.team_members;
drop policy if exists tm_athlete_insert on public.team_members;
drop policy if exists tm_athlete_delete on public.team_members;
drop policy if exists tm_coach_delete   on public.team_members;

create policy tm_coach_select   on public.team_members for select using (coach_id   = auth.uid());
create policy tm_athlete_select on public.team_members for select using (athlete_id = auth.uid());
create policy tm_athlete_insert on public.team_members for insert with check (athlete_id = auth.uid());
create policy tm_athlete_delete on public.team_members for delete using (athlete_id = auth.uid());
create policy tm_coach_delete   on public.team_members for delete using (coach_id   = auth.uid());