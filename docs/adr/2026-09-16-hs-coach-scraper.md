# ADR 2026-09-16 — High-school coach scraper, all 50 states

**Status:** design accepted (Kiszo, 2026-09-16); **revised during implementation** — see Revision 1 at the end.

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

---

## Revision 1 — 2026-09-16, during implementation

The decisions below were made before the sources had been probed. Implementation
probed them, and three did not survive contact. The originals are left standing
above; what follows records what replaced them and on what evidence, so a Future
Auditor can see the reasoning rather than a silent edit.

Nothing here weakens a quality gate. Every change moves a step from *inferring* a
value to *measuring* one.

### Superseded: 2B, the NCES identity join

**Was:** join CCD/PSS to supply canonical name, address, enrollment, district and
NCES ID, fuzzy-matched on `(state, city, normalized_name)`.

**Now:** dropped. The Georgia association's directory already supplies street,
city, ZIP and a contact domain, so the join's remaining job was the district —
and it is the wrong source for that:

> **NCES gives a district NAME. The crawl needs a DOMAIN.**

"Bibb County" does not say where the mail lives; `bibb.k12.ga.us` does. Turning
one into the other is a guess, and guessing is the defect this whole design
exists to avoid. The association publishes a usable domain for **449 of 456
schools (98.5%)**, so the structure is measured instead.

The guess was also tested rather than assumed bad. Matching unresolved school
names against known district labels produced 11 matches, of which **at least 5
were wrong**: `CENTRAL, CARROLL` → `centralgwinnett.net` (Carroll County matched
to Gwinnett on the word "central"), `HABERSHAM CENTRAL` → `centralgwinnett.net`,
`RANDOLPH-CLAY` → `clayton.k12.ga.us`, `SAVANNAH EARLY COLLEGE` →
`early.k12.ga.us` ("Early" is a county; here it is a school type), and
`SOUTHWEST ATLANTA CHRISTIAN`, a private school, → `atlantapublicschools.us`.
Each would have sent a crawl to a domain holding other people's addresses.

Seven schools resolve to nothing and are **recorded unresolved, never guessed
at**: Dalton Academy, Decatur, Discovery, Georgia-Cumberland Academy, South
Effingham, Utopian Academy, Wilson Academy.

### Superseded: 2C and 3, public-vs-private as the routing decision

**Was:** public schools resolve to their district domain, private to their own;
two discovery paths keyed on that distinction.

**Now:** the crawl unit is the **published email domain**, for every school
alike, and `is_public` becomes description rather than routing. A unit holding
several schools *is* a district directory; a unit holding one *is* a school
site. The distinction is observed, not declared.

The email domain — not the website domain — is load-bearing. Of 377 schools
publishing both, **only 48% share a domain.** The website is routinely a booster
or athletics vanity host while the mail sits on the district:

| school | website | mail |
|---|---|---|
| ALLATOONA | `allatoonabucs.com` | `cobbk12.org` |
| ARCHER | `archertigersathletics.com` | `gcpsk12.org` |
| BRANTLEY COUNTY | `bchsherons.com` | `brantley.k12.ga.us` |

Scored against the BookYourData cohort — the only proven-deliverable data this
project has, every row with a delivery on record:

| domain | from email | from website | BookYourData |
|---|---|---|---|
| `gcpsk12.org` | **18** | 5 | **18** |
| `cobbk12.org` | 15 | 14 | 14 |
| `fultonschools.org` | 15 | 10 | 14 |
| `dekalbschoolsga.org` | 13 | — | 14 |

DeKalb decides it: the website is on `dekalb.k12.ga.us`, but the published email
and the proven-deliverable rows **both** use `dekalbschoolsga.org` — two
independent sources agreeing against the website.

Two traps found by probing and now handled in code:

- **`k12.ga.us` is a public suffix.** Taking the last two labels collapses all 94
  Georgia district domains into one fake unit holding 159 schools.
- **`schooldesk.net` is a vendor, not a district.** It carries Colquitt, Clayton,
  Emanuel and McIntosh county systems. Shared-CMS hosts keep their full hostname
  and are crawled separately: over-splitting costs one fetch, under-splitting
  attributes one district's staff directory to another's schools — an error no
  downstream filter can detect, because every row still looks well-formed.
- **Free-mail domains are rejected outright.** One Georgia school publishes a
  `gmail.com` address; nationally there will be more, and grouping on it would
  merge unrelated schools into a single enormous fake district.

### Added: the crawl is aimed at named people

Not a supersession — something the sources turned out to offer that this design
did not anticipate.

The association directory names **every coach, with their sport**: page 25's
legend maps 1=Football, 2/3=Basketball, 12=Soccer, 13=Volleyball, `*` for head
coach. Georgia yields **19,677 roster rows, 8,282 carrying a target sport**
(football 4,517, basketball 2,760, volleyball 1,074, soccer 292). Georgia has no
ice-hockey code — four of the five sports here, by fact rather than defect.

Joined to the resolved domains, the crawl's job changes from *"find whoever is on
this page"* to *"find the address for **this named person** on **this domain**"*.
That strengthens §6's scoring: a hit is a named coach matched against a page,
which is evidence, rather than a loose address scraped, which is not.

**The names are for matching, never for constructing.** §5's ban on formula
generation is enforced structurally rather than by review: the crawl manifest
carries no address field at all, and a test asserts no target object ever
contains an `@`. The registry likewise stores a school's email *domain* and never
the generic inbox address it came from — a front-desk mailbox is not a contact,
and not storing it means nothing downstream can mail it.

### Unchanged

§1 (no edits to `tools/coach-scraper`), §5's quality gates, §6's scoring against
the 106 BookYourData schools at recall ≥ 60% and agreement ≥ 95%, §7's
insert-new/enrich-existing/overwrite-nothing rule, and §8's rollout order all
stand as written.
