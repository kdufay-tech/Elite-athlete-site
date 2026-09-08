-- ============================================================================
-- 20260908_teams_rls_lockdown.sql
--
-- The last write policy in the coach domain, and the one that reopened the
-- hole the other two migrations had just closed.
--
--   teams_coach_all  ALL  USING (coach_id = auth.uid())
--                         WITH CHECK (coach_id = auth.uid())
--
-- DELETE IS THE REAL PROBLEM - IT CASCADES
--   Three tables point at teams(id) ON DELETE CASCADE:
--     team_members_team_id_fkey
--     team_invites_team_id_fkey
--     program_assignments_team_id_fkey
--   So a coach sending
--     DELETE /rest/v1/teams?id=eq.<own team>
--   wipes every membership row on that team outright. 20260907 made departure
--   a soft-delete and 20260908_team_members_rls_lockdown removed the direct
--   DELETE, but the cascade through the parent survived both - the same
--   destruction, one table over. A pause has to hold on every path that
--   reaches it, not just the one that was noticed.
--
-- UPDATE BYPASSES THE GUARDS TOO
--   join_code_enabled: flip the shared code on without going through
--     toggle_code.
--   level: set 'youth' for a cap of 500, skipping the check in coach-team.js
--     'set_level' that refuses a cap below the current roster. A cap is also
--     a spend ceiling at $4.99/athlete.
--   join_code: set a chosen code, sidestepping rotate_code and its collision
--     retry.
--
-- INSERT BYPASSES THE TEAM LIMIT
--   coach-team.js 'create' refuses past 10 teams per coach. A direct insert
--   does not.
--
-- SAFE BECAUSE THE CLIENT NEVER TOUCHES teams
--   The full supabase.from() audit in 20260908_rls_write_lockdown lists every
--   table the client uses. teams is not among them - CoachRoster reads team
--   objects from coach-roster.js, never from PostgREST. Every writer is a
--   service-role function, and service_role has rolbypassrls = true.
--
-- SELECT is kept so a coach can read their own teams if a future client path
-- wants to; the writes were the hole.
-- ============================================================================

drop policy if exists teams_coach_all on public.teams;

create policy teams_coach_read on public.teams
  for select using (coach_id = auth.uid());

comment on table public.teams is
  'Coach teams. Client access is read-your-own; all writes go through netlify/functions/coach-team.js under the service-role key, which enforces the 10-team limit, join-code collision retry, and the set_level cap guard. Client DELETE was removed 2026-09-08 - it cascaded to team_members and destroyed roster history.';
