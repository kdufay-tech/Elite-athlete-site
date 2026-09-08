# Elite Athlete — Project State
> Last updated: 2026-09-07
> Always update this file at the end of each session before closing.

---

## Deployment

| Item | Value |
|------|-------|
| Netlify site | the-elite-athlete |
| Netlify site ID | `379f18e6-ffe0-4b1a-bd0f-2d58ee827d6a` |
| Live URL | https://the-elite-athlete.netlify.app / https://elite-athlete.app |
| GitHub repo | https://github.com/kdufay-tech/Elite-athlete-site |
| Deploy method | Local: `.\DEPLOY.ps1` (has site ID baked in) OR drag `dist` to Netlify |
| Build command | `npm run build` → outputs to `dist/` |

## Credentials (do not share publicly)
| Service | Key/Token |
|---------|-----------|
| GitHub PAT | `[GITHUB_PAT — store in password manager]` |
| Netlify token | `[NETLIFY_TOKEN — store in password manager]` (new, full access) |

## Netlify Environment Variables (set in Netlify UI)
All vars set under: Netlify → the-elite-athlete → Site configuration → Environment variables

| Variable | Value | Notes |
|----------|-------|-------|
| `VITE_BETA_MODE` | `true` | Enables test mode |
| `VITE_STRIPE_TEST_PUBLISHABLE_KEY` | `pk_test_...` | Stripe test publishable key |
| `VITE_STRIPE_TEST_PRICE_ATHLETE_ANNUAL` | `price_1TMqjyEJzVyHAKH8LoSKMnXG` | ✅ Set Apr 20 |
| `VITE_STRIPE_TEST_PRICE_ATHLETE_MONTHLY` | `price_1TMqj1EJzVyHAKH82JWemPQQ` | ✅ Set Apr 20 |
| `VITE_STRIPE_TEST_PRICE_ELITE_ANNUAL` | `price_1TMqiIEJzVyHAKH8CzFdh0Cn` | ✅ Set Apr 20 |
| `VITE_STRIPE_TEST_PRICE_ELITE_MONTHLY` | `price_1TMqhNEJzVyHAKH8vfPfYUow` | ✅ Set Apr 20 |
| `VITE_STRIPE_WEBHOOK_SECRET` | `whsec_...` | Stripe webhook secret |
| `STRIPE_SECRET_KEY` | `sk_test_...` | Server-side only (Netlify function) |
| `VITE_SUPABASE_URL` | `https://[project].supabase.co` | |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | |
| `RESEND_API_KEY` | `re_...` | **Must be a key from the `taratechent` Resend workspace.** Used by all 10 mail-sending functions. |
| `RESEND_WEBHOOK_SECRET` | `whsec_...` | Verifies the Resend webhook that writes `email_events`. |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-side only. |

## Email & Transactional Mail  (config-of-record)

> Added 2026-09-07 after a 4.5-month silent outage. This section exists so an email
> misconfiguration is visible in a diff instead of only in a Supabase error log.

**Two independent Resend credentials. They are not interchangeable.**

| Path | Credential | Set in | Sends |
|------|-----------|--------|-------|
| Netlify Functions | `RESEND_API_KEY` env var | Netlify UI | blasts, welcome-email, coach-nudge, coach-ops-weekly, beta-* |
| Supabase Auth | SMTP password | Supabase Dashboard -> Auth -> SMTP | password reset, email confirmation |

**Both keys MUST come from the `taratechent` Resend workspace** - that is the only
workspace where `elite-athlete.app` is verified. A key minted in any other workspace
authenticates successfully and then fails every send with:

```
550 "The elite-athlete.app domain is not verified."
```

That is exactly what happened: Supabase held a key from the `taradomemusik` workspace
(zero verified domains) from approx. 2026-04-17 until 2026-09-07. Password reset was
dead the entire time and nobody noticed, because email confirmation is disabled so
signups never needed it.

### Supabase Auth SMTP
```
Host          smtp.resend.com
Port          465
Username      resend
Password      <Resend API key, taratechent workspace, scoped to elite-athlete.app>
Sender email  support@elite-athlete.app
Sender name   Elite Athlete
```

### Sender addresses in code
| Address | Used by |
|---------|---------|
| `support@elite-athlete.app` | 8 functions + Supabase auth mail |
| `kiszo@elite-athlete.app` | `beta-expiry-reminder.js` |

### DNS (Cloudflare, zone elite-athlete.app)
| Record | Value |
|--------|-------|
| `resend._domainkey` TXT | Resend DKIM public key |
| `send` TXT | `v=spf1 include:amazonses.com ~all` |
| `send` MX | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
| `_dmarc` TXT | `v=DMARC1; p=none; rua=mailto:support@elite-athlete.app` |

### EmailJS (separate provider, still in use)
`coach-waitlist.js`, `send-beta-invite.js`, `src/lib/email.js`. Unrelated to Resend -
changing one does not affect the other.

### Sending-domain split - REQUIRED, do not collapse

| Stream | Domain | Resend click/open tracking |
|--------|--------|----------------------------|
| Auth (reset, confirmation) | `auth.elite-athlete.app` | **OFF - permanently** |
| Marketing (blasts, broadcasts) | `elite-athlete.app` | on |

**Click tracking must NEVER be enabled on the auth domain.** With it on, Resend
rewrites the reset link to:

```
https://links.elite-athlete.app/CL0/<url-encoded supabase.co verify link>/1/<token>
```

Two consequences, both observed on 2026-09-07:

1. Gmail shows **"This message might be dangerous"** - a redirector on one domain
   wrapping a URL-encoded foreign domain, around a credential link, is the shape
   of an open-redirect phishing attack.
2. Mail security scanners prefetch links. Supabase `/auth/v1/verify` consumes the
   single-use token on first GET, so a scanner can **burn the reset before the
   user clicks it**. School/district mail gateways scan aggressively, and coaches
   are exactly who sits behind them.

`links.elite-athlete.app` resolves to `links1.resend-dns.com` -> CloudFront. That
CNAME existing on the apex is what tracking uses; the auth subdomain must not
have it.

The split also insulates auth deliverability from outreach reputation. On
2026-08-24 the apex sent 2,289 with 82 bounces and 1 complaint. Before the split,
the password reset landed in **spam** for exactly that reason.

**When email blasts are reinstated:** turn tracking back on for `elite-athlete.app`
only. It is a per-domain setting, so this has no effect on auth mail. Do not
re-enable it on `auth.elite-athlete.app` to "get reset metrics" - there are none
worth having, and it silently re-breaks password reset.

**API keys are domain-scoped.** A key scoped to `elite-athlete.app` cannot send
from `auth.elite-athlete.app`; it fails at send time, which looks like a DNS
problem and is not. Supabase SMTP uses a key scoped to the auth domain.

### Password-reset flow  (end-to-end, verified 2026-09-07)

```
Forgot password?  -> Supabase /recover
                  -> Resend SMTP, no-reply@auth.elite-athlete.app
                  -> email: supabase/email-templates/recovery.html
                  -> link: <project>.supabase.co/auth/v1/verify?type=recovery
                           &redirect_to=https://elite-athlete.app     (NO links. wrapper)
                  -> app boots, lib/supabase.js reads type=recovery from the
                     boot URL BEFORE createClient clears it
                  -> SET A NEW PASSWORD modal, nothing else on screen
                  -> save  ->  toast  ->  dashboard
                     cancel ->  signOut() -> landing
```

**Why the boot-URL marker and not the PASSWORD_RECOVERY event.** supabase-js
emits PASSWORD_RECOVERY during its own async init, before App.jsx subscribes via
onAuthChange inside useEffect. Only INITIAL_SESSION is replayed to late
subscribers, so that event was always missed and the reset link simply signed
the user into the dashboard. `arrivedFromRecoveryLink` in lib/supabase.js is
timing-independent and cannot race.

**Why the cancel button signs out.** The recovery link exchanges its token for a
full, ordinary session. Reaching the modal proves control of the MAILBOX, not
knowledge of the password. Dismissing without setting one would hand full app
access to whoever opened the email. The only exits are: set a new password, or
sign out. Do not add a plain dismiss.

**Password rules.** The modal uses validatePassword() exported from
AuthModal.jsx - 8+ chars, upper, lower, number, special - the same rules as
signup.

All three places a password can be set - signup, the recovery modal, and the
Profile tab's Account panel - now call the same validatePassword(). Do not
reintroduce a separate rule in any of them.

### Email templates
Supabase email templates live only in the dashboard, so they are mirrored in
`supabase/email-templates/`. Edit the file, then paste it into
Auth -> Email Templates. The stock Supabase recovery template was replaced on
2026-09-07: it had no sender identity, no expiry, no "ignore this" line, and hid
the destination behind a bare link.

### How to verify email end-to-end
```sql
-- did Supabase actually send?
select max(recovery_sent_at) from auth.users;
-- did Resend accept and deliver?
select created_at, type, email, raw->'data'->>'subject'
from email_events order by created_at desc limit 10;
```
A working reset produces `email.sent` AND `email.delivered` within ~2 seconds.

---

## Payments - plan/price binding  (security, fixed 2026-09-07)

`netlify/functions/_plan-map.js` is the single server-side source of truth for
price ID -> plan name. **Never derive a plan from anything the client sends.**

What was wrong: stripe-checkout.js took `priceId` AND `planName` from the request
body. VALID_PLAN_NAMES checked the name against a known set but never against the
price, and wrote it into `subscription_data.metadata.plan_name`. stripe-webhook.js
read that metadata first and stored it as `subscriptions.plan_name`, which
`getUserTier()` turns into the user's tier.

A POST with the ATHLETE price ID and `planName: "coach"` therefore produced a
genuine, fully-paid $29/mo subscription tagged `coach` - Coach Pro ($99/mo +
$4.99/athlete) for athlete money. The endpoint has NO authentication, and all
seven price IDs ship in the public client bundle.

Verified 2026-09-07: no subscription row was ever created this way. Live since
at least May; only became worth exploiting when Coach Pro went purchasable
earlier the same day (2bb3896).

Now: checkout derives the plan from the price being charged, refuses an
unrecognised price, and logs any client/price disagreement. The webhook derives
from the subscription's actual price ID and uses metadata only as a fallback for
rows created before this change.

### A retired price was still buyable  (fixed 2026-09-08)
`_plan-map.js` carried a comment claiming that leaving COACH_MONTHLY out of
PLAN_BY_PRICE made checkout "REFUSE the price even if it is still Active in
Stripe". **It did not.** An unmapped price falls through to
`planFromStripePrice`, which reads the price NICKNAME - and a nickname containing
"coach" without "annual" resolved to `'coach'`. The retired $99/mo Coach Pro was
therefore still buyable by anyone holding that price id, and `plan_name='coach'`
carries NO seat billing, so it would have sold unlimited athletes for $99/month.

Two layers now: `RETIRED_PRICES` blocks that id in both lookup paths, and
`planFromStripePrice` refuses ANY price with `active:false` - so a future
retirement needs no code edit. The price is also archived in Stripe.

### Still open on this endpoint
`stripe-checkout` has no caller authentication, and stripe-webhook attributes the
subscription via the client-supplied `customer_email` rather than
`client_reference_id` (which is sent but unused). Neither lets anyone obtain a
tier they have not paid for now that the plan is price-derived, but a caller can
still direct a subscription they pay for at an email they do not control.

---

## Per-athlete seat billing  (built 2026-09-07)

| Plan | Base | Seats |
|------|------|-------|
| Coach Pro annual (`coach_annual`) | $899/yr | **+ $4.99 per active athlete per month** |
| Coach Pro monthly (`coach`) | RETIRED 2026-09-07 | not sellable |
| `coach_comp` | comp | never billed |

`planHasSeats()` returns true for `coach_annual` ONLY. An earlier version of this
table said the opposite - monthly carried the seats and annual was flat. That was
wrong from 2026-09-07 onward and is the kind of doc rot that produces a real
billing bug, so check `_plan-map.js` before trusting any pricing written here.

Stripe requires every item in one subscription to share a billing interval, so a
$4.99/MONTH seat cannot be a line item on the $899/YEAR base. The seats therefore
ride a SECOND monthly subscription against the same Stripe customer, tracked by
`subscriptions.seat_subscription_id`. The coach sees one annual charge and one
monthly charge that follows headcount.

**What was wrong.** The UI advertised "+$4.99/athlete/month" but
`stripe-checkout.js` sent a single line item at quantity 1 and nothing anywhere
added a seat item or moved its quantity. Coaches were billed a flat $99 no
matter how large the roster. Three different and mutually inconsistent annual
figures also existed: $4.99/athlete/month (stripe.js), $3.33/ath/mo (App.jsx),
$39.99/athlete/year (the waitlist email). All are now gone.

**How it works.** `_seat-sync.js` recomputes from the roster - it never adjusts
by a delta - so a missed sync self-heals on the next roster change. It counts
DISTINCT `team_members.athlete_id` where `coach_id = X and status = 'active'`,
then converges the Stripe subscription: adds a seat item, changes its quantity,
or deletes it at zero. Stripe prorates each change.

Called from all three roster mutation points in `coach-team.js`: **join**
(athlete uses a code), **leave** (athlete removes self - the coach_id is read
BEFORE the delete, or it is unrecoverable), and **remove** (coach removes an
athlete). Adding a fourth mutation path without a sync call is how this drifts.

Failures are logged and swallowed. A Stripe outage must never stop an athlete
joining a team.

### Rebuilt 2026-09-08 - four ways it charged the wrong amount

1. **Cancelling Coach Pro never cancelled the seats.** `syncCoachSeats` only runs
   on a roster change and returns early once the base subscription is inactive,
   so NO path could reach the seat subscription after a cancellation. The coach
   saw "cancelled" while Stripe billed $4.99 x roster every month, forever.
   `stripe-webhook.onSubDeleted` now calls `cancelCoachSeats()`.
2. **Concurrent joins created duplicate seat subscriptions.** Check-then-create
   with nothing stored and no idempotency key: two athletes redeeming invites in
   the same second each created one (A qty 1 + B qty 2 = 3 seats for 2 athletes),
   and it never self-corrected because the lookup broke on the first match.
   Now: lookup by stored id, plus a Stripe idempotency key on create.
3. **`past_due` was invisible** - the old lookup filtered `status=active`, so a
   seat subscription with a failed card was not found and the next roster change
   created a second one beside it. Now retrieved by id in any live status.
4. **A failed SEAT invoice marked the COACH'S PLAN `past_due`**, stripping a
   paid-up coach's access over a $4.99 decline. Seat events now route by
   `seat_subscription_id` and never touch the plan row.

### School seats now grant access  (2026-09-08)
Until this, a school paid $4.99/athlete and the athlete got NOTHING: `getUserTier()`
reads `subscriptions.plan_name` for THAT user, and the seat lived only on the
coach's row. Seat athletes now get their own row with `plan_name='athlete_seat'`,
which `getUserTier` already resolves to the athlete tier - full athlete access
paid by the school, no client change.

`subscriptions.seat_coach_id` is the safety rail, not bookkeeping: seat logic may
only write or clear rows where it is NOT NULL. A self-purchased subscription has
it null and is untouchable by that code path.

**Kiszo's rule, 2026-09-08:** block the seat while an athlete holds their own live
access; when that period expires they roll onto the seat. Comped and beta plans
count as live access - a school pays nothing for an athlete who already has it.

The rejoin needs no cron. Stripe sends `customer.subscription.deleted` when a
period actually ends (including `cancel_at_period_end`, at the end, not when it is
set), `checkout.session.completed` when they buy their own, and RevenueCat sends
ACTIVE/EXPIRATION for IAP. All four call `resyncCoachesOfAthlete()`, which
recomputes from scratch. It works in reverse too: an athlete on a seat who buys
their own subscription drops off the school's bill on the same event.

### Still not reconciled
A roster-change sync that fails silently still leaves `seat_quantity` stale if
that coach never changes their roster again. `seat_quantity` / `seat_status` are
written on every sync precisely so the drift is DETECTABLE - a row disagreeing
with the live roster is a sync that has been failing unnoticed. Scheduled
functions remain paused by the council decision, so this stays manual.

### Known edge, accepted
An athlete on two Coach Pro rosters bills BOTH schools. Each pays for their own
roster, and the cleanup pass hands the access grant to the other coach rather
than cutting the athlete off. If only one school should pay, that is a rule
change, not a bug fix.

---

## Adding athletes to a team  (built 2026-09-07)

Two ways in. Both land on the same `team_members` insert and the same seat sync.

| | Default | Reuse | Expiry | Revocable |
|---|---|---|---|---|
| Per-athlete invite (`team_invites`) | **the norm** | single use | 14 days | yes |
| Shared team code (`teams.join_code`) | **OFF** | unlimited | never | rotate only |

**Why the shared code is opt-in.** It used to be the only way in: permanent,
unrotatable, no approval, no cap. Anyone holding it joined instantly. That was
harmless while a roster cost nothing - it stopped being harmless the moment
per-athlete billing went in, since a leaked code became an uncapped recurring
charge on the coach's card. It survives for onboarding a squad in one room;
`join_code_enabled` gates it and `rotate_code` kills a leaked one instantly.

**Roster caps are spend ceilings.** `teams.level` drives them, and the client
mirror in `CoachRoster.jsx` (`LEVELS`) must stay in step with `ROSTER_CAPS` in
`coach-team.js`:

```
hs 55 = $274/mo    college 150 = $748/mo
pro 250 = $1,247/mo   youth 500 = $2,495/mo
```

An unset level gets the SMALLEST cap, not none. `invite_create` counts
outstanding invites as future seats and will not mint past the cap.

**Actions** (`coach-team.js`): `invite_create` (<=25, optional labels),
`invite_list` (paginated, exact count), `invite_revoke`, `rotate_code`,
`toggle_code`.

**Backward compatible with shipped iOS/Android:** they post
`{action:'join', code}` and read `team.join_code`. Their open code is simply
rejected until a coach enables it. Older builds have no invite UI - coaches on
them must use the web app to generate codes.

---

## Athlete career record  (built 2026-09-07)

An athlete's data already belongs to the athlete: all eleven data tables key to
`user_id`, not to a team or a coach, so the record travels with them from high
school to college to pro by construction.

**The problem it solves.** Every loader in `src/lib/supabase.js` filters to the
last three months. The rows live in Postgres forever, but nothing older than 90
days is visible to anyone - so a four-year career simply cannot be seen.

**The shape: pagination first, aggregation on demand.**

| Action | Returns |
|--------|---------|
| `summary` | ONE ROW PER MONTH via `athlete_history_summary()`. Four years = 48 rows. |
| `page` | raw rows for ONE table and ONE window, limit/offset, exact count, max 100 |

`netlify/functions/athlete-history.js`. Never loads a whole table, and the
90-day working window on the dashboard is untouched - this is a separate read
path, not a widening of the existing one.

**Authorisation.** `verifyCaller` establishes who is asking and every query is
pinned to THAT id. `p_user_id` is never read from the request body, so an
athlete can only ever fetch their own record. Table names come from a
whitelist, so nothing uncontrolled reaches the URL.

**Aggregates on `created_at`, not `date`.** Only `check_ins.date` is a real
DATE; `workout_logs`, `nutrition_logs`, `weight_logs` and `benchmarks` all store
`date` as TEXT with no enforced format.

**Readiness is not computed in SQL.** The formula already exists twice -
`computeReadiness()` in `_coach-auth.js` and the Postgres copy inside
`coach_roster_page()`. The summary returns raw component averages and the client
applies the formula it already owns; a third copy would drift.

### Built 2026-09-08
`team_members` is now soft-deleted (`left_at` + `status='departed'`), which
unblocked both follow-ups:

**Coach tenure scoping** (`coach-history.js`, `CoachAthleteHistory.jsx`) - a coach
sees the period they actually coached the athlete, plus a summary of what came
before. Access ends at departure.

**Recruiting shares** (`share-manage.js`, `share-view.js`, `ShareManager.jsx`,
`SharedProfile.jsx`, `/s/<token>`) - the athlete issues a private link to one
named coach. The recipient must enter the email the link was issued to and
exchange a 6-digit code (sha-256 stored, 10-minute TTL, 5-attempt cap) for a
24-hour viewer session. 90-day default expiry, revocable, view-counted.

`share_grants` has RLS on with ZERO policies - the service-role function is the
only way in, because a client-readable `share_grants` would hand out every live
share token in the system. Failure responses are deliberately identical whether
the token is unknown, expired, revoked, or the email simply does not match;
otherwise the endpoint is an oracle for who an athlete is talking to.

---

## Tech Stack
- React + Vite
  - Windows: `C:\Users\kdufa\App Development\Elite Athlete\elite-athlete-v3`
  - Mac: `/Users/taradomeentertainmentgroup/App Development/elite-athlete-v3`
- Supabase (auth + Postgres + RLS), Stripe, RevenueCat, Resend, EmailJS, jsPDF
- Capacitor: web / iOS / Android from one codebase. `android/` and `ios/` are both tracked in git.
- Netlify Functions: 45 in `netlify/functions/`. `ls netlify/functions` is the source of truth;
  10 of them send mail (see Email section above).
- EmailJS template ID: `template_b4rv0ur` (Contact Us type)
- Test account: Emeka Ugokwe (username: kdufay)

## App Structure
- Main file: `src/App.jsx` (~12,520 lines, one App() component, ~90 useState)
- Components (`src/components/`): AICoachConsentModal, AthleteDetail, AthleteRecord,
  AuthModal, CheckoutModal, CoachAthleteHistory, CoachRoster, DeleteAccountModal,
  IOSPaywall, JoinTeam, PayModal, PracticeBoard, ReadinessChart, ShareManager,
  SharedProfile, TeamPrograms
- Pricing lib: `src/lib/stripe.js`

## Pricing (4-tier)
| Tier | Monthly | Annual | Notes |
|------|---------|--------|-------|
| Free | $0 | $0 | |
| Athlete | $29/mo | $199/yr | Save $149/yr — 43% off |
| Elite | $69/mo | $529/yr | Save $299/yr — 35% off |
| Coach Pro | RETIRED | $899/yr | **+ $4.99/athlete/mo.** Annual only. Live, web purchase only. |

---

## Bug Fix Log

### Session Apr 20 2026
| # | Bug | Status | Commit |
|---|-----|--------|--------|
| 1 | $529 price wrong | ✅ Not a bug — math correct | — |
| 2 | Nav tile labels clipping (`'ERFORMANCE`) | ✅ Fixed | `c49fa35` |
| 3 | Check-in score values clipping on mobile | ✅ Fixed | `c49fa35` |
| 4 | Camera stuck "Starting Camera…" | ✅ Fixed (8s timeout) | `c49fa35` |
| 5 | Height shows `0'6.1"` | ✅ Fixed | `c49fa35` |
| 6 | Duplicate Collagen supplements | ✅ Fixed | `c49fa35` |
| 7 | Supplement daily schedule truncated right on mobile | ✅ Fixed | `58f8e21` |
| 8 | Mobile right-side cutoff globally (Notifications, Recruiting, etc.) | ✅ Fixed — global `g2mob`/`g4mob` CSS + overflow-x:hidden | `6d2cbef` |
| 9 | Nutrition log macro bar 4-col overflow on mobile | ✅ Fixed — `g4mob` → 2x2 | `45f28a0` |
| 10 | Stripe price IDs missing for Athlete/Elite | ✅ Price IDs obtained, needs Netlify env var set | See above |

### Session Sep 7 2026
| # | Bug | Status | Notes |
|---|-----|--------|-------|
| 1 | Password reset email never sent (since ~Apr 17) | Fixed | Supabase SMTP held a Resend key from the wrong workspace. See Email section. |
| 2 | Reset link signed user straight into dashboard, no password prompt | Fixed | supabase-js emits PASSWORD_RECOVERY before App.jsx subscribes; event never replayed. Replaced with a boot-URL marker (`arrivedFromRecoveryLink`) read before createClient. |
| 3 | 15 stale .png launcher icons duplicated the tracked .webp resources | Fixed | Same resource name in the same mipmap folder - an aapt2 duplicate-resource hazard. Moved to `_to_delete/`. |
| 4 | Auth mail lands in Gmail spam | Open | Shares the cold-outreach sending identity. See Email section. |

### Remaining Bugs (from bug list doc)
- [ ] Tile backgrounds not loading after dashboard launch
- [ ] Free trial needs email step
- [ ] Nutrition manual entry / food search
- [ ] Workout phase highlight doesn't follow active week
- [ ] Saturday locked in schedule — can't edit
- [ ] Edited schedule doesn't update weekly section
- [ ] High-risk injuries check across all sports (not just football)
- [ ] AI Coach check-in truncated — needs full screen
- [ ] Progress photo needs Accept/Done button to confirm save
- [ ] Coach Connect screen blank
- [ ] Journal bottom link broken
- [ ] Beta Elite renewal date wrong (shows Mar 1 2026)
- [ ] Free option → sends to $529 Elite checkout (should be free/beta)
- [ ] Admin interface needs mobile support
- [ ] All tiles lose backgrounds after dashboard launch

---

## Row-level security lockdown  (2026-09-08)

Every paid tier was **self-grantable from the browser**: `subscriptions` was
client-writable, so any authenticated user could insert their own row with
`plan_name='coach_annual'` and `getUserTier()` would hand them Coach Pro. Deleting
a team also hard-destroyed roster history, and `team_members` was client-writable
so any user could join any team or delete a membership.

Seven tables now carry **zero client write policies** - all writes go through
service-role functions. Migrations: `20260908_team_members_rls_lockdown`,
`20260908_rls_write_lockdown`, `20260908_teams_rls_lockdown`.

Note the PostgREST/RLS trap this exposed: an `ALL` policy with only `USING` and no
`WITH CHECK` applies that same expression as the INSERT/UPDATE check - which reads
like a read rule but silently authorises writes.

---

## Stripe Tax  (wired 2026-09-08, OFF)

**$0 tax has been collected on every subscription ever sold.** `automatic_tax`
appeared nowhere in the checkout payload. The prices are `tax_behavior: Exclusive`,
which reads like tax was being added - but Exclusive only means "add tax IF tax is
calculated". Nothing calculated it, so the setting was inert.

`_tax.js` holds the switch. Everything is gated on `STRIPE_TAX_ENABLED`, which is
**not set**, so behaviour is byte-for-byte unchanged until it is.

Three things had to be enabled together, which is why they live in one function:
- `automatic_tax` - the calculation
- `billing_address_collection: 'required'` - it was `'auto'`, which only asks when
  the payment method demands it, and cards usually do not, leaving Stripe with no
  location to tax
- `customer_update: {address:'auto'}` - **Checkout REJECTS a session** that sets
  `automatic_tax` while reusing an existing `customer` without it. Enabling tax
  without this breaks checkout for every returning customer.

Plus `tax_id_collection`, so an exempt school enters its number rather than being
charged tax on $899 and refunded by hand. The seat subscription is created
directly against `/v1/subscriptions`, not through Checkout, so it carries its own
`automatic_tax` - miss that and the $899 is taxed while the $4.99/athlete is not.

Account state as of 2026-09-08: head office Georgia, registered in Georgia since
2026-04-22, preset product category "Software as a service", tax behavior
Automatic. Georgia does not tax SaaS (it taxes tangible personal property; DOR
rulings LR SUT 2014-01 / 2014-05), so the real value of enabling this is
**threshold monitoring** - nothing currently watches economic nexus in states that
DO tax SaaS (NY, TX, PA, WA). Registration decisions are Kiszo's accountant's, not
a code decision.

To turn on: set `STRIPE_TAX_ENABLED=true` in Netlify, redeploy, then test one
checkout **as a returning customer** - that is the path that would break.

---

## Native releases

| | iOS | Android |
|---|---|---|
| Live | 1.0.5 (build 17) | 1.0.5 (versionCode 11) |
| In review | **1.0.6 (18)** - carries the localhost share bug below | - |
| Device-tested, ready | - | **1.0.6 (vc13)** - fix verified, coach + athlete accounts |

iOS build 18 went to App Review BEFORE the localhost share-link bug was found,
so it contains it. Android vc12 did too and was replaced by vc13. Decide
whether to let 18 ship and follow with 1.0.7, or reject and resubmit.

Both live 1.0.5 builds embed web code from **2026-09-04** (Android 17:55, iOS
21:26 ET). 28 `src/` commits landed after that, so the live apps are missing the
account-switch fix - and that one is not a missing feature: a 09-04 client writes
the PREVIOUS account's profile over the new account's, **server-side**, wherever a
user has more than one account on a device. That is the reason to update.

**Verify a native build from the artifact, not only the device.** The synced
bundle is ground truth:
- iOS: `ios/App/App/public/assets/index-*.js`
- Android: `android/app/src/main/assets/public/assets/index-*.js`
Compare it byte-for-byte against `dist/`, then grep it for what you expect to be
present or absent. This caught more than the on-device pass did.

Two builds of the same commit on different machines produce **different hashes** -
Vite inlines `VITE_*` at build time and the two machines' `.env.local` differ
(the Mac has `VITE_REVENUECAT_APPLE_KEY`, Windows does not: 34 chars vs `void 0`
= exactly the 28-byte delta observed). Harmless here because RevenueCat is gated
to iOS and iOS is built on the Mac. Do not assume identical output.

Careful with PowerShell verification: **`-AllMatches` is ignored when you pass
`-SimpleMatch`**, so `$_.Matches.Count` returns 0 even when the text is present.
Use `[regex]::Matches($c, '...')` on `Get-Content -Raw` instead.

### Share links must never use window.location.origin  (fixed 2026-09-08)

A recruiting share created in the Android app produced
`https://localhost/s/<token>`, and the QR encoded the same string, so the coach
who scanned it got ERR_CONNECTION_REFUSED. One defect, both symptoms.

Capacitor serves the bundled app from its OWN scheme - `https://localhost` on
Android (androidScheme "https"), `capacitor://localhost` on iOS. Both are
internal to the device, so any link built from `window.location.origin` is
unreachable by anyone, including the person who created it.

**It passed testing that morning because the testing was on the WEB**, where
`window.location.origin` is the correct answer. Verifying a native-facing
feature on the web verifies nothing about this class of bug.

`src/lib/appUrl.js` is now the single source for any URL that LEAVES the device.
`window.location.origin` is acceptable ONLY for something the same device will
consume. The same defect was fixed in AuthModal (Supabase `redirectTo`, which
made password-reset links from a native build unopenable). PayModal and App.jsx
still build Stripe URLs that way, but `stripe-checkout.js` hardcodes them
server-side and ignores the client's, so those are inert - left alone rather
than made to look fixed.

Also: `nativeShare` was passed the url as BOTH `text` and `url`; Android's share
sheet concatenates them, which printed the link twice in the email.

### Android has no Play Billing
`CheckoutModal.jsx` routes iOS to the RevenueCat paywall and **Android to
`PayModal` -> Stripe Checkout**, same as web. Android users therefore leave the
app to a browser to subscribe - a real conversion cost, and it was a default
rather than a decision (the Apple constraint was applied only to iOS).

Google's US policy since 2025-10-29 no longer prohibits alternative in-app
payments or external links (Epic injunction, upheld by the Ninth Circuit
2025-09-12). Two programs opened 2025-12-09, and from **2026-10-01** enrolled
developers must report transactions and pay Google a service fee.

Not built. The decision is Play Billing (~15% of Android subscription revenue,
no hop) versus staying on Stripe (~3% + a Google service fee from October, plus
the hop). Coach Pro stays web-only either way - Play Billing cannot bill $4.99 x
a changing roster.

### Runtime CDN loads - App Review 2.5.2 exposure
`ShareManager` used to fetch the QR library from `cdn.jsdelivr.net` at runtime,
justified by "the CSP in netlify.toml allows it" - reasoning that only ever
covered the website. Bundled as an npm dependency 2026-09-08.

**`AdminDashboard.jsx` still does this for `xlsx` and `pdfjs`.** Present since
2026-08-25 and already approved in build 17 and vc11, so it is not a new risk -
but it is downloaded executable code in a shipped app. Preferred fix is to
exclude the admin dashboard from native builds entirely rather than bundle ~1MB
of libraries into a phone app.

---

## Account-switch data corruption  (fixed 2026-09-08)

Switching accounts on one device wrote the PREVIOUS account's data into the NEW
account's rows. Root cause: six autosave effects fired against whichever
`authUser.id` was current when they ran, with no ownership check. Fixing one of
them made it look solved while five kept corrupting.

Now every autosave is guarded by `dataOwnerRef.current !== authUser.id`, sign-out
resets all 33 pieces of per-user state (it reset six), and the nav chip renders
the profile name rather than the email local part - four different accounts all
read "kiszo" because they shared a local part.

**Not fully recoverable.** Coach `645ac7e1`'s profile was overwritten twice and no
clean source exists - only `public.profiles` stores names, auth metadata has none.
`14d8685a` was restored from a `team_members` join-time snapshot.

Related: the profile autosave was ERASING the recruiting fields it was meant to
save, because it wrote a hand-picked subset of the profile object. It now saves
the whole object, plus save-on-blur and a visible save state.

---

## Verification standard

Set 2026-09-08 after a `useRef(profile)` reading state from its temporal dead zone
white-screened production. **A clean esbuild transform proves nothing.** It caught
none of: that white screen, an un-awaited fire-and-forget promise silently killed
when a serverless handler returns, the erasing autosave, or a `coachTeams`
under-select.

Every non-trivial change in this session ships with assertions run against stubbed
`fetch` and, for webhooks, a real signed payload - 8 for the seat webhook paths,
15 for seat grants and access, 6 for the retired price, and a byte-diff of the
actual form body Stripe receives in both tax env states. Keep that bar.

---

## Key Patterns / Rules
- Always `git pull` before making changes
- **After every deploy, HARD REFRESH (Ctrl+Shift+R) before judging whether it worked.**
  Signing out and back in does NOT reload the page - a cached index.html keeps
  serving the previous hashed bundle, so a fix looks like it failed or "reversed".
  Rule out a stale bundle BEFORE diagnosing a reported UI bug as a code defect.
- Deploy with functions explicitly: `netlify deploy --prod --dir=dist --functions=netlify/functions`
- PowerShell `;` does NOT short-circuit on failure. A failed `git pull` still runs
  the build and deploy behind it, shipping stale `dist` under a fresh deploy id.
  Run deploy steps ONE COMMAND AT A TIME and read each result.
- Every DB change gets a matching migration file committed in `supabase/migrations/`.
  Applied-only is not done - the repo alone must show what exists.
- PostgREST `resolution=merge-duplicates` resolves against the PRIMARY KEY unless
  `on_conflict=` names the constraint. A comment claiming otherwise cost a session.
- Compare subscription `status` case-insensitively (`lower(trim(status))`). A live
  row held `'Active'`, which every `status='active'` filter silently missed.
- Build: `npm run build` (warns about chunk size — normal, ignore)
- Push to GitHub triggers nothing — site is Netlify Drop, must run `DEPLOY.ps1` or drag dist
- Mac deploy: `npx netlify deploy --prod --dir=dist` (DEPLOY.ps1 is Windows-only)
- Building over the Cowork device bridge needs `@rollup/rollup-linux-arm64-gnu`
  (`npm i --no-save --no-package-lock`) - that shell is Linux, node_modules is darwin-arm64
- CSS utility classes: `.g2mob` = 2-col → 1-col at 640px, `.g4mob` = 4-col → 2-col at 640px
- Height stored as total inches in profile (e.g. 73 = 6'1") — use `Math.floor(h/12)` + `Math.round(h%12)`
