# ADR 2026-09-16 — High-school coach scraper, all 50 states

**Status:** design accepted (Kiszo, 2026-09-16). Not yet implemented.

## Context

`tools/coach-scraper` (2,729 lines, 17 modules, 30 MB HTML archive) collects college coach
contacts and is proven: the rows it produced bounce at **0.3%** across 683 sends, the best of
any cohort in `coach_contacts`. The request is the same data — name, school, email, phone,
address, title — for high schools in all 50 states, for football, basketball, soccer,
volleyball and hockey.

### What the 2026-09-15 rollout established

These are measured against project `mllqcjvvflieszmjipfs`, not assumed. They constrain the
design more than any preference does.

| Finding | Evidence |
|---|---|
| A crawl-recovered `title` predicts deliverability | Titled rows bounce **0.73%** (3,141 sent); untitled **3.86%** (466 sent). The title is not seniority — it is proof a live page listed that person in the crawl window. |
| Formula-generated addresses are the failure mode | Autobuild generated addresses from names. Its untitled remainder is the 3.86% above, and all four transient bounces of the entire campaign came from that segment. |
| `validated = true` means nothing | Three fabricated families have now been caught — the D1 list, 12 `*strength@` rows, and 27 `performance@`/`scoach@` rows. **Every one was `validated=true`.** |
| Local-part entropy detects fabrication | The blast cohort had 854 distinct local parts across 889 rows, but `performance@` appeared on **24 separate domains**. No real directory produces that. |
| Archive-then-parse is what made iteration affordable | 295 pages stored compressed; every later parser change re-ran at zero network cost. |
| HTTP 200 is not a page | Styled 404s required `looks_like_directory()` before parsing. |

### What does not transfer

The audit already recorded this on 2026-09-15: *"the college method does not transfer: these
are Georgia high schools, and the collector's adapters (Sidearm, WMT, Presto) are college
athletics platforms. Public districts publish no single staff directory."*

### The structure of high-school contacts

Measured from the BookYourData cohort, which is **Metro Atlanta only** — not all of Georgia:

| | Rows | Schools | Mail domains |
|---|---|---|---|
| Total | 1,217 | 106 | 36 |
| Public, district-hosted | 928 | ~78 | 8 |
| Private, self-hosted | 289 | 28 | ~28 |

`gcpsk12.org` carries 18 schools. `cobbk12.org` carries 14, `dekalbschoolsga.org` 14,
`fultonschools.org` 14. **Public high-school coaches are on district domains, not school
domains.** Private schools are one-domain-one-school and structurally resemble small colleges.

This inverts the cost model. The crawl unit for public schools is the **district**, not the
school; there are roughly 13,000 districts nationally against ~19,000 association-member
high schools, and the districts holding the most schools are the ones most likely to run a
searchable staff directory because they have to. (Both national counts are estimates to be
confirmed during registry build; the Georgia figures above are measured.)

## Decision

### 1. New package, no edits to the working scraper

`tools/hs-scraper/`, importing proven utilities from `tools/coach-scraper` by path. The
college tool is not refactored, moved or modified — it currently produces the lowest-bouncing
cohort in the table and nothing in this work may put that at risk.

| Reused unchanged | New |
|---|---|
| `net.py` (TLS via OS trust store, retries, pacing) | `registry_hs.py` |
| `archive.py` (zlib HTML store) | `adapters_hs.py` |
| `normalize.py`, `address.py`, `classify.py` | `discover_hs.py` |
| `export.py`, `make_import_sql.py`, `filters.py` | `score_metro.py` |

### 2. Registry in three stages

- **A — association membership.** 50 state associations publish member directories. This is
  the authoritative answer to *which schools field these five sports*, plus classification.
  Scope is association members only; elementary, middle and non-athletic schools are excluded
  rather than crawled and discarded.
- **B — identity join to NCES.** Common Core of Data (public) and PSS (private) supply
  canonical name, address, enrollment, district and NCES ID. Fuzzy-join on
  `(state, city, normalized_name)`. This supplies `address_*` without scraping it.
- **C — resolution.** Public schools resolve to their **district** domain; private schools to
  their own. Unresolved schools are recorded as unresolved and never guessed at.

### 3. Two discovery paths, because there are two structures

- **Public → district staff directory.** One fetch can yield a dozen schools.
- **Private → school athletics site.** Closest to the existing college pattern.

Link scoring follows `discover_athletics.py`, which lifted college yield 65% → 79%, with a
high-school vocabulary: *Athletics, Sports, Teams, Activities, Coaching Staff, Staff Directory*.

### 4. Adapters

Derived empirically from the Metro Atlanta sample rather than guessed in advance. Expected
families: **Finalsite, Edlio, Blackboard/Schoolwires, Apptegy, SchoolMessenger** for district
CMS; **rSchoolToday, 8to18, VNN, Arbiter** for athletics; plus a generic proximity parser
(name ↔ role ↔ email within a DOM neighbourhood) as fallback. The
`detect_platform()` / `adapter_for(html)` pattern carries over directly.

### 5. Quality gates, enforced in code

- `proof_url` on every row, or the row is written `status='unverified'` and cannot be mailed.
- **A row without a `title` is not a contact.** It is written `unverified`.
- **Formula generation is not implemented.** There is no code path that constructs an address
  from a name, so it cannot happen by accident or under deadline.
- `looks_like_directory()` before parsing.
- Local-part entropy check on every output file, failing loudly above threshold.
- `sport` normalized to the five targets; anything else dropped.

### 6. Metro Atlanta is the validation harness

BookYourData's 1,163 active rows are **proven deliverable** — every one has a delivery on
record. That makes them ground truth, and the only ground truth this project will ever have.

Recall is scored **against the 106 schools BookYourData covers**, not against Georgia and not
against Metro Atlanta broadly. Scoring statewide would dilute the measure by construction.

- **In-scope recall** — of 1,217 rows at those 106 schools, how many are found independently?
- **Agreement** — on the overlap, do name and school match?
- **Out-of-scope discovery** — everything else is new by definition, including other Metro
  Atlanta schools BookYourData missed. Not scored as error.

**Gate: recall ≥ 60% and agreement ≥ 95% before any second state is crawled.** Recall is the
metric that matters. Precision failures are caught later by the entropy check and the send
filters; a recall failure is invisible on every state where there is no ground truth.

### 7. Insert new, enrich existing, overwrite nothing

- New coaches: insert, `ON CONFLICT (email) DO NOTHING`, as the importer already does.
- Existing coaches: fill `title` and `proof_url` **only where currently NULL**. Never
  overwrite a populated field, and never change `status`, `source` or `classification`.

The BookYourData cohort has no titles, which is why the audit notes the verified-only filter
cannot protect it. Enrichment moves those 1,163 rows from *safe on delivery history* to
*safe on delivery history and crawl-verified*, and makes them filterable for the first time.

### 8. Rollout order

1. Metro Atlanta — the 106 scored schools, then the rest of metro.
2. Rest of Georgia (~460 GHSA members, estimate to confirm).
3. Remaining 49 states, largest associations first.

## Consequences

- Nothing in `tools/coach-scraper` changes, so the 0.3% cohort stays intact.
- The first deliverable is a **score**, not a list. If Metro Atlanta recall lands under 60%,
  the parsers are wrong and the correct action is to fix them, not to crawl 49 more states
  and inherit the same gap 50 times.
- Enrichment gives the existing Georgia cohort a `title`, which is the field the verified-only
  send filter requires.
- Crawl estimate: ~13,000 districts + ~4,000 private schools nationally. Metro Atlanta is
  roughly 40 domains — under an hour. Everything is archived, so parser revisions after the
  fact cost no network.
- A Future Auditor can reconstruct, from this file plus `proof_url` on every row, exactly
  which page each address was read from and on what date.
