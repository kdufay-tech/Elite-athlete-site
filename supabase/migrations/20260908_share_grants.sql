-- ============================================================================
-- 20260908_share_grants.sql
--
-- Athlete-granted recruiting shares: a live, revocable, expiring view of an
-- athlete's record, issued to a named recruiter by email.
--
-- WHAT THIS REPLACES
--   The Recruiting Profile tab builds a card and delivers it as a downloaded
--   PDF or a mailto: body. That is a snapshot pushed out: no expiry, no
--   revocation, no update when the athlete improves, no record that it was
--   ever sent, and no way to know whether anyone opened it. A share grant is
--   the same information as a LINK the athlete still controls.
--
-- ACCESS MODEL (decided 2026-09-08) - link plus email gate
--   The athlete issues a grant to coach@university.edu. Opening the link asks
--   for that address and mails a 6-digit code; the code buys a short viewer
--   session. A forwarded link alone is useless, and the athlete can see that
--   the intended recipient is the one who looked. Requiring recruiters to hold
--   an Elite Athlete account was rejected - college coaches will not sign up
--   to look at one athlete.
--
-- THREE TABLES, THREE JOBS
--   share_grants   the durable permission: who, what window, expiry, revocation
--   share_codes    short-lived one-time codes, rate-limited by `attempts`
--   share_sessions the viewer session a verified code buys
--   Codes and sessions are separate from the grant because they churn and the
--   grant does not; folding them in would mean rewriting the permission row on
--   every login attempt.
--
-- SECURITY POSTURE
--   RLS enabled, ZERO policies on all three - service-role only, matching
--   team_invites and the 2026-09-08 lockdown. Nothing here is client-readable:
--   share_grants.token IS the secret, and a client-side select on this table
--   would hand every athlete's live share links to anyone signed in. The
--   athlete manages grants through an authenticated Netlify function; the
--   recruiter never touches PostgREST at all.
--
--   Codes are stored as a HASH, never plaintext, so a database read cannot be
--   replayed into access.
--
-- CASCADE
--   Grants die with the athlete's account (on delete cascade), and codes and
--   sessions die with the grant. Deleting an account must not leave a live
--   link to a record that no longer exists.
-- ============================================================================

create table if not exists public.share_grants (
  id              uuid primary key default gen_random_uuid(),
  athlete_id      uuid not null references auth.users(id) on delete cascade,
  recipient_email text not null,               -- stored lowercased by the function
  recipient_label text,                        -- "Coach Smith, State U" - athlete's own note
  token           text not null unique,        -- the URL secret
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,        -- default 90 days, set by the function
  revoked_at      timestamptz,
  view_count      integer not null default 0,
  last_viewed_at  timestamptz
);

create index if not exists share_grants_athlete_idx
  on public.share_grants (athlete_id, created_at desc);

create table if not exists public.share_codes (
  id         uuid primary key default gen_random_uuid(),
  grant_id   uuid not null references public.share_grants(id) on delete cascade,
  code_hash  text not null,                    -- sha-256, never the code itself
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,             -- 10 minutes
  attempts   integer not null default 0,       -- brute-force ceiling on 6 digits
  used_at    timestamptz
);

create index if not exists share_codes_grant_idx on public.share_codes (grant_id, created_at desc);

create table if not exists public.share_sessions (
  id         uuid primary key default gen_random_uuid(),
  grant_id   uuid not null references public.share_grants(id) on delete cascade,
  token      text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null              -- 24 hours
);

create index if not exists share_sessions_expiry_idx on public.share_sessions (expires_at);

alter table public.share_grants   enable row level security;
alter table public.share_codes    enable row level security;
alter table public.share_sessions enable row level security;
-- Deliberately no policies. See SECURITY POSTURE above.

comment on table public.share_grants is
  'Athlete-issued recruiting share. token is the URL secret; access additionally requires a one-time code mailed to recipient_email. RLS on with zero policies - service-role only, because a client-readable token is a giveaway of every live share link.';
comment on table public.share_codes is
  'One-time 6-digit codes for share access. Stored as sha-256 hash; 10-minute expiry; attempts caps brute force.';
comment on table public.share_sessions is
  'Viewer session issued after a share code is verified. 24-hour expiry. Expired rows are inert - the reader checks expires_at - and can be swept later.';
