# ADR 2026-09-15 — Retraction of unsupported traction figures

**Status:** accepted (Kiszo, on council recommendation 2026-09-10; reaffirmed 2026-09-15)

## Context
Strategy and outreach documents in the company Drive state figures the production database does not support (queried 2026-09-10, project `mllqcjvvflieszmjipfs`):

| Claim | Where | Database says |
|---|---|---|
| 100 coaches / 2,400+ athletes / NPS 74 / 68% DAU-MAU / 22% premium upgrade | "Elite Athlete — Marketing & 90-Day Growth Plan (July 2026)" §8.3 | 29 auth users, 1 team, 1 active roster membership, 0 real coach signups, 0 paying customers |
| "4,000+ athletes currently on the platform" | Coach Outreach Toolkit (Mar 2026), template 3 | as above |
| "average 94% adherence in week 1"; "3x more likely to still be on the platform in week 4" | EmailSequences (Apr 2026) | no cohort exists to measure |
| "24–28% real opens, 210 engaged" | Dynasty_Response (Aug 2026) | scanner-filtered human engagement: 602 raw → ~295 real people; 37 human clicks; 0 signups |

The July document also carries a $2.5M investor ask against those figures. Two Gmail threads (Jun–Jul 2026) show the deck reached two investor contacts.

## Decision
1. The figures above are **withdrawn**. They must not appear in any deck, teaser, sequence, sales email, landing page or social post.
2. The only traction statements permitted are verifiable from the database: pre-revenue; 0 paying; 29 auth users; 1 team; apps live on both stores; 9,171 coach contacts of which 5,629 validated D1 (never emailed). From this date, the only traction figure anyone may quote is the weekly count from `public.lead_events`.
3. Every recipient of the July document (known: the two investor contacts in the Jun–Jul 2026 threads; any others: to be listed by Kiszo) receives a written correction before any further investor contact. A false traction figure relied on in a financing is securities-fraud exposure (Rule 10b-5; Georgia O.C.G.A. §10-5-50 — verify with counsel).
4. Pricing is **frozen and dated** at the live values: Athlete $29/mo · $199/yr; Elite $69/mo · $529/yr; Coach Pro $899/yr annual-only + $4.99/athlete/mo seat. The $99/mo coach price is retired in Stripe and is not to be quoted. The two contradictory founding offers in writing (20% for 3 months; 50% for 3 months) are both withdrawn; no discount code exists.
5. **Feature move, not a price change:** on 2026-09-15 Recruiting Profile + share links moved from the Elite tier to the Athlete tier and to coach-paid roster seats. Elite retains AI Coach, injury protocols, benchmarks, supplements, periodization, report PDFs, email-to-coach.

## Consequences
- Investor materials are rewritten from the verifiable list before any new send.
- Sales copy for the 30-day sprint carries no numbers except the price.
- The Future Auditor can reconstruct, from this file and `lead_events`, what was claimed and what was true.
