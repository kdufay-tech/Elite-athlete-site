-- ============================================================================
-- 20260908_seat_subscription_tracking.sql
--
-- Track the per-athlete seat subscription in the app, the same way the base
-- subscription is tracked. Kiszo's call, and it is also the fix for two
-- billing defects rather than merely bookkeeping.
--
-- BACKGROUND
--   Coach Pro is $899/year plus $4.99/month per active athlete. Stripe forbids
--   mixing billing intervals in one subscription, so the seats ride a SECOND
--   monthly subscription against the same customer. Nothing in the database
--   recorded that second subscription's id.
--
-- WHAT THAT CAUSED
--   _seat-sync.js found the seat subscription by LISTING the customer's
--   subscriptions with status=active and matching on price id. Two consequences,
--   both charging the coach twice:
--
--   1. RACE ON CREATE. Check-then-create with no stored id and no idempotency
--      key. Two athletes redeeming invites in the same second both see "no seat
--      subscription" and both create one - subscription A qty 1 and
--      subscription B qty 2, billing 3 seats for 2 athletes. It never
--      self-corrects: the lookup breaks on the first match, so every later sync
--      adjusts A while B bills on untouched. Bulk invites (25 codes at once)
--      make this a normal Monday, not a theoretical race.
--
--   2. past_due IS INVISIBLE. The lookup filtered status=active, so a seat
--      subscription whose card failed was not found, and the next roster change
--      created a SECOND one. The coach ends up with a failing subscription and
--      a new one billing alongside it.
--
--   Storing the id fixes both: the sync retrieves that exact subscription in
--   ANY status instead of scanning for an active one.
--
-- ALSO ENABLES
--   Cancelling the seats when the parent subscription ends. Until now nothing
--   did - _seat-sync is only ever triggered by a roster change, and it returns
--   early when the base subscription is not active. A coach who cancelled
--   Coach Pro kept being billed $4.99 per athlete every month, indefinitely.
--   stripe-webhook can now find the seat subscription and cancel it.
-- ============================================================================

alter table public.subscriptions add column if not exists seat_subscription_id text;
alter table public.subscriptions add column if not exists seat_quantity integer not null default 0;
alter table public.subscriptions add column if not exists seat_status text;

create index if not exists subscriptions_seat_sub_idx
  on public.subscriptions (seat_subscription_id)
  where seat_subscription_id is not null;

comment on column public.subscriptions.seat_subscription_id is
  'Stripe id of the SEPARATE monthly per-athlete seat subscription. Stripe forbids mixing intervals, so $4.99/month seats cannot sit on the $899/year subscription. Looked up by id in any status - finding it by listing active subscriptions caused duplicate seat subscriptions on concurrent joins and after a failed payment.';
comment on column public.subscriptions.seat_quantity is
  'Seats last synced to Stripe. Diagnostic: compare against the live active roster to spot a sync that silently failed - _seat-sync never throws, by design, so a billing failure is otherwise invisible.';
comment on column public.subscriptions.seat_status is
  'Stripe status of the seat subscription (active / past_due / canceled ...). A failed seat payment used to surface nowhere: stripe-webhook patches by stripe_subscription_id, and the seat id was never stored, so its events matched zero rows.';
