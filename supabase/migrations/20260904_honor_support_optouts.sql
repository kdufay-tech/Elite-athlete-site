-- ============================================================================
-- 20260904_honor_support_optouts.sql
--
-- Honor unsubscribe requests sent to support@elite-athlete.app.
--
-- CONTEXT
--   support@elite-athlete.app received mail from 2026-04 onward that nothing
--   read. The Apps Script ingest (EA Support Ingest, running inside the
--   support@ Workspace account on a 15-minute trigger) now writes every
--   message into public.support_inbound.
--
--   The first ingest surfaced 29 distinct people who had asked to be removed,
--   most on 2026-05-09. None had been suppressed:
--     -  7 were status='active'      -> in the send filter, still receiving mail
--     -  8 were status='unverified'
--     - 14 were absent from coach_contacts entirely
--
--   Cold-email opt-outs must be honored (CAN-SPAM: within 10 business days).
--   These had stood ~4 months.
--
-- WHAT THIS DOES
--   1. Introduces the status value 'unsubscribed'. No schema change is needed:
--      coach_contacts.status is free text with no CHECK constraint, and the
--      send path filters on status='active', so any other value is suppressed.
--   2. Sets status='unsubscribed' on contacts that asked to be removed.
--   3. Inserts opt-outs that are NOT yet in coach_contacts, so the address is
--      permanently on record and a future CSV import cannot resurrect it as
--      active. These carry classification='OPTOUT_SUPPORT_INBOX' and
--      source='support_inbound_optout'.
--
--   Idempotent: re-running changes nothing once support_inbound is unchanged.
--
-- IMPORTANT — NOT COVERED HERE
--   Suppression only holds if the Contacts CSV import does not overwrite
--   `status` on conflict. Verify the import path preserves 'unsubscribed'
--   (and 'bounced'), or these rows will silently return to the sendable pool.
-- ============================================================================

begin;

-- Every distinct address that has ever asked to be removed, per the support inbox.
create temp table _optouts on commit drop as
select lower(from_email) as email,
       min(received_at)::date as asked_on
from public.support_inbound
where classification = 'unsubscribe'
  and from_email is not null
group by lower(from_email);

-- 1. Suppress the ones already on file.
update public.coach_contacts c
set status = 'unsubscribed'
from _optouts o
where lower(c.email) = o.email
  and c.status is distinct from 'unsubscribed';

-- 2. Record the ones that were never on file, so they can never be added back.
insert into public.coach_contacts (email, status, validated, classification, source)
select o.email, 'unsubscribed', false, 'OPTOUT_SUPPORT_INBOX', 'support_inbound_optout'
from _optouts o
where not exists (
  select 1 from public.coach_contacts c where lower(c.email) = o.email
);

commit;

-- ============================================================================
-- VERIFICATION — all three must hold after this migration.
--   still_sendable        = 0   (nobody who opted out is status='active')
--   missing_from_contacts = 0   (every opt-out is on record)
--   suppressed            = optout_people
--
-- Result on 2026-09-04: 29 / 29 / 0 / 0
-- ============================================================================
-- with u as (
--   select distinct lower(from_email) as email
--   from public.support_inbound where classification = 'unsubscribe'
-- )
-- select
--  (select count(*) from u) as optout_people,
--  (select count(*) from u join public.coach_contacts c
--     on lower(c.email) = u.email where c.status = 'unsubscribed') as suppressed,
--  (select count(*) from u join public.coach_contacts c
--     on lower(c.email) = u.email where c.status = 'active') as still_sendable,
--  (select count(*) from u where not exists (
--     select 1 from public.coach_contacts c where lower(c.email) = u.email)
--  ) as missing_from_contacts;
