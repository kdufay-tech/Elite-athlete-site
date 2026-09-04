-- 20260904_coach_phase1_schema.sql
-- Coach Pro Phase 1 — schema. Applied to production 2026-09-04.
--
-- Adds the covering index the readiness range-scans need, plus the three tables
-- Phase 1 introduces: coach notes, programs, and program assignments.

-- Range-scan index for readiness series. Without this the trailing-window queries
-- fall back to sequential scans of check_ins.
create index if not exists check_ins_user_date_idx on public.check_ins (user_id, date desc);

-- ── COACH NOTES ──────────────────────────────────────────────────────
-- Coach-private observations about an athlete.
create table if not exists public.coach_notes (
  id uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists coach_notes_lookup_idx
  on public.coach_notes (coach_id, athlete_id, created_at desc);

alter table public.coach_notes enable row level security;
drop policy if exists cn_coach_all on public.coach_notes;
-- Deliberately coach-private: there is NO athlete select policy. If shared notes
-- are ever wanted, add a visible_to_athlete flag and a second explicit policy —
-- never by loosening this one.
create policy cn_coach_all on public.coach_notes
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- ── PROGRAMS ─────────────────────────────────────────────────────────
create table if not exists public.programs (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references auth.users(id) on delete cascade,
  team_id  uuid references public.teams(id) on delete cascade,
  name     text not null,
  sport    text,
  wk_type  text,
  wk_focus text,
  weeks    integer not null default 4,
  blocks   jsonb   not null default '[]'::jsonb,
  active   boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists programs_coach_idx on public.programs (coach_id, created_at desc);

alter table public.programs enable row level security;
drop policy if exists pr_coach_all on public.programs;
create policy pr_coach_all on public.programs
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());

-- ── PROGRAM ASSIGNMENTS ──────────────────────────────────────────────
-- A team-wide assignment fans out to one row per athlete, so per-athlete
-- status/start-date can diverge without duplicating the program itself.
create table if not exists public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.programs(id) on delete cascade,
  coach_id   uuid not null references auth.users(id) on delete cascade,
  athlete_id uuid not null references auth.users(id) on delete cascade,
  team_id    uuid not null references public.teams(id) on delete cascade,
  starts_on  date not null default current_date,
  status     text not null default 'active',
  assigned_at timestamptz not null default now(),
  unique (program_id, athlete_id)
);
create index if not exists pa_athlete_idx on public.program_assignments (athlete_id, status);
create index if not exists pa_coach_idx   on public.program_assignments (coach_id, team_id);

alter table public.program_assignments enable row level security;
drop policy if exists pa_coach_all    on public.program_assignments;
drop policy if exists pa_athlete_read on public.program_assignments;
create policy pa_coach_all on public.program_assignments
  for all using (coach_id = auth.uid()) with check (coach_id = auth.uid());
-- Athletes CAN read their own assignments — that is the point of assigning one.
create policy pa_athlete_read on public.program_assignments
  for select using (athlete_id = auth.uid());
