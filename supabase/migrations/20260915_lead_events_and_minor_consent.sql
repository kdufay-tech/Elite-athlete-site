-- ============================================================================
-- 20260915_lead_events_and_minor_consent
--
-- WHY
--   602 coaches "raised a hand" between Aug 12 and Sep 7 and the company kept
--   none of them: coach_waitlist has 0 rows because the front end reported
--   success on a swallowed catch. The council (2026-09-10, reaffirmed
--   2026-09-15) made an append-only ledger the first gate before any send:
--   every raised hand - form, reply, call, checkout, share-link open - becomes
--   a row here, and a daily canary proves the write path is alive.
--
--   The same review found signup captures NO date of birth and NO parent
--   email, while the sprint moves recruiting share links to the $29 tier and
--   to coach-paid seats - i.e. 13-17-year-olds' records on a parent's card.
--   COPPA (<13) and parental-consent records need columns to live in.
--
-- WHAT
--   1. public.lead_events  - append-only, service-role only (RLS on, no
--      policies). Written by: lead-capture, coach-waitlist, stripe-webhook,
--      share-view, lead-canary. Read by: admin (service role).
--   2. profiles.dob, parent_email, consent_at, consent_ip.
--
-- SAFETY
--   Additive only. No existing column changes. profiles.age is kept (free
--   text) and continues to be written; dob is the authoritative field once
--   present. Idempotent (IF NOT EXISTS everywhere).
-- ============================================================================

create table if not exists public.lead_events (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),
  email          text,                       -- always stored lowercased/trimmed
  contact_id     uuid references public.coach_contacts(id) on delete set null,
  user_id        uuid references auth.users(id) on delete set null,
  source         text not null,              -- 'coach_waitlist' | 'lead_form' | 'stripe' | 'share_view' | 'gmail' | 'phone' | 'canary' | ...
  channel        text,                       -- 'web' | 'ios' | 'android' | 'email' | 'phone' | 'in_person'
  intent         text not null check (intent in (
                   'raised_hand','reply','reply_yes','reply_not_now','reply_stop',
                   'call','demo','checkout_started','paid','objection',
                   'coach_opened_share','share_created','invite_redeemed',
                   'spring','club','canary','note')),
  message_id     text,                       -- RFC-5322 Message-ID of the email this row records, when it records one
  verbatim       text,                       -- the reply / objection, word for word
  meta           jsonb not null default '{}'::jsonb,
  owner          text not null default 'kiszo',
  next_action    text,
  next_action_at timestamptz
);

create index if not exists lead_events_email_idx      on public.lead_events (lower(email), created_at desc);
create index if not exists lead_events_created_idx    on public.lead_events (created_at desc);
create index if not exists lead_events_intent_idx     on public.lead_events (intent, created_at desc);
create index if not exists lead_events_contact_idx    on public.lead_events (contact_id) where contact_id is not null;
create index if not exists lead_events_next_action_idx on public.lead_events (next_action_at) where next_action_at is not null;

alter table public.lead_events enable row level security;
-- Deliberately no policies: service-role only. A client-writable lead ledger
-- would let anyone forge "paid" rows; a client-readable one leaks every coach
-- who ever replied.

comment on table public.lead_events is
  'Append-only capture ledger. Every raised hand (form, reply, call, checkout, share-link open) is one row. Service-role only. The weekly count from this table is the only traction figure anyone may quote (council 2026-09-10).';

-- Sub-D1 college list, built passively: every distinct domain a coach opened
-- an athlete share link from. Zero cost, outside the cold-email pause.
create or replace view public.share_open_domains as
  select lower(split_part(email,'@',2)) as domain,
         count(*)                        as opens,
         count(distinct lower(email))    as coaches,
         min(created_at)                 as first_open,
         max(created_at)                 as last_open
  from public.lead_events
  where intent = 'coach_opened_share' and email is not null
  group by 1;

-- ── Minor consent fields on profiles ────────────────────────────────────────
alter table public.profiles add column if not exists dob          date;
alter table public.profiles add column if not exists parent_email text;
alter table public.profiles add column if not exists consent_at   timestamptz;
alter table public.profiles add column if not exists consent_ip   text;

comment on column public.profiles.dob          is 'Date of birth. Under-13 accounts are refused at onboarding (COPPA). Authoritative over the legacy free-text age.';
comment on column public.profiles.parent_email is 'Required when dob puts the athlete at 13-17. The only address a payment ask may be sent to for a minor.';
comment on column public.profiles.consent_at   is 'When the athlete/parent completed onboarding with dob (and parent_email if a minor). Consent log, not marketing consent.';
comment on column public.profiles.consent_ip   is 'Set server-side when available; nullable.';
