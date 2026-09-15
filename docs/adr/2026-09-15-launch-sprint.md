# ADR 2026-09-15 — 30-day sales sprint (launch ADR with falsifiable numbers)

**Status:** accepted (Kiszo, 2026-09-14/15). Council record: `ea_council_record_2026-09-10_gtm_by_level.md` (Drive) + sprint delta review 2026-09-15 (Operator, Red Team, CFO; Regulator seat not returned — its 2026-09-10 conditions carried forward).

## Objective
Registered sales in 30 days. Target: **4 rostered, paying teams ≈ 100 athletes** (a "user" is an athlete who accepted an invite on a paid team; a "sale" is a Stripe `checkout.session.completed` or RevenueCat purchase — nothing else counts).

## Verdicts by level (unchanged from 2026-09-10 except HS scope)
HS Georgia — SELL: basketball 69 + football 51 engaged coaches from day 3 (soccer 38 + volleyball 37 only if the day-10 gate clears). College D1 — SEED (research question to the 99 confirmed coaches; never the 250 unidentified .edu). D2/D3/NAIA/JUCO — DEFER outbound; list built passively from `share_open_domains`. Pro — DEFER 12 months; the 36 rows are quarantined. Athletes & parents — SELL, product-led only, no outbound. Clubs/trainers (Atlanta) — SELL, first visit day 8 after the age gate ships, ten visits in 14 days.

## Fixed decisions
- Ad spend $0 for 30 days. Phone before email: lapsed payers → Sims → human clickers with a number (all 197 engaged HS coaches have a phone; 0 of the 99 D1 do). No call or payment link to any minor until dob + parent email are recorded.
- Sends: founder-signed plain text from the company Gmail, ≤25/day across all touches, postal address + "reply STOP" on every message; every reply labelled YES / NOT NOW / STOP and written to `lead_events` before the next batch; a Gmail filter suppresses STOP.
- Price posture: **$899/yr + $4.99/athlete/mo** (there is no monthly coach plan — the $99 price is retired). No codes.

## Gates (all true before touch 1)
1. `lead_events` ledger live; `lead-capture`, `coach-waitlist`, `stripe-webhook`, `share-view` write it.  2. Daily `lead-canary` passes.  3. Reply-to = founder mailbox, read daily.  4. Suppress prior unsubscribes/bounces (0 among the 196/99 as of 2026-09-15).  5. Price freeze (this file + retraction ADR).  6. Retraction ADR.  7. Sales-tax memo (collection OFF, dated).  8. Store gate: invite flow works on both stores.  9. Share links available to seated athletes and Athlete tier, tested with a seated test account, never prompted to pay.  10. Age gate 13+ with parent email live.  11. Sims + lapsed-payer calls done.

## Falsifiable numbers
- **Day 10:** < 5 human coach replies (email or phone, any sport) across everything sent → stop all sends; run the Operator fallback (club line inside the HS sequence); rewrite before touching soccer/volleyball.
- **Day 30:** no real coach has opened an athlete-sent share link → every segment stops; the thesis, not the channel, is re-examined.
- **Day 45:** any paid coach at 0 accepted seats → activation failure; fix activation before selling another team.
- **Day 60:** 0 paid → freeze HS; hours move to clubs and athletes.
- Any spam complaint → all sends stop that day.

## Dissent preserved
Red Team objected to widening beyond the 69 basketball coaches (chair ruled 120, not 196). Operator objected to clubs in week 1 (chair ruled day 8, after the age gate). Athlete & Parent seat (2026-09-10) held that the coach should not be asked for money in September; it stands as the flip if the first 8 replies are "not my budget".
