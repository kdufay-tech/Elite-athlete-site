# Coach Directory Collector

Collects coaching-staff contacts — **name, school, email, phone, mailing
address** — from college athletics staff directories across **D1, D2, D3, NAIA
and JUCO**, for **football, soccer, basketball, volleyball and hockey**.

Output is CSV whose headers `netlify/functions/coach-contacts-import.js`
already recognises, so a run drags straight into `/admin → Coach Ops` with no
backend change.

---

## Why this exists

The app had the ingestion half of a pipeline (`coach-contacts-import.js`,
`coach-ops-*.js`) and no collector feeding it. The only contact list on disk,
`College Conference coaches.csv`, was not scraped — it was generated:

```
total emails           : 99
formula-pattern emails : 90  (91%)
repeated local-parts   : {'strength': 67, 'vball.strength': 8,
                          'soccer.strength': 8, 'hockey.strength': 7}
```

Sixty-seven rows shared the invented local-part `strength@<teamdomain>`, all
six sampled "Staff Page URL" values returned 404, and one person (Mickey
Marotti) appeared at two different schools. Mailing that list produces hard
bounces at a rate that damages the sending domain's reputation for every
*real* contact too.

So the design rule here is: **an address is only ever emitted if it was
literally found on a page, and every row carries the URL and timestamp proving
where.** Nothing is inferred, pattern-filled or guessed.

---

## Quick start

```bash
cd tools/coach-scraper

python tests.py                    # offline unit tests
python main.py selftest            # offline; parses the bundled fixture
python main.py verify-registry     # which athletics domains actually resolve
python main.py crawl --division D2 # polite, resumable
python main.py titles              # real title distribution -> tune filters.py
python main.py export              # CSVs + migration.sql into out/
```

No install step: `requests`, `beautifulsoup4` and `lxml` are already present.

---

## How it works

Four stages, each independently runnable:

```
registry.py   schools.csv: id, name, division, state, athletics domain
    |
crawl.py      one polite GET per school -> archive.sqlite (zlib HTML)
    |
parse.py      adapters -> normalize -> filters -> dedupe     [offline]
    |
export.py     out/coaches_*.csv + out/migration.sql
```

**Fetching and parsing are deliberately separated.** Parsing ~1,900 schools
correctly takes several iterations, and if the two were fused, every parser fix
would cost another full crawl — another 1,900 requests against schools that did
nothing wrong. With the archive, iteration two onward is offline, instant and
free. It also makes an interrupted run resumable, and gives every exported row
real provenance.

### Adapters

| Adapter | Covers | Grouping mechanism |
|---|---|---|
| `sidearm` | Most D2/D3/NAIA | `data-category-id` links row → heading |
| `wmt` | Most D1 | Rows nested inside their department |
| `presto` | Many D3, smaller NAIA | Document order; no linking id |
| `generic` | Everything else | None; deliberately low-recall |

The chain is tried in order and the first adapter that recognises a page wins.

**D1 is not Sidearm.** A probe of D2/D3/NAIA sites found Sidearm every time,
which is misleading: large programs largely moved to custom WMT Digital builds.
Auburn alone yields 455 staff rows across 53 departments. Assuming Sidearm
coverage from small-school sampling would have left D1 on the generic adapter,
with no reliable sport attribution.

### The email obfuscation

Sidearm hides addresses from scrapers by splitting them across two JS variables
assembled at render time:

```js
var firstHalf = "beckeker"; var secondHalf = "gvsu.edu";
placeholder.href = 'mailto:' + firstHalf + '@' + secondHalf;
```

A regex for a whole address finds **nothing** on these pages — a probe of four
athletics sites reported `emails=0, phones=87`. That result is what pushes most
scrapers to a headless browser. But the halves sit in *static* HTML, so
matching the assembly instead recovers every address with a plain GET. That
single decision turns ~1,900 browser renders (hours) into ~1,900 plain GETs
(minutes).

### Sport attribution

Sidearm rows carry `data-category-id` matching their category heading, so sport
comes from an exact id lookup rather than walking document order — a walk breaks
silently the moment a site nests or reorders rows.

`config.SPORT_EXCLUSIONS` is checked *before* matching, so **"Field Hockey"
never becomes "hockey"** and "Flag Football" never becomes "football". Gendered
headings are preserved in `Sport Detail` ("Women's Soccer"), because that is a
different program from the men's one.

---

## The one thing you need to decide

`filters.py` decides who counts as a coach worth contacting. A D2 directory
holds ~163 people; ~40 are coaches in the five sports and the rest are ticket
office, compliance, sports information and donor relations. Real titles from a
live directory:

```
Head Coach                      <- kept
Associate Head Coach            <- kept
Assistant Coach                 <- kept
Director of Sports Performance  <- INCLUDE_STRENGTH   (your D1 list was 100% S&C)
Graduate Assistant              <- INCLUDE_GRAD_ASSTS (high turnover -> future bounces)
Volunteer Assistant Coach       <- INCLUDE_VOLUNTEER
Director of Operations          <- INCLUDE_OPERATIONS (often reads the inbox)
Team Chaplin                    <- never
Student Manager                 <- never
```

Four booleans at the top of `filters.py`. Defaults are conservative (core
coaching staff only). Run `python main.py titles` after a crawl to see the real
distribution across every school collected, then decide against actual data
rather than guessing. `filters.explain(title, category, sport)` reports why any
single row was kept or dropped.

Precedence matters more than it looks. Each discretionary group is tested
**before** the generic "contains the word coach" fallback, because real titles
read *"Graduate Assistant Football Coach"* and *"Volunteer Assistant Coach"* —
both contain "coach", so a trailing fallback silently defeats all four
switches. That exact bug let eight grad assistants into an export with
`INCLUDE_GRAD_ASSTS = False`; `tests.py` now pins the behaviour in both
directions.

---

## Crawl policy

Deliberately polite, because a blocked IP costs far more than the time saved:

- `robots.txt` honored per host (fails **open** — a 500 on robots.txt is not a ban)
- **1 request/second per host**, tracked per host so different schools do not
  queue behind each other
- Honest `User-Agent` with a contact address
- Exponential backoff on 429/5xx, honoring `Retry-After`
- **Permanent failures are not retried.** A domain that does not resolve will
  not resolve on the next attempt. Retrying DNS failures turned a first run
  over a registry with ~30 dead domains into a 50-minute wait, nearly all of it
  spent re-asking a question that already had a final answer.
- Resumable: `crawl_status` records `ok / failed / no-directory / disallowed`,
  and a re-run skips what already succeeded

A 200 is not treated as success — most athletics sites serve a styled 404 with
status 200, so `looks_like_directory()` requires a page an adapter recognises,
or at least three plausible addresses.

### TLS note (this machine)

Every HTTPS request from Python fails certificate validation here: a local
security product re-signs traffic with a root CA that is in the Windows
certificate store but **not** in `certifi`'s bundle, which is what `requests`
uses by default. `net.SystemTrustAdapter` routes validation through
`ssl.create_default_context()` so the OS store is used. Without it the crawler
silently collects zero rows.

---

## Output

`out/coaches_all.csv` plus one file per sport. Headers map onto
`HEADER_MAP` in `coach-contacts-import.js`:

| CSV header | → field |
|---|---|
| `Email` | `email` (dedupe key) |
| `Coach Name` / `First Name` / `Last Name` | `coach_name` |
| `School` | `school` |
| `Sport` | `sport` |
| `Level` | `level` — always `college` |
| `Classification` | `classification` — `D1`/`D2`/`D3`/`NAIA`/`JUCO` |
| `State` | `state` (importer derives `region`) |
| `Phone` | `phone` |
| `Proof URL` | `website` — the exact page the address came from |
| `Email Status` | `validated=true` |

`normLevel()` collapses every college tier to `college`, which is why the
specific tier rides in `classification`.

Unrecognised columns (`Title`, `Address*`, `Platform`, `Captured At`) are
reported by the importer as unmapped and ignored — harmless, and useful for
reviewing rows before import.

### Addresses

`coach_contacts` has **no address column**, so those columns are dropped on
import until `out/migration.sql` is applied. It is additive and reversible
(nullable columns only) and includes the `HEADER_MAP` additions needed to carry
the values through. Nothing runs against the database on its own.

---

## Commands

| Command | Purpose |
|---|---|
| `selftest` | Parse the bundled fixture. No network. |
| `registry-import --csv F --division D` | Harvest athletics domains out of any contact CSV |
| `verify-registry [--division D]` | Which domains resolve |
| `crawl [--division D] [--limit N] [--no-address]` | Fetch into the archive |
| `parse [--no-filter]` | Parse offline, print stats |
| `titles [--top N]` | Title distribution for tuning `filters.py` |
| `export [--no-filter]` | Write CSVs + migration.sql |
| `stats` | Archive contents by state and platform |

---

## Extending the registry

The registry is the coverage ceiling, and it is the genuinely manual part:
there is no public machine-readable mapping from "Grand Valley State" to
`gvsulakers.com`, because athletics sites use team-brand domains rather than
institutional ones.

Add rows to `data/schools.csv` (`school_id, school, division, state,
conference, athletics_url`), then run `verify-registry` to confirm they resolve
before crawling. `registry-import` harvests domains out of any CSV that has
school names and URLs in it.

---

## Scope and conduct

This collects **professional contact details that institutions publish
specifically so athletes and families can reach their coaching staff** — the
same directory pages a recruit browses by hand.

Two things worth keeping in view:

- **Bounce discipline.** The value of verified-only extraction is lost if it is
  merged back into unverified rows. Keep `source` and `validated` intact and
  send to verified rows only.
- **CAN-SPAM** applies to the outreach these rows feed: accurate headers, a
  working unsubscribe, and a physical postal address in each message. The
  address columns collected here can serve the last of those.
