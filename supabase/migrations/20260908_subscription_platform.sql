-- ============================================================================
-- 20260908_subscription_platform.sql
--
-- Adds the column revenuecat-webhook.js has always tried to write.
--
-- THE BUG
--   revenuecat-webhook.js upserts { user_id, plan_name, status,
--   current_period_end, platform: 'ios', updated_at }. subscriptions had no
--   'platform' column, and PostgREST rejects an unknown column outright, so
--   EVERY RevenueCat event failed the upsert, returned 500, and was retried
--   forever against a write that could never succeed.
--
--   Net effect: no App Store or Play Store subscription was ever recorded.
--   getUserTier reads this table, so a phone subscriber would have paid and
--   stayed on the free tier. Found 2026-09-08 while wiring seat resyncs into
--   that webhook; the native builds are still in review, so it is believed to
--   have cost nothing yet.
--
-- WHY ADD THE COLUMN RATHER THAN DELETE THE FIELD
--   Which store a subscription came from is worth knowing on its own - Apple
--   and Google take a cut, refunds behave differently, and a Stripe row and an
--   IAP row otherwise look identical. The webhook's intent was right; the
--   column was simply never created.
-- ============================================================================

alter table public.subscriptions
  add column if not exists platform text;

comment on column public.subscriptions.platform is
  'Where the subscription was bought: ''ios'' / ''android'' via RevenueCat IAP, null for web Stripe checkout. Written by revenuecat-webhook.js, which failed on every event until this column existed.';
