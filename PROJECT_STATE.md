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
| Coach Pro monthly (`coach`) | $99/mo | **+ $4.99 per active athlete per month** |
| Coach Pro annual (`coach_annual`) | $899/yr | **flat - no seat charge** |
| `coach_comp` | comp | never billed |

Annual is flat by decision AND by constraint: Stripe requires every item in one
subscription to share a billing interval, so a monthly seat price cannot sit on
an annual base. There is no annual seat price and none should be created unless
that decision changes.

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

### Follow-up - not built
No periodic reconcile. If a sync fails and that coach never changes their roster
again, their seat count stays stale. A scheduled reconcile is the obvious fix but
scheduled functions are paused by the council decision, so this is deliberately
manual for now.

---

## Tech Stack
- React + Vite
  - Windows: `C:\Users\kdufa\App Development\Elite Athlete\elite-athlete-v3`
  - Mac: `/Users/taradomeentertainmentgroup/App Development/elite-athlete-v3`
- Supabase (auth + Postgres + RLS), Stripe, RevenueCat, Resend, EmailJS, jsPDF
- Capacitor: web / iOS / Android from one codebase. `android/` and `ios/` are both tracked in git.
- Netlify Functions: 37 in `netlify/functions/`. `ls netlify/functions` is the source of truth;
  10 of them send mail (see Email section above).
- EmailJS template ID: `template_b4rv0ur` (Contact Us type)
- Test account: Emeka Ugokwe (username: kdufay)

## App Structure
- Single file: `src/App.jsx` (~12206 lines, one App() component, ~90 useState)
- Components: `src/components/PayModal.jsx`, `src/components/AuthModal.jsx`
- Pricing lib: `src/lib/stripe.js`

## Pricing (4-tier)
| Tier | Monthly | Annual | Notes |
|------|---------|--------|-------|
| Free | $0 | $0 | |
| Athlete | $29/mo | $199/yr | Save $149/yr — 43% off |
| Elite | $69/mo | $529/yr | Save $299/yr — 35% off |
| Coach Pro | $99/mo | $899/yr | Waitlist — Q3 2026 |

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

## Key Patterns / Rules
- Always `git pull` before making changes
- Build: `npm run build` (warns about chunk size — normal, ignore)
- Push to GitHub triggers nothing — site is Netlify Drop, must run `DEPLOY.ps1` or drag dist
- Mac deploy: `npx netlify deploy --prod --dir=dist` (DEPLOY.ps1 is Windows-only)
- Building over the Cowork device bridge needs `@rollup/rollup-linux-arm64-gnu`
  (`npm i --no-save --no-package-lock`) - that shell is Linux, node_modules is darwin-arm64
- CSS utility classes: `.g2mob` = 2-col → 1-col at 640px, `.g4mob` = 4-col → 2-col at 640px
- Height stored as total inches in profile (e.g. 73 = 6'1") — use `Math.floor(h/12)` + `Math.round(h%12)`
