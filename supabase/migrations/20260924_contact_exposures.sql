-- ============================================================================
-- 20260924_contact_exposures
--
-- WHY
--   Council 2026-09-24 (frequency delta): frequency becomes a LEDGER and a
--   CEILING, not a target. Precondition P1 - before any further touch, one
--   query must return a correct per-contact exposure count reconciling
--   email_events (support@ blasts), lead_events (personal eku@ sends) and
--   phone touches (lead_events, channel='phone'). Lifetime ceiling: 8
--   delivered emails per rolling 12 months, all senders combined. Per-coach
--   cap this sprint: 4 touches (HS) / 2 (D1). Phone only after a reply.
--
-- WHAT
--   1. public.contact_exposures  - one row per lowercased email ever touched
--      by any channel. Service-role only (RLS via underlying tables;
--      lead_events is service-role only, so this view is too).
--   2. public.contact_suppression - one row per email that must never be
--      touched again (STOP / unsubscribe / complaint / hard bounce), any
--      sender. Read before every send and every dial.
--
-- SAFETY
--   Views only; no table changes. Idempotent.
-- ============================================================================

create or replace view public.contact_suppression as
  select lower(email) as email,
         min(created_at)  as first_at,
         array_agg(distinct type) as reasons
  from public.email_events
  where type in ('email.complained','email.bounced','email.unsubscribed')
  group by 1
  union
  select lower(email), min(created_at), array_agg(distinct intent)
  from public.lead_events
  where intent = 'reply_stop' and email is not null
  group by 1;

create or replace view public.contact_exposures as
with blast as (
  select lower(email) as email,
         count(distinct resend_id) filter (where type='email.delivered') as blast_delivered,
         count(distinct resend_id) filter (where type='email.delivered'
               and created_at > now() - interval '12 months')            as blast_delivered_12m,
         max(created_at) filter (where type='email.delivered')          as last_blast_at,
         bool_or(type in ('email.opened','email.clicked'))              as any_open
  from public.email_events
  group by 1
),
human as (
  -- opened/clicked more than 1h after delivery of the same message = a person, not a gateway
  select lower(e.email) as email, bool_or(true) as human_engaged, max(e.created_at) as last_human_at
  from public.email_events e
  join (select lower(email) as email, resend_id, min(created_at) as delivered_at
        from public.email_events where type='email.delivered' group by 1,2) d
    on d.email = lower(e.email) and d.resend_id = e.resend_id
  where e.type in ('email.opened','email.clicked')
    and e.created_at > d.delivered_at + interval '1 hour'
  group by 1
),
personal as (
  select lower(email) as email,
         count(*) filter (where channel='email' and meta->>'kind' like 'followup%' ) as personal_emails,
         count(*) filter (where channel='email' and meta->>'kind' like 'followup%'
               and created_at > now() - interval '12 months')                      as personal_emails_12m,
         count(*) filter (where channel='phone')                                     as phone_touches,
         count(*) filter (where intent in ('reply','reply_yes','reply_not_now','call','demo')) as human_replies,
         bool_or(intent='reply_stop')                                                 as stopped,
         max(created_at) filter (where channel in ('email','phone'))                  as last_personal_at
  from public.lead_events
  where email is not null
  group by 1
)
select coalesce(b.email, p.email)                                    as email,
       c.id                                                          as contact_id,
       c.coach_name, c.school, c.sport, c.level, c.state, c.phone,
       coalesce(b.blast_delivered,0)                                 as blast_delivered,
       coalesce(p.personal_emails,0)                                 as personal_emails,
       coalesce(p.phone_touches,0)                                   as phone_touches,
       coalesce(b.blast_delivered,0) + coalesce(p.personal_emails,0)
                                     + coalesce(p.phone_touches,0)   as total_exposures,
       coalesce(b.blast_delivered_12m,0) + coalesce(p.personal_emails_12m,0) as emails_12m,
       (coalesce(b.blast_delivered_12m,0) + coalesce(p.personal_emails_12m,0)) >= 8 as at_email_ceiling,
       coalesce(h.human_engaged,false)                               as human_engaged,
       coalesce(p.human_replies,0)                                   as human_replies,
       coalesce(p.stopped,false) or s.email is not null              as suppressed,
       greatest(b.last_blast_at, p.last_personal_at)                 as last_touch_at,
       h.last_human_at
from blast b
full join personal p on p.email = b.email
left join human h on h.email = coalesce(b.email,p.email)
left join public.coach_contacts c on lower(c.email) = coalesce(b.email,p.email)
left join public.contact_suppression s on s.email = coalesce(b.email,p.email);

comment on view public.contact_exposures is
  'Per-contact exposure ledger (council 2026-09-24). Read before every send: total_exposures, emails_12m vs ceiling 8, suppressed. Blast = support@ via email_events; personal = eku@ hand-sends logged in lead_events (meta.kind followup*); phone = lead_events channel phone.';
comment on view public.contact_suppression is
  'Emails never to be touched again by any sender: complained, hard-bounced, unsubscribed (email_events) or reply_stop (lead_events).';
