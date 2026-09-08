-- ============================================================================
-- 20260908_school_seat_grants.sql
--
-- Makes a school-bought seat mean something, and stops it being billed for an
-- athlete who is already paying.  Kiszo's rule, 2026-09-08:
--   "Block the seat while they hold their own paid subscription. After the
--    paid period expires, they can rejoin the seat."
--
-- 1. seat_coach_id - WHO GRANTED THIS ROW, AND THE SAFETY RAIL
--
--    Coach Pro carries $4.99/month per active athlete, but nothing gave the
--    athlete anything: getUserTier() reads subscriptions.plan_name for THAT
--    user, and the seat lived only on the COACH's row. A school paid and the
--    athlete stayed on 'free'.
--
--    A seat athlete now gets their own row, plan_name 'athlete_seat', which
--    getUserTier already resolves to the 'athlete' tier - full athlete access
--    paid by the school, with no client change.
--
--    That means seat code now WRITES to the table the paywall reads, so it
--    needs a hard boundary: seat logic may only ever write or clear a row
--    where seat_coach_id IS NOT NULL. A real paying customer's row has it
--    null and is therefore untouchable by this path. The column is the rail,
--    not the bookkeeping.
--
-- 2. STATUS CASE NORMALISATION - a correctness fix, not tidying
--
--    One row held status 'Active' (capital A):
--      4de20046-6e96-4a17-b9a9-e2f7176735af / beta_elite / 'Active'
--    Every status = 'active' filter in the codebase silently misses it,
--    including syncCoachSeats' own guard, which would have made that coach
--    never sync seats at all.
--
--    It matters most for the new "does this athlete already pay?" test,
--    because a case-sensitive comparison does not fail safe there: it answers
--    "no, they are not paying", and a school is billed for someone who is.
--    The application code compares lower(trim(status)) regardless - this
--    normalisation removes the trap for every OTHER query in the app.
-- ============================================================================

alter table public.subscriptions
  add column if not exists seat_coach_id uuid references auth.users(id) on delete set null;

create index if not exists subscriptions_seat_coach_idx
  on public.subscriptions (seat_coach_id)
  where seat_coach_id is not null;

comment on column public.subscriptions.seat_coach_id is
  'Set when this row is a SCHOOL-GRANTED seat rather than the user''s own subscription, and names the Coach Pro coach paying for it. Seat logic may only write or clear rows where this is NOT NULL - that is what keeps it away from real paying customers'' rows. Null on every self-purchased subscription.';

update public.subscriptions
   set status = lower(btrim(status))
 where status is not null
   and status <> lower(btrim(status));
