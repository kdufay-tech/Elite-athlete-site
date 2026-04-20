# Elite Athlete — Project State
> Last updated: 2026-04-20
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

## Tech Stack
- React + Vite (local: `C:\Users\kdufa\App Development\Elite Athlete\elite-athlete-v3`)
- Supabase (auth + data), EmailJS, Stripe, jsPDF
- Netlify Functions: coach, stripe-checkout, stripe-webhook, food-search, admin-action, admin-data, beta-feedback, beta-signup, coach-waitlist
- EmailJS template ID: `template_b4rv0ur` (Contact Us type)
- Test account: Emeka Ugokwe (username: kdufay)

## App Structure
- Single file: `src/App.jsx` (~11,261 lines)
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
- CSS utility classes: `.g2mob` = 2-col → 1-col at 640px, `.g4mob` = 4-col → 2-col at 640px
- Height stored as total inches in profile (e.g. 73 = 6'1") — use `Math.floor(h/12)` + `Math.round(h%12)`
