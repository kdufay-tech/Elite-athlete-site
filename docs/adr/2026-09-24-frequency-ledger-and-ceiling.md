# ADR 2026-09-24 — Frequency is a ledger and a ceiling, not a target

Status: ACCEPTED by Kiszo 2026-09-24 (council: Operator, Red Team, CFO, Regulator, Coach-as-recipient; record on Drive `ea_council_record_2026-09-24_frequency_delta.md`).
Supersedes: the day-10 gate of ADR 2026-09-15 (launch sprint), which is set aside as a process artefact — it fired on the Sept 15–16 support@ blast while the 120-coach ladder was never started.

## Decision
1. Every contact carries a reconciled exposure count (`public.contact_exposures`: support@ blasts + eku@ personal sends + phone touches) and a suppression flag (`public.contact_suppression`). Both are read before every send and every dial. No touch is sent to a contact whose count is unknown.
2. Caps: **4 touches per HS coach this sprint, 2 per D1 contact**; **8 delivered emails per contact per rolling 12 months, all senders combined** (the ceiling binds first where a coach already sits at 6+ from the August sequence). Repliers leave the counter and become a conversation.
3. **No cold calls.** Phone only after a coach has replied (CEO ruling, Coach seat). Phone calls do not count against the 25 sends/day cap (CEO ruling). Cells and office lines both allowed once a reply exists; no SMS; no ringless voicemail.
4. Content by stage, not by touch number. Recognition (T1): one real question, no link, no price, no "you opened our note", no "Re:" on a first personal contact. Trust (T2): a 60-second product recording, the price plainly, "nobody is using this yet", and "who approves a purchase like this at your school?". Action (T3): offer to set the roster up on a 15-minute call before the December early signing period; the price ask goes to whoever the coach names as the approver. Goodbye (T4): "we will stop emailing; here is the link if it is ever useful." ≥7 days between touches. Never Thu–Sat for football; never tryout week for basketball.
5. Arms, from 2026-09-28, 25 sends/day, counter-ordered:
   - **Basketball (69 sendable)** — the test arm, full T1–T4.
   - **Soccer + volleyball (81)** — the holdout: T1 only, same copy, same week. Nothing else.
   - **Football (53)** — T1 now, then parked until the Monday after each program's last game; T2–T4 in the post-season window.
   - **D1 (99)** — cap 2, no phone; T2 is a referral ask ("who at your program looks at a HS kid's verified record?").
6. Gate, read **2026-10-24** on basketball: fewer than 4 human replies (a written reply or a live call >2 min; not opens, clicks, autoresponders) after T3 → stop HS touches, run the Operator fallback (Atlanta clubs), rewrite. Tripwire: 0 human replies at T2 (~10/12) → stop at T2. Holdout comparison at the same read: holdout reply rate ≥ basketball → touches 2–4 retired from the model.
7. The 10/04 read on the 25 Sept-24 sends is reported by segment (19 D1 / 5 sub-D1 / 1 HS) and does not gate the HS plan.
8. Cross-channel: email + phone share one counter and one suppression list. Social is not linked and not counted; one $0 rule — pin the same 60-second product clip. **Paid retargeting: no** — the $0 decision stands and, independently, a Meta custom audience built from scraped/blast addresses cannot carry Meta's consent representation and pixel retargeting would show a $899 ask to minor athlete visitors. In person is a separate pool and counter.
9. Reply handling: eku@ and support@ are read daily; every human reply is logged to `lead_events` within the hour and labelled EA/YES, EA/NOT NOW or EA/STOP. STOP on either address suppresses both, and the domain if the source is an admin or IT. Compliance trips regardless of replies: a second complaint, any district IT/admin objection (stop that domain), any GHSA inquiry (stop all HS).
10. Budget: ≤40 founder-hours on this pool this sprint. Money stop.

## Two findings that change the action ask
- The HS coach usually cannot pay: the AD, booster club or district signs $899 + seats. T2 asks who approves; the price ask goes to that person by referral.
- A coach's purchase creates zero athlete records: under the age gate each athlete signs up with a parent email. Action copy must say "we set up the roster and send the invites; athletes and parents complete signup." A YES starts a parent-facing campaign that is not yet sized.

## Dissent preserved
- Red Team (C): nothing to the 120 before 10/05 and before the counter exists. Counter adopted as precondition (built 2026-09-24); the wait rejected because the 25 cannot inform the HS decision.
- Coach: no call before a reply — ADOPTED by the CEO over the majority.
- Operator/CFO: 4 touches — ADOPTED by the CEO over the 3-touch seats.
- CFO's stricter self: do nothing on this pool; move hours to athletes/parents and clubs. Not adopted; ≤40-hour budget adopted.
- Operator: n=69 puts the gate near the noise floor. True; the holdout is the mitigation.

## Dynasty Africa
Requirement added to the proposal ask: per-asset audience, stage and per-contact cap (4 for coaches); assets sequenced to the Georgia season calendar; every exposure written to Taradome's ledger and every send checked against its suppression list; no retargeting from Taradome lists, no scraping, no testimonial/school/athlete/minor in creative or targeting; no copy of the contact list to the agency; founder approval load in hours/week; priced per stage, cancellable at each gate, tranches ≤$5k on measured human replies; USD or CBN official rate on invoice date. CFO: not justifiable until the first paying coach exists.

## Not on this ADR
Coach cold email remains hard-paused (2026-09-01). `OPS_TRIGGER_SECRET` remains unset. No automated sends; Kiszo presses send.
