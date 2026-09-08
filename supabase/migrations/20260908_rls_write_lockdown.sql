-- ============================================================================
-- 20260908_rls_write_lockdown.sql
--
-- Removes client WRITE access from four tables that only ever get written by
-- service-role Netlify functions. Follows 20260908_team_members_rls_lockdown,
-- which did the same for team_members; this is the rest of the same class.
--
-- ── 1. subscriptions - PAID TIER WAS SELF-GRANTABLE (the serious one) ───────
--   own_sub  ALL  USING (auth.uid() = user_id)  WITH CHECK (none)
--   An ALL policy with only USING applies that expression as the check for
--   INSERT and UPDATE too. So any authenticated user could send
--     PATCH /rest/v1/subscriptions?user_id=eq.<self>
--     { plan_name: 'coach_annual', status: 'active',
--       current_period_end: '2099-01-01' }
--   and hand themselves Coach Pro - or any tier - permanently, with no Stripe
--   payment and no webhook. getUserTier() reads exactly these columns, so the
--   app would honour it. That is the whole paywall, bypassable from the
--   browser console.
--
--   The ONLY client write was saveSubscription() in src/lib/supabase.js, which
--   has ZERO callers - purchases have been recorded server-side by
--   stripe-webhook.js and revenuecat-webhook.js for some time. That dead
--   function is deleted in the same commit so nothing tempts this open again.
--   loadSubscription() still reads, so SELECT stays.
--
-- ── 2. program_assignments - assign to anyone, not just your roster ─────────
--   pa_coach_all  ALL  (coach_id = auth.uid())
--   A coach could client-side insert an assignment for ANY athlete_id, with no
--   roster check, bypassing coachOwnsAthlete() in coach-program.js - and could
--   delete assignments outright.
--
-- ── 3. programs / 4. coach_notes - same shape ───────────────────────────────
--   pr_coach_all / cn_coach_all, both ALL. Self-owned rows, so the blast
--   radius is smaller, but a coach could write a note about any athlete_id
--   with no tenure check, and hard-delete programs that assignments point at.
--
-- ── WHY THIS BREAKS NOTHING ────────────────────────────────────────────────
--   Enumerated every supabase.from() call in src/. The client touches exactly:
--     profiles, journal_entries, progress_notes, calendar_events,
--     subscriptions, check_ins, workout_logs, weight_logs, nutrition_logs,
--     benchmarks, progress_photos
--   programs, program_assignments and coach_notes appear NOWHERE in src/.
--   Their only accessors are coach-program.js and coach-notes.js on the
--   service-role key, and service_role has rolbypassrls = true.
--
--   The athlete-owned tables above are deliberately untouched: an athlete
--   writing their own check-ins under auth.uid() = user_id is correct design,
--   not a hole.
--
-- ── POSTURE AFTER ──────────────────────────────────────────────────────────
--   All four: RLS on, SELECT-only. With no INSERT/UPDATE/DELETE policy,
--   PostgREST denies every client write by default.
-- ============================================================================

-- 1. subscriptions: read your own, never write it
drop policy if exists own_sub on public.subscriptions;
create policy own_sub_read on public.subscriptions
  for select using (auth.uid() = user_id);

-- 2. program_assignments
drop policy if exists pa_coach_all on public.program_assignments;
create policy pa_coach_read on public.program_assignments
  for select using (coach_id = auth.uid());
-- pa_athlete_read (athlete_id = auth.uid()) is already SELECT-only; left as is.

-- 3. programs
drop policy if exists pr_coach_all on public.programs;
create policy pr_coach_read on public.programs
  for select using (coach_id = auth.uid());

-- 4. coach_notes
drop policy if exists cn_coach_all on public.coach_notes;
create policy cn_coach_read on public.coach_notes
  for select using (coach_id = auth.uid());

comment on table public.subscriptions is
  'Billing state. Written ONLY by service-role functions (stripe-webhook, revenuecat-webhook, accept-beta-invite, admin-action). Client access is read-your-own; plan_name and status were client-writable until 2026-09-08, which made every paid tier self-grantable.';
