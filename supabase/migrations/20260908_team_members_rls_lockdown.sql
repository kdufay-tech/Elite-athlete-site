-- ============================================================================
-- 20260908_team_members_rls_lockdown.sql
--
-- Closes two client-reachable holes in team_members.
--
-- HOLE 1 - CLIENTS COULD HARD-DELETE MEMBERSHIPS
--   tm_athlete_delete  DELETE  (athlete_id = auth.uid())
--   tm_coach_delete    DELETE  (coach_id   = auth.uid())
--   Both granted to role `public`, i.e. any authenticated user. 20260907
--   moved leave/remove to soft-delete, but ONLY inside coach-team.js. Any
--   coach or athlete could still fire
--     DELETE /rest/v1/team_members?...
--   at PostgREST with their own JWT and destroy the row outright - erasing the
--   career history that My Record and athlete-history's `teams` action are
--   built on. A pause has to hold everywhere it is reachable, not only where
--   it was noticed.
--
-- HOLE 2 - CLIENTS COULD JOIN ANY TEAM (the worse one)
--   tm_athlete_insert  INSERT  WITH CHECK (athlete_id = auth.uid())
--   It constrained WHO you claim to be and nothing else - not team_id, not
--   coach_id, not status. So any authenticated user could post
--     { team_id: <any>, coach_id: <any>, athlete_id: <self>, status: 'active' }
--   and place themselves on any coach's roster, bypassing the invite code, its
--   14-day expiry, single-use redemption, join_code_enabled, AND the roster
--   cap. Because _seat-sync counts status='active', an uninvited row also adds
--   $4.99/month to that coach's Stripe bill. There is no coach_id/teams.coach_id
--   consistency constraint to stop it either.
--
-- WHY DROPPING THESE BREAKS NOTHING
--   Audited before writing this:
--     grep -rn "team_members" src/   -> no matches
--     grep -rn "from('teams')"  src/ -> no matches
--   No client code touches either table. Every reader and writer is a Netlify
--   function using the service-role key, which bypasses RLS entirely:
--     _coach-auth, _seat-sync, coach-team, coach-program, coach-nudge,
--     athlete-history
--   Joining is not a client operation and never was - coach-team.js 'join'
--   owns it along with the invite lookup, expiry check, cap check and
--   code-enabled check.
--
-- POSTURE AFTER THIS
--   RLS on, SELECT only. With no INSERT/UPDATE/DELETE policy, PostgREST denies
--   every client write by default. This matches team_invites, which has RLS
--   enabled and zero policies and has been service-role-only since it shipped.
--
-- WHY THE SELECT POLICIES STAY
--   tm_athlete_select and tm_coach_select are scoped to the caller's own rows,
--   and reading your own membership (or your own roster) is something both
--   parties are entitled to. Nothing client-side uses them today, but leaving
--   read access costs nothing and removing it risks breaking a future embed
--   for no security gain. The writes are the hole; the reads are not.
-- ============================================================================

drop policy if exists tm_athlete_delete on public.team_members;
drop policy if exists tm_coach_delete   on public.team_members;
drop policy if exists tm_athlete_insert on public.team_members;

comment on table public.team_members is
  'Roster membership. Rows are NEVER deleted - departure is status=departed + left_at, so an athlete career survives a roster change. Client writes are denied by RLS (SELECT-only policies); every mutation goes through netlify/functions/coach-team.js under the service-role key, which enforces invite validity, expiry, single use, join_code_enabled and the roster cap.';
