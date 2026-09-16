# High-School Coach Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect name, school, email, phone, address and title for high-school coaches in
football, basketball, soccer, volleyball and hockey — Georgia first, scored against 1,163
proven addresses, then the remaining 49 states.

**Architecture:** A new `tools/hs-scraper/` package that imports the proven utilities from
`tools/coach-scraper` by path without editing them. Registry is built in three stages
(association membership → NCES identity → domain resolution). Public schools crawl at the
**district** domain, private schools at their own. A generic proximity adapter is built and
*measured* first; platform-specific adapters are written only for the gap it leaves.

**Tech Stack:** Python 3.11+, `requests` (via the existing `net.Fetcher`), SQLite (via the
existing `archive.Archive`), no test framework — tests are dependency-free and run with
`python tests_hs.py`, matching the house convention in `tools/coach-scraper/tests.py`.

**Spec:** `docs/adr/2026-09-16-hs-coach-scraper.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **`tools/coach-scraper` is not edited, moved or refactored.** It produces the lowest-bouncing
  cohort in the table (0.3% over 683 sends). Reuse is by import only.
- **`proof_url` on every row, or the row is written `status='unverified'` and cannot be mailed.**
- **A row without a `title` is not a contact.** It is written `unverified`.
- **Formula generation is not implemented.** There is no code path that constructs an address
  from a name, so it cannot happen by accident or under deadline.
- **`looks_like_directory()` before parsing.** HTTP 200 is not a page; styled 404s return 200.
- **Local-part entropy check on every output file**, failing loudly above threshold.
- **`sport` normalized to the five targets**; anything else dropped.
- **Insert new, enrich existing, overwrite nothing.** `ON CONFLICT (email) DO NOTHING` for new
  rows; fill `title` and `proof_url` only where currently NULL.
- **Gate: recall ≥ 60% and agreement ≥ 95%** against the Metro Atlanta set before a second
  state is crawled.
- Module names in the new package are suffixed `_hs` where the college package has the same
  name (`config_hs.py`, `registry_hs.py`), and the college path is **appended** to `sys.path`,
  never inserted at position 0 — otherwise `import config` silently resolves to the college
  package's config and the crawl runs with college seed domains.

---

## File Structure

| File | Responsibility |
|---|---|
| `tools/hs-scraper/_shared.py` | Put `tools/coach-scraper` on `sys.path` (appended). Nothing else. |
| `tools/hs-scraper/config_hs.py` | HS-specific constants: link vocabulary, staff paths, thresholds. |
| `tools/hs-scraper/registry_hs.py` | `HSSchool` dataclass + CSV load/save/merge. |
| `tools/hs-scraper/associations/ghsa.py` | GHSA member directory → `HSSchool` rows. |
| `tools/hs-scraper/nces.py` | NCES CCD/PSS load + fuzzy identity join. |
| `tools/hs-scraper/resolve_hs.py` | School → district domain (public) or own domain (private). |
| `tools/hs-scraper/discover_hs.py` | Homepage → staff/athletics page URL, by link scoring. |
| `tools/hs-scraper/crawl_hs.py` | Drive `net.Fetcher` → `archive.Archive`. |
| `tools/hs-scraper/adapters_hs/generic.py` | Proximity parser: name ↔ role ↔ email in a DOM neighbourhood. |
| `tools/hs-scraper/adapters_hs/census.py` | Count platform signatures across the archive. |
| `tools/hs-scraper/gates_hs.py` | Quality gates + entropy check. |
| `tools/hs-scraper/export_hs.py` | CSV + import SQL, insert-new / enrich-existing. |
| `tools/hs-scraper/score_metro.py` | Recall and agreement against the 1,163 proven addresses. |
| `tools/hs-scraper/tests_hs.py` | Dependency-free test harness. `python tests_hs.py`. |

Reused unchanged from `tools/coach-scraper`: `net.Fetcher`, `net.Fetched`, `archive.Archive`,
`normalize.normalize/dedupe/fold_sport/split_name/clean_email/clean_phone`, `address.extract`,
`classify.state_for/region_for/role_tier/confidence`, `adapters.base.CoachRecord/Adapter/emails_in`.

---

### Task 1: Package skeleton, registry type, test harness

**Files:**
- Create: `tools/hs-scraper/_shared.py`
- Create: `tools/hs-scraper/config_hs.py`
- Create: `tools/hs-scraper/registry_hs.py`
- Create: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `tools/coach-scraper/registry.py:slugify` (for `school_id` generation).
- Produces: `HSSchool` dataclass with fields
  `school_id, school, state, city, classification, is_public, district, district_domain,
  site_url, staff_url, nces_id, enrollment`;
  `registry_hs.load(path) -> list[HSSchool]`, `registry_hs.save(rows, path) -> None`,
  `registry_hs.merge(existing, incoming) -> list[HSSchool]`.

- [ ] **Step 1: Write the failing test**

Create `tools/hs-scraper/tests_hs.py`:

```python
"""Tests for the high-school scraper. Run: python tests_hs.py

Dependency-free on purpose, matching tools/coach-scraper/tests.py -- it runs
anywhere the scraper runs. Every case here is a regression, not decoration.
"""

from __future__ import annotations

import sys
import traceback

import _shared  # noqa: F401  -- must import first; puts coach-scraper on sys.path
import registry_hs

FAILURES: list[str] = []


def check(label, got, want):
    if got != want:
        FAILURES.append(f"{label}\n  got:  {got!r}\n  want: {want!r}")


def test_registry_roundtrip(tmp):
    rows = [
        registry_hs.HSSchool(
            school_id="ga-marietta", school="Marietta", state="GA", city="Marietta",
            classification="7A", is_public=True, district="Marietta City",
            district_domain="marietta-city.org", site_url="https://www.marietta-city.org",
            nces_id="1302640", enrollment=2600,
        ),
    ]
    registry_hs.save(rows, tmp)
    back = registry_hs.load(tmp)
    check("roundtrip len", len(back), 1)
    check("roundtrip is_public survives as bool", back[0].is_public, True)
    check("roundtrip enrollment survives as int", back[0].enrollment, 2600)
    check("roundtrip school_id", back[0].school_id, "ga-marietta")


def test_merge_prefers_incoming_non_empty():
    existing = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA")]
    incoming = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                                     nces_id="123", enrollment=900)]
    merged = registry_hs.merge(existing, incoming)
    check("merge keeps one row", len(merged), 1)
    check("merge fills nces_id", merged[0].nces_id, "123")


def test_merge_never_blanks_existing():
    existing = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA", nces_id="123")]
    incoming = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA", nces_id="")]
    merged = registry_hs.merge(existing, incoming)
    check("merge does not blank a populated field", merged[0].nces_id, "123")


def main():
    """Auto-discovers every global named test_*.

    Deliberately NOT a hand-maintained list. Nine tasks add tests to this file;
    a list is one forgotten line away from a green run that proved nothing.
    A test needing the temp CSV declares one parameter and receives `tmp`.
    """
    import inspect, tempfile, os
    fd, tmp = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    tests = sorted(
        ((name, fn) for name, fn in list(globals().items())
         if name.startswith("test_") and callable(fn)),
        key=lambda kv: kv[0],
    )
    for name, fn in tests:
        try:
            fn(tmp) if inspect.signature(fn).parameters else fn()
        except Exception:
            FAILURES.append(f"{name} raised:\n{traceback.format_exc()}")
    os.unlink(tmp)
    print(f"ran {len(tests)} tests")
    if FAILURES:
        print(f"{len(FAILURES)} FAILED\n")
        for f in FAILURES:
            print(f + "\n")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named '_shared'`

- [ ] **Step 3: Write `_shared.py`**

```python
"""Put tools/coach-scraper on sys.path so its proven modules import directly.

APPENDED, never inserted at position 0. The college package has config.py and
registry.py; this package has config_hs.py and registry_hs.py precisely so the
names cannot collide, but appending is the second belt: if a same-named module
is ever added here, the local one wins.

Importing this module is a side effect by design. Import it first, before any
`import net` / `import archive` / `import normalize`.
"""

from __future__ import annotations

import sys
from pathlib import Path

COLLEGE = Path(__file__).resolve().parent.parent / "coach-scraper"

if not COLLEGE.is_dir():
    raise RuntimeError(
        f"Expected the college scraper at {COLLEGE}. This package reuses its "
        "net/archive/normalize/address/classify modules and cannot run without it."
    )

if str(COLLEGE) not in sys.path:
    sys.path.append(str(COLLEGE))
```

- [ ] **Step 4: Write `config_hs.py`**

```python
"""High-school crawl constants.

Separate from the college package's config.py on purpose -- see _shared.py.
"""

from __future__ import annotations

# Link text that indicates a staff or athletics page on a school/district site.
# Ordered by how strongly each implies "this page lists people with emails".
STAFF_LINK_WORDS = [
    ("staff directory", 10), ("coaching staff", 10), ("coaches", 8),
    ("athletics staff", 8), ("directory", 6), ("athletics", 5),
    ("sports", 4), ("teams", 4), ("activities", 3), ("staff", 3),
]

# Path suffixes worth trying directly when link scoring finds nothing.
STAFF_PATHS = [
    "/staff-directory", "/athletics/staff-directory", "/athletics/coaches",
    "/coaches", "/directory", "/athletics", "/our-staff", "/staff",
]

# A page must contain at least this many addresses to be treated as a directory.
MIN_EMAILS_FOR_DIRECTORY = 3

# Entropy gate: if one local-part appears at more than this many distinct
# domains in an output file, the file is rejected. performance@ appeared at 24.
MAX_DOMAINS_PER_LOCAL_PART = 3

# Politeness. The college crawl ran at this and drew no complaints.
DELAY_PER_DOMAIN = 1.5
```

- [ ] **Step 5: Write `registry_hs.py`**

```python
"""The school registry: one row per high school, built up over three stages.

Deliberately NOT reusing registry.School from the college package. That record
carries division/conference and assumes one domain per school; a public high
school's coaches live on a DISTRICT domain shared with a dozen other schools,
which is the single most important structural fact in this crawl.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, asdict, fields
from pathlib import Path

import _shared  # noqa: F401
from registry import slugify  # college package -- same slug rules, one definition

DATA_DIR = Path(__file__).parent / "data"
FIELDS = [
    "school_id", "school", "state", "city", "classification",
    "is_public", "district", "district_domain", "site_url", "staff_url",
    "nces_id", "enrollment",
]


@dataclass
class HSSchool:
    school_id: str = ""
    school: str = ""
    state: str = ""
    city: str = ""
    classification: str = ""      # association class, e.g. "7A", "AAA"
    is_public: bool = True
    district: str = ""
    district_domain: str = ""     # where public coaches' mail actually lives
    site_url: str = ""
    staff_url: str = ""
    nces_id: str = ""
    enrollment: int = 0

    @property
    def mail_domain(self) -> str:
        """The domain this school's coach addresses are expected to be on."""
        return self.district_domain if self.is_public else _host(self.site_url)


def _host(url: str) -> str:
    u = (url or "").split("//")[-1]
    return u.split("/")[0].lower().removeprefix("www.")


def make_id(state: str, school: str) -> str:
    return f"{state.lower()}-{slugify(school)}"


def save(rows: list[HSSchool], path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(asdict(r))


def load(path: Path | str) -> list[HSSchool]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out.append(HSSchool(
                school_id=row.get("school_id", ""),
                school=row.get("school", ""),
                state=row.get("state", ""),
                city=row.get("city", ""),
                classification=row.get("classification", ""),
                is_public=str(row.get("is_public", "True")).strip().lower()
                          in ("true", "1", "yes"),
                district=row.get("district", ""),
                district_domain=row.get("district_domain", ""),
                site_url=row.get("site_url", ""),
                staff_url=row.get("staff_url", ""),
                nces_id=row.get("nces_id", ""),
                enrollment=int(row.get("enrollment") or 0),
            ))
    return out


def merge(existing: list[HSSchool], incoming: list[HSSchool]) -> list[HSSchool]:
    """Fill blanks from `incoming`; never blank a field that is already set.

    Same rule the coach_contacts importer follows: a later pass may add what an
    earlier one lacked, but may not erase it.
    """
    by_id = {r.school_id: r for r in existing}
    for new in incoming:
        cur = by_id.get(new.school_id)
        if cur is None:
            by_id[new.school_id] = new
            continue
        for f in fields(HSSchool):
            nv = getattr(new, f.name)
            if nv in ("", 0, None):
                continue
            if getattr(cur, f.name) in ("", 0, None):
                setattr(cur, f.name, nv)
    return list(by_id.values())
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `all passed`

- [ ] **Step 7: Commit**

```bash
git add tools/hs-scraper/_shared.py tools/hs-scraper/config_hs.py \
        tools/hs-scraper/registry_hs.py tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): package skeleton and school registry

Imports the college scraper's proven modules by path, appended to sys.path
never inserted, so a same-named module here always wins. HSSchool carries
district_domain because public high-school coaches' mail lives on a district
domain shared across schools - 8 domains carried 78 Metro Atlanta schools.

merge() fills blanks and never blanks a populated field, matching the
coach_contacts importer rule.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: GHSA directory PDF → registry + coach roster

**Files:**
- Create: `tools/hs-scraper/associations/__init__.py`
- Create: `tools/hs-scraper/associations/ghsa.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `registry_hs.HSSchool`, `registry_hs.make_id`, `net.Fetcher`.
- Produces:
  `ghsa.SPORT_CODE: dict[str, str]`,
  `ghsa.RosterEntry` dataclass (`school_id, name, codes, sports, is_head`),
  `ghsa.parse_entry(lines: list[str]) -> tuple[HSSchool, list[RosterEntry]] | None`,
  `ghsa.parse_pdf(path) -> tuple[list[HSSchool], list[RosterEntry]]`,
  `ghsa.fetch_pdf(fetcher, path) -> None`.

**Why a PDF and not the HTML table.** Probed live before this task was written:
`ghsa.net` returns HTTP 200 for invented paths, so status proves nothing there.
`/schools` has no table at all; `/school-directory` is Ajax-driven and its `<tr>`
elements are one *field* of one school (name, street, city, colors, mascot,
email as six separate rows), not one row per school. The complete authoritative
source is `/ghsa-directory-feed/pdf` — 643 KB, 337 pages, real text layer,
**457 school entries on pages 26-317**, parseable with `pypdf`, already installed.

Each entry looks exactly like this (page 26, verbatim from the real document):

    ACE CHARTER (2-AA)
    5665 New Forsyth Road
    Macon, GA 31210
    Phone:	478-238-5757
    AD:	478-747-4253
    www.acemacon.org
    gryphon@acemacon.org
    Colors:	Royal Blue & Emerald Green
    Mascot:	Gryphon
    Robby Jones P
    Thomas Darrah AD*,1
    Henry Avery 1,5*

Page 25 carries the legend: `P` Principal, `AD` Athletic Director, `1` Football,
`2` Boys Basketball, `3` Girls Basketball, `12` Soccer, `13` Volleyball. A
trailing `*` marks head coach. **Hockey has no GHSA code** — Georgia fields four
of our five sports, which is a fact about Georgia, not a parser bug.

So the PDF yields more than a registry: it yields **every coach's name and sport
per school**. The crawl's job changes from "find whoever is on this page" to
"find the address for this named person" — a stronger provenance story, and a
second scoring surface for Task 8.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py`. No registration needed — `main()` auto-discovers.

```python
import associations.ghsa as ghsa

ENTRY = [
    "ACE CHARTER (2-AA)",
    "5665 New Forsyth Road",
    "Macon, GA 31210",
    "Phone:\t478-238-5757",
    "www.acemacon.org",
    "gryphon@acemacon.org",
    "Colors:\tRoyal Blue & Emerald Green",
    "Mascot:\tGryphon",
    "Robby Jones P",
    "Thomas Darrah AD*,1",
    "Henry Avery 1,5*",
    "Andrea Blair 13",
]


def test_ghsa_parses_school_fields():
    school, _ = ghsa.parse_entry(ENTRY)
    check("school name", school.school, "ACE CHARTER")
    check("classification", school.classification, "2-AA")
    check("city", school.city, "Macon")
    check("state", school.state, "GA")
    check("site_url", school.site_url, "https://www.acemacon.org")
    check("school_id", school.school_id, "ga-ace-charter")


def test_ghsa_parses_roster_with_sports():
    _, roster = ghsa.parse_entry(ENTRY)
    by_name = {r.name: r for r in roster}
    check("roster size", len(roster), 4)
    check("AD also coaches football", by_name["Thomas Darrah"].sports, ["football"])
    check("star means head", by_name["Thomas Darrah"].is_head, True)
    check("track code 5 is not a target", by_name["Henry Avery"].sports, ["football"])
    check("code 13 is volleyball", by_name["Andrea Blair"].sports, ["volleyball"])
    check("principal coaches nothing", by_name["Robby Jones"].sports, [])


def test_ghsa_rejects_a_non_entry():
    check("front matter is not an entry",
          ghsa.parse_entry(["GHSA Staff", "Tim Scott, Executive Director"]), None)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'associations.ghsa'`

- [ ] **Step 3: Write `associations/__init__.py` (empty) and `associations/ghsa.py`**

```python
"""Georgia High School Association member directory, from its PDF feed.

One module per state association. They share no format, so each gets its own
parser and they all return the same two things: schools, and the coaches those
schools list. That uniform return is the contract; the shape of the source is
this module's problem alone.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import _shared  # noqa: F401
import registry_hs
from registry_hs import HSSchool

FEED_URL = "https://www.ghsa.net/ghsa-directory-feed/pdf"

# Page 25, "Key to School Abbreviations". Only the five target sports appear
# here; every other code (baseball, track, tennis, band, one-act play) folds to
# nothing on purpose, so an entry's non-target roles are simply dropped.
# Georgia has no ice-hockey code at all -- that is a fact about Georgia.
SPORT_CODE = {
    "1": "football",
    "2": "basketball",   # boys
    "3": "basketball",   # girls
    "12": "soccer",
    "13": "volleyball",
}

# "ACE CHARTER (2-AA)" -- a school always opens with (region-classification).
_HEAD = re.compile(r"^([A-Z][A-Z0-9 .,&'\-/]+?)\s*\((\d+-[A-Z0-9]+)\)\s*$")
_CITY = re.compile(r"^(.+?),\s*GA\s+(\d{5})")
_SITE = re.compile(r"^(?:www\.|https?://)\S+$", re.I)

# "Thomas Darrah AD*,1" / "Henry Avery 1,5*" / "Robby Jones P"
_CODE = r"(?:[A-Z]{1,4}|\d{1,2}[FB]?)\*?"
_PERSON = re.compile(
    r"^(?P<name>[A-Za-z][A-Za-z.'\-]*(?:\s+[A-Za-z.'\-]+)+?)"
    r"\s+(?P<codes>" + _CODE + r"(?:\s*,\s*" + _CODE + r")*)$"
)


@dataclass
class RosterEntry:
    """One person the association lists at a school, with their sports.

    No email field: the PDF carries only a school-level address. Finding this
    person's own address is what the crawl is for, which is why the name
    matters more here than anywhere else in the pipeline.
    """

    school_id: str = ""
    name: str = ""
    codes: list[str] = field(default_factory=list)
    sports: list[str] = field(default_factory=list)
    is_head: bool = False


def _sports_for(codes: list[str]) -> list[str]:
    out: list[str] = []
    for c in codes:
        s = SPORT_CODE.get(c.rstrip("*"))
        if s and s not in out:
            out.append(s)
    return out


def parse_entry(lines: list[str]) -> "tuple[HSSchool, list[RosterEntry]] | None":
    """One school block -> its record and its roster. None if not an entry.

    The header line is the discriminator: a school always opens
    "NAME (region-class)". Front matter never does, so this returns None for
    staff pages, liaison lists and the GADA officer section without needing to
    know where any of those sections begin or end.
    """
    if not lines:
        return None
    head = _HEAD.match(lines[0].strip())
    if not head:
        return None

    name, classification = head.group(1).strip(), head.group(2).strip()
    school = HSSchool(
        school_id=registry_hs.make_id("GA", name),
        school=name,
        state="GA",
        classification=classification,
    )

    roster: list[RosterEntry] = []
    for raw in lines[1:]:
        line = raw.strip()
        if not line:
            continue
        city = _CITY.match(line)
        if city and not school.city:
            school.city = city.group(1).strip()
            continue
        if _SITE.match(line) and not school.site_url:
            school.site_url = line if line.lower().startswith("http") else "https://" + line
            continue
        if line.startswith(("Phone:", "AD:", "BD:", "Fax:", "Colors:", "Mascot:")):
            continue
        person = _PERSON.match(line)
        if person:
            codes = [c.strip() for c in person.group("codes").split(",")]
            roster.append(RosterEntry(
                school_id=school.school_id,
                name=person.group("name").strip(),
                codes=codes,
                sports=_sports_for(codes),
                is_head=any(c.endswith("*") for c in codes),
            ))
    return school, roster


def parse_pdf(path) -> "tuple[list[HSSchool], list[RosterEntry]]":
    """Split the whole document into entries and parse each one.

    Entries are delimited by their own header line rather than by page, because
    a school's roster can run across a page break.
    """
    from pypdf import PdfReader

    text_lines: list[str] = []
    for page in PdfReader(str(path)).pages:
        text_lines.extend((page.extract_text() or "").split("\n"))

    schools: list[HSSchool] = []
    roster: list[RosterEntry] = []
    block: list[str] = []
    for line in text_lines:
        if _HEAD.match(line.strip()):
            parsed = parse_entry(block)
            if parsed:
                schools.append(parsed[0])
                roster.extend(parsed[1])
            block = [line]
        elif block:
            block.append(line)
    parsed = parse_entry(block)
    if parsed:
        schools.append(parsed[0])
        roster.extend(parsed[1])
    return schools, roster


def fetch_pdf(fetcher, path) -> None:
    """Download the feed. Binary, so this bypasses Fetcher's HTML handling."""
    import requests

    ua = fetcher.session.headers.get("User-Agent", "")
    r = requests.get(FEED_URL, timeout=90, headers={"User-Agent": ua})
    r.raise_for_status()
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(r.content)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `ran 8 tests` / `all passed`

- [ ] **Step 5: Parse the real directory and check the counts**

```bash
cd tools/hs-scraper && python -c "
import collections, csv
import _shared, net, registry_hs
import associations.ghsa as ghsa
ghsa.fetch_pdf(net.Fetcher(), 'data/ghsa_directory.pdf')
schools, roster = ghsa.parse_pdf('data/ghsa_directory.pdf')
registry_hs.save(schools, 'data/ga_schools.csv')
with open('data/ga_roster.csv','w',newline='',encoding='utf-8') as fh:
    w = csv.writer(fh); w.writerow(['school_id','name','codes','sports','is_head'])
    for r in roster:
        w.writerow([r.school_id, r.name, '|'.join(r.codes), '|'.join(r.sports), r.is_head])
print('schools:', len(schools), ' with site_url:', sum(1 for s in schools if s.site_url))
print('roster rows:', len(roster), ' with a target sport:', sum(1 for r in roster if r.sports))
print('by sport:', collections.Counter(s for r in roster for s in r.sports))
"
```

Expected: **schools close to 457**. Roster in the thousands, with a few thousand
carrying a target sport. If schools comes in under 400 the header regex is too
strict — print the unmatched lines and look at them before loosening it.

- [ ] **Step 6: Commit**

```bash
git add tools/hs-scraper/associations/ tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): parse the GHSA directory PDF into schools and rosters

The HTML directory is a trap: ghsa.net returns 200 for invented paths, /schools
has no table, and /school-directory is Ajax-driven with each <tr> holding one
FIELD of one school rather than one school. The complete source is the PDF feed
- 337 pages, 457 entries, real text layer, parsed with pypdf.

It yields more than a registry. Page 25's legend maps 1=Football, 2/3=Basketball,
12=Soccer, 13=Volleyball, with '*' marking head coach, so every entry carries its
coaches BY NAME with their sports. That changes what the crawl is for: not 'find
whoever is on this page' but 'find the address for this named person'.

Georgia has no ice-hockey code - four of our five sports here, by fact not defect.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Crawl units — group schools by the domain that actually serves them

**Files:**
- Create: `tools/hs-scraper/domains.py`
- Modify: `tools/hs-scraper/registry_hs.py` (the `mail_domain` property)
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `registry_hs.HSSchool`.
- Produces:
  `domains.SHARED_CMS: frozenset[str]`,
  `domains.registrable(url: str) -> str`,
  `domains.unit_key(url: str) -> str`,
  `domains.assign(schools) -> dict[str, list[HSSchool]]` (sets `district_domain`
  in place; returns unit key -> schools, largest first).

**What changed, and why this replaces the NCES join.** The original Task 3 joined
NCES/CCD to learn each school's district. Measured against the real data, that is
the wrong source for this question:

*NCES gives a district NAME. The crawl needs a DOMAIN.* "Bibb County" does not
tell you where the mail lives; `bibb.k12.ga.us` does. Turning the name into a
domain would be a guess — the exact class of move that produced the 3.86%-bouncing
Autobuild remainder.

Meanwhile GHSA already hands us `site_url` for **410 of 456** schools, and
grouping those by domain reproduces the district structure directly, measured:

| domain | schools | |
|---|---|---|
| `dekalb.k12.ga.us` | 19 | 12 different cities, one county system |
| `cobbk12.org` | 14 | **exactly** the 14 BookYourData found on that domain |
| `fultonschools.org` | 10 | |
| 94 `*.k12.ga.us` domains | 159 | Georgia's public-district suffix |

**44 domains carry 187 schools; 223 schools hold a domain alone.** That 44 is the
crawl budget for 187 schools — the cost inversion the ADR predicted, now measured
rather than assumed.

**The trap this task exists to avoid.** Grouping naively on the registrable domain
merges schools that share a *CMS host* but nothing else:

    colquitt.high.schooldesk.net     Colquitt County
    clayton.315.schooldesk.net       Clayton County
    emanuel2.eci.schooldesk.net      Emanuel County
    emanuel2.shs.schooldesk.net      Emanuel County
    mcintosh.mcs.schooldesk.net      McIntosh County

`schooldesk.net` is not a district — it is a vendor. Four unrelated county systems
would collapse into one unit, and the crawler would fetch one staff directory and
attribute it to all of them. Note also that the *leftmost* label is the real
district (`emanuel2` appears twice, correctly). So for a shared-CMS host the unit
key is the full hostname: each host stands alone. That over-splits Emanuel into
two units — one wasted fetch — which is the safe direction to err.

**`is_public` is no longer load-bearing.** It stays as description. The crawl
distinction the ADR framed as public-vs-private is answered better by measurement:
a unit holding several schools is a district directory, a unit holding one is a
school site. NCES moves to Task 4, where it belongs — resolving the 46 schools
that have no `site_url` at all.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py` (auto-discovered; no registration):

```python
import domains


def test_registrable_handles_the_k12_public_suffix():
    check("k12.ga.us keeps the district label",
          domains.registrable("https://www.dekalb.k12.ga.us/staff"), "dekalb.k12.ga.us")
    check("ordinary domain", domains.registrable("http://cobbk12.org/x"), "cobbk12.org")
    check("strips www", domains.registrable("https://www.hallco.org"), "hallco.org")
    check("blank url", domains.registrable(""), "")


def test_unit_key_keeps_shared_cms_hosts_apart():
    # Four unrelated county systems live on schooldesk.net. They are not one unit.
    a = domains.unit_key("http://colquitt.high.schooldesk.net")
    b = domains.unit_key("http://clayton.315.schooldesk.net")
    check("colquitt keeps its own host", a, "colquitt.high.schooldesk.net")
    check("clayton does not join it", b, "clayton.315.schooldesk.net")
    check("they are different units", a == b, False)


def test_unit_key_groups_a_real_district():
    check("same district, different schools",
          domains.unit_key("https://www.dekalb.k12.ga.us/a")
          == domains.unit_key("http://dekalb.k12.ga.us/b"), True)


def test_assign_sets_district_domain_and_orders_by_size():
    mk = lambda i, u: registry_hs.HSSchool(school_id=f"ga-{i}", school=str(i),
                                           state="GA", site_url=u)
    schools = [mk(1, "http://cobbk12.org/a"), mk(2, "http://cobbk12.org/b"),
               mk(3, "http://wesleyan.org"), mk(4, "")]
    units = domains.assign(schools)
    check("largest unit first", list(units)[0], "cobbk12.org")
    check("shared unit has both", len(units["cobbk12.org"]), 2)
    check("district_domain set", schools[0].district_domain, "cobbk12.org")
    check("solo school gets its own", schools[2].district_domain, "wesleyan.org")
    check("no site_url yields no unit", schools[3].district_domain, "")
    check("unresolved school is in no unit",
          any(schools[3] in v for v in units.values()), False)


def test_mail_domain_no_longer_branches_on_is_public():
    # A public school whose district_domain was never resolved must NOT report a
    # blank mail domain while it has a site_url of its own.
    s = registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                             is_public=True, site_url="https://bowdon.org")
    check("falls back to its own host", s.mail_domain, "bowdon.org")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'domains'`

- [ ] **Step 3: Write `domains.py`**

```python
"""Group schools by the domain that actually serves their mail.

The crawl unit is the domain, not the school. Georgia proves why: 44 domains
carry 187 of 410 schools, and one of them (dekalb.k12.ga.us) carries 19 across
12 cities. Fetch a district's staff directory once and you have resolved a
dozen schools.

This is measured, never inferred. The school's own published site_url decides
its unit -- no step anywhere turns a district NAME into a district DOMAIN,
because that guess is the same move that produced this project's worst-
bouncing cohort.
"""

from __future__ import annotations

import collections
import re

import _shared  # noqa: F401
from registry_hs import HSSchool

# Hosts that serve many unrelated districts. A school on one of these shares a
# VENDOR, not an organisation -- four separate Georgia county systems sit on
# schooldesk.net. Treating them as one unit would attribute one staff directory
# to all of them, so each keeps its own full hostname and is crawled alone.
SHARED_CMS = frozenset({
    "schooldesk.net", "schoolinsites.com", "edlio.net", "edlioschool.com",
    "finalsite.com", "sharpschool.com", "sharpschool.net", "schoolwires.net",
    "apptegy.io", "thrillshare.com", "squarespace.com", "wixsite.com",
    "weebly.com", "godaddysites.com", "wordpress.com", "blogspot.com",
})

# Multi-label public suffixes. "dekalb.k12.ga.us" is one organisation; taking
# the last two labels would collapse all 94 Georgia district domains into
# "ga.us" -- a single fake unit holding 159 schools.
_MULTI = ("co.us", "ga.us", "sch.uk")
_K12 = re.compile(r"\.k12\.[a-z]{2}\.us$")


def _host(url: str) -> str:
    h = re.sub(r"^https?://", "", (url or "").strip()).split("/")[0].lower()
    return re.sub(r"^www\.", "", h).strip().rstrip(".")


def registrable(url: str) -> str:
    """The organisation's domain, respecting k12.XX.us as a public suffix."""
    h = _host(url)
    if not h:
        return ""
    if _K12.search(h):
        # a.b.dekalb.k12.ga.us -> dekalb.k12.ga.us
        head, _, tail = h.rpartition(".k12.")
        return f"{head.split('.')[-1]}.k12.{tail}" if head else h
    for suf in _MULTI:
        if h.endswith("." + suf):
            return f"{h[: -(len(suf) + 1)].split('.')[-1]}.{suf}"
    parts = h.split(".")
    return ".".join(parts[-2:]) if len(parts) > 1 else h


def unit_key(url: str) -> str:
    """The crawl unit. Shared-CMS hosts stay whole; everything else collapses.

    Over-splitting costs one extra fetch. Under-splitting attributes one
    school's staff directory to another school entirely, which is a data
    error that no later filter can detect.
    """
    h = _host(url)
    if not h:
        return ""
    reg = registrable(url)
    return h if reg in SHARED_CMS else reg


def assign(schools: list[HSSchool]) -> "dict[str, list[HSSchool]]":
    """Set district_domain in place; return units, largest first.

    A school with no site_url gets no unit and keeps a blank district_domain.
    It is unresolved, and Task 4 resolves it -- it is never guessed at.
    """
    units: dict[str, list[HSSchool]] = collections.defaultdict(list)
    for s in schools:
        key = unit_key(s.site_url)
        if not key:
            continue
        s.district_domain = key
        units[key].append(s)
    return dict(sorted(units.items(), key=lambda kv: (-len(kv[1]), kv[0])))
```

- [ ] **Step 4: Fix `mail_domain` in `registry_hs.py`**

The property currently reads:

```python
    @property
    def mail_domain(self) -> str:
        """The domain this school's coach addresses are expected to be on."""
        return self.district_domain if self.is_public else _host(self.site_url)
```

Replace its body with:

```python
    @property
    def mail_domain(self) -> str:
        """The domain this school's coach addresses are expected to be on.

        Measured, not inferred: district_domain is assigned from the school's
        own published site in Task 3, so a public school and a private one are
        resolved the same way. is_public no longer steers this -- a public
        school whose district was never resolved must still fall back to its
        own host rather than report nothing.
        """
        return self.district_domain or _host(self.site_url)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: all passing, count increased by 5.

- [ ] **Step 6: Assign the real units and record the shape**

```bash
cd tools/hs-scraper && python -c "
import _shared, registry_hs, domains
schools = registry_hs.load('data/ga_schools.csv')
units = domains.assign(schools)
registry_hs.save(schools, 'data/ga_schools.csv')
multi = {k: v for k, v in units.items() if len(v) > 1}
print('schools:', len(schools), ' resolved:', sum(1 for s in schools if s.district_domain))
print('units:', len(units), ' shared:', len(multi), 'carrying',
      sum(len(v) for v in multi.values()), 'schools')
print('unresolved (no site_url):', sum(1 for s in schools if not s.district_domain))
for k, v in list(units.items())[:12]:
    print(f'  {len(v):3}  {k}')
cms = [k for k in units if any(k.endswith(c) for c in domains.SHARED_CMS)]
print('shared-CMS units kept separate:', len(cms))
"
```

Expected: ~267 units for 410 resolved schools, ~44 of them shared and carrying
~187 schools, 46 unresolved. `dekalb.k12.ga.us` leads with 19. If any unit
exceeds ~25 schools, check it is a real county system and not a vendor host that
belongs in `SHARED_CMS`.

- [ ] **Step 7: Commit**

```bash
git add tools/hs-scraper/domains.py tools/hs-scraper/registry_hs.py tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): crawl units measured from the domains schools publish

Replaces the planned NCES district join. NCES gives a district NAME; the crawl
needs a DOMAIN, and turning one into the other is a guess - the same move that
produced this project's worst-bouncing cohort. GHSA already publishes site_url
for 410 of 456 schools, so the district structure can be measured instead.

It reproduces exactly: 44 domains carry 187 schools, dekalb.k12.ga.us leads with
19 across 12 cities, and cobbk12.org shows 14 - the same 14 BookYourData found
on that domain independently.

Two traps handled. k12.ga.us is a public suffix, so naive last-two-labels would
collapse 94 Georgia district domains into one fake unit of 159 schools. And
schooldesk.net is a VENDOR carrying four unrelated county systems, so shared-CMS
hosts keep their full hostname and are crawled alone - over-splitting costs one
fetch, under-splitting attributes one school's directory to another.

is_public stops steering mail_domain; it is description now, not routing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The crawl manifest — named coaches, grouped by the domain that serves them

**Files:**
- Create: `tools/hs-scraper/manifest.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `registry_hs.HSSchool`, `domains.assign`, `associations.ghsa.RosterEntry`.
- Produces:
  `manifest.CrawlUnit` dataclass (`domain, schools, targets, is_shared`),
  `manifest.build(schools, roster) -> list[CrawlUnit]` (largest first),
  `manifest.unresolved(schools) -> list[HSSchool]`,
  `manifest.save(units, path) -> None`.

**What changed, and why this replaces "domain resolution".** Task 4 was written to
resolve each school to a district or school domain, with NCES as the source. Two
measurements since have removed almost all of that work:

- Task 3 now assigns the domain directly from what each school publishes.
- Probing the GHSA PDF found a school-level email on 416 of 456 blocks, a website
  on 410, and **at least one of the two on 449 — 98.5%.**

**Seven schools have neither**: DALTON ACADEMY, DECATUR, DISCOVERY,
GEORGIA-CUMBERLAND ACADEMY, SOUTH EFFINGHAM, UTOPIAN ACADEMY, WILSON ACADEMY.
Seven does not justify a national NCES download, a fuzzy name join, or a network
probe. They are **recorded as unresolved and skipped**, and if they matter later a
human can paste seven domains into the registry by hand in two minutes.

**Name-matching is banned here, and this is why.** Resolving an unresolved school
by matching its name against known district labels was probed and produced 11
matches of which at least 5 were wrong — `CENTRAL, CARROLL` → `centralgwinnett.net`
(Carroll County matched to Gwinnett on the word "central"), `RANDOLPH-CLAY` →
`clayton.k12.ga.us`, `SAVANNAH EARLY COLLEGE` → `early.k12.ga.us` ("Early" is a
county; here it is a school type), and `SOUTHWEST ATLANTA CHRISTIAN`, a private
school, → `atlantapublicschools.us`. Every one of those would send a crawl to a
domain holding other people's addresses. **No code in this task may infer a domain
from a name.**

**What this task is actually for.** Task 2 gave us something the ADR did not
anticipate: **8,282 roster rows naming a real coach and their sport.** Combined
with Task 3's domains, the crawl's job stops being "find whoever is on this page"
and becomes "find the address for *this named person* on *this domain*". The
manifest is that work list, and it is what makes the later scoring meaningful —
a hit is a named person matched, not a stray address scraped.

**The names in this manifest are for MATCHING, never for CONSTRUCTING.** Nothing
downstream may combine a name with a domain to synthesise an address. The manifest
holds names so a crawler can *recognise* them on a page it fetched.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py` (auto-discovered; no registration):

```python
import manifest
import associations.ghsa as _ghsa


def _school(i, dom, site=""):
    return registry_hs.HSSchool(school_id=f"ga-{i}", school=str(i), state="GA",
                                district_domain=dom, site_url=site)


def _entry(sid, name, sports):
    return _ghsa.RosterEntry(school_id=sid, name=name, codes=[], sports=sports)


def test_build_groups_targets_under_their_school_domain():
    schools = [_school(1, "cobbk12.org"), _school(2, "cobbk12.org"),
               _school(3, "wesleyan.org")]
    roster = [_entry("ga-1", "Ann Reed", ["football"]),
              _entry("ga-2", "Bo Katz", ["volleyball"]),
              _entry("ga-3", "Cy Doe", ["soccer"])]
    units = manifest.build(schools, roster)
    check("two units", len(units), 2)
    check("largest first", units[0].domain, "cobbk12.org")
    check("shared unit holds both schools", len(units[0].schools), 2)
    check("and both their coaches", len(units[0].targets), 2)
    check("shared flag set", units[0].is_shared, True)
    check("solo unit not flagged shared", units[1].is_shared, False)


def test_build_drops_roster_rows_with_no_target_sport():
    schools = [_school(1, "cobbk12.org")]
    roster = [_entry("ga-1", "Ann Reed", ["football"]),
              _entry("ga-1", "Pat Null", [])]          # principal, AD-only, band
    units = manifest.build(schools, roster)
    check("only the coach is a target", [t.name for t in units[0].targets],
          ["Ann Reed"])


def test_build_skips_schools_with_no_domain():
    schools = [_school(1, ""), _school(2, "cobbk12.org")]
    roster = [_entry("ga-1", "Ghost Coach", ["football"]),
              _entry("ga-2", "Real Coach", ["football"])]
    units = manifest.build(schools, roster)
    check("one unit only", len(units), 1)
    check("the unresolved school's coach is not smuggled in",
          [t.name for t in units[0].targets], ["Real Coach"])
    check("and it is reported unresolved",
          [s.school_id for s in manifest.unresolved(schools)], ["ga-1"])


def test_build_never_synthesises_an_address():
    # The manifest carries names so a crawler can RECOGNISE them. If any field
    # of a target ever contains an "@", something has constructed an address.
    schools = [_school(1, "cobbk12.org")]
    units = manifest.build(schools, [_entry("ga-1", "Ann Reed", ["football"])])
    t = units[0].targets[0]
    check("no address anywhere on the target",
          any("@" in str(v) for v in vars(t).values()), False)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'manifest'`

- [ ] **Step 3: Write `manifest.py`**

```python
"""The crawl work list: which named coaches to look for, on which domain.

The association directory named 8,282 coaches and their sports. Task 3 resolved
each school to the domain that actually serves its mail. Putting those together
changes what the crawler is doing: not "scrape whoever appears on this page" but
"find the address for THIS person on THIS domain".

That matters for scoring. A hit is a named coach matched against a page, which
is evidence. An address scraped off a page with no name attached is not.

THE NAMES HERE ARE FOR MATCHING, NEVER FOR CONSTRUCTING. Nothing in this module
or downstream of it may combine a name with a domain to produce an address.
Formula generation is the defect that produced this project's worst-bouncing
cohort, and there is deliberately no code path for it.
"""

from __future__ import annotations

import collections
import csv
from dataclasses import dataclass, field
from pathlib import Path

import _shared  # noqa: F401
from registry_hs import HSSchool


@dataclass
class CrawlUnit:
    """One domain, the schools it serves, and the coaches to find there."""

    domain: str = ""
    schools: list = field(default_factory=list)
    targets: list = field(default_factory=list)

    @property
    def is_shared(self) -> bool:
        """More than one school here means a district staff directory.

        Measured, not assumed: one fetch of a shared domain can resolve a dozen
        schools, which is the whole reason the crawl is affordable.
        """
        return len(self.schools) > 1


def unresolved(schools: list[HSSchool]) -> list[HSSchool]:
    """Schools with no domain at all. Reported, never guessed at."""
    return [s for s in schools if not s.mail_domain]


def build(schools: list[HSSchool], roster: list) -> list[CrawlUnit]:
    """Group schools and their sport-carrying coaches by mail domain.

    Ordered largest first so a run that is interrupted has already done the
    units that resolve the most schools.
    """
    by_id = {s.school_id: s for s in schools}
    units: dict[str, CrawlUnit] = {}
    for s in schools:
        dom = s.mail_domain
        if not dom:
            continue
        units.setdefault(dom, CrawlUnit(domain=dom)).schools.append(s)

    for entry in roster:
        if not getattr(entry, "sports", None):
            continue                      # principals, ADs, band, baseball
        school = by_id.get(entry.school_id)
        if school is None or not school.mail_domain:
            continue                      # unresolved school: no unit to join
        units[school.mail_domain].targets.append(entry)

    return sorted(units.values(), key=lambda u: (-len(u.schools), u.domain))


def save(units: list[CrawlUnit], path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["domain", "is_shared", "schools", "targets", "school_ids"])
        for u in units:
            w.writerow([u.domain, u.is_shared, len(u.schools), len(u.targets),
                        "|".join(s.school_id for s in u.schools)])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: all passing, count increased by 4.

- [ ] **Step 5: Build the real manifest and record the shape**

```bash
cd tools/hs-scraper && python -c "
import csv
import _shared, registry_hs, manifest
import associations.ghsa as ghsa
schools = registry_hs.load('data/ga_schools.csv')
roster = [ghsa.RosterEntry(school_id=r['school_id'], name=r['name'],
                           codes=r['codes'].split('|') if r['codes'] else [],
                           sports=r['sports'].split('|') if r['sports'] else [],
                           is_head=r['is_head'] == 'True')
          for r in csv.DictReader(open('data/ga_roster.csv', encoding='utf-8'))]
units = manifest.build(schools, roster)
manifest.save(units, 'data/ga_manifest.csv')
shared = [u for u in units if u.is_shared]
print('units:', len(units), ' shared:', len(shared))
print('schools covered:', sum(len(u.schools) for u in units),
      ' unresolved:', len(manifest.unresolved(schools)))
print('named coaches to find:', sum(len(u.targets) for u in units))
print()
for u in units[:12]:
    print(f'  {len(u.schools):3} schools  {len(u.targets):5} coaches  {u.domain}')
"
```

Expected: roughly 250-280 units covering 449 schools, ~7 unresolved, and a few
thousand named coaches. The largest units should be recognisable county systems.
**If any single unit holds more than ~25 schools, inspect it** — it is either a
genuinely large county system or a vendor host that belongs in
`domains.SHARED_CMS`, and the difference matters: a vendor host would attribute
one district's directory to several unrelated districts.

- [ ] **Step 6: Commit**

```bash
git add tools/hs-scraper/manifest.py tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): crawl manifest of named coaches per mail domain

Replaces the planned NCES domain-resolution task, which measurement made almost
entirely unnecessary: the GHSA directory carries an email for 416 of 456 schools
and a website for 410, and at least one of the two for 449 - 98.5%. Seven schools
have neither; they are recorded unresolved and skipped rather than guessed at.

Name-matching to resolve those seven was probed and rejected. It produced 11
matches of which at least 5 were wrong, including CENTRAL, CARROLL -> Gwinnett's
domain and a private school routed to Atlanta Public Schools. No code here infers
a domain from a name.

What the slot is used for instead: Task 2 yielded 8,282 roster rows naming a real
coach and their sport, which the ADR did not anticipate. Joined to Task 3's
domains, the crawl stops being 'scrape whoever is on this page' and becomes 'find
the address for THIS person on THIS domain' - so a hit is a named coach matched,
which is evidence, rather than a loose address, which is not.

The names are for matching, never for constructing. There is no code path from a
name to an address, by design.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Discovery and crawl into the archive

**Files:**
- Create: `tools/hs-scraper/discover_hs.py`
- Create: `tools/hs-scraper/crawl_hs.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `net.Fetcher`, `net.Fetched`, `archive.Archive`, `config_hs.STAFF_LINK_WORDS`,
  `config_hs.STAFF_PATHS`, `config_hs.MIN_EMAILS_FOR_DIRECTORY`,
  `adapters.base.emails_in`.
- Produces: `discover_hs.score_link(text: str, href: str) -> int`,
  `discover_hs.best_staff_links(html: str, base_url: str, limit: int = 5) -> list[str]`,
  `discover_hs.looks_like_directory(html: str) -> bool`,
  `crawl_hs.crawl_target(fetcher, arch, target_id, start_url) -> str` returning a status
  string of `"ok" | "no-directory" | "unreachable"`.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py`:

```python
import discover_hs

NAV = """
<html><body>
  <a href="/about">About Us</a>
  <a href="/athletics/staff-directory">Staff Directory</a>
  <a href="/athletics">Athletics</a>
  <a href="/lunch-menu">Lunch Menu</a>
</body></html>
"""

DIRECTORY = """
<table>
 <tr><td>Jane Doe</td><td>Head Volleyball Coach</td>
     <td><a href="mailto:jane.doe@gcpsk12.org">jane.doe@gcpsk12.org</a></td></tr>
 <tr><td>John Roe</td><td>Assistant Football Coach</td>
     <td><a href="mailto:john.roe@gcpsk12.org">john.roe@gcpsk12.org</a></td></tr>
 <tr><td>Ann Poe</td><td>Head Soccer Coach</td>
     <td><a href="mailto:ann.poe@gcpsk12.org">ann.poe@gcpsk12.org</a></td></tr>
</table>
"""

STYLED_404 = "<html><body><h1>Page Not Found</h1><p>Sorry.</p></body></html>"


def test_score_link_prefers_staff_directory():
    hi = discover_hs.score_link("Staff Directory", "/athletics/staff-directory")
    lo = discover_hs.score_link("Lunch Menu", "/lunch-menu")
    if hi <= lo:
        FAILURES.append(f"staff directory should outscore lunch menu: {hi} vs {lo}")


def test_best_staff_links_orders_by_score():
    links = discover_hs.best_staff_links(NAV, "https://x.org")
    check("best link is the staff directory", links[0],
          "https://x.org/athletics/staff-directory")


def test_looks_like_directory_accepts_real_page():
    check("real directory accepted", discover_hs.looks_like_directory(DIRECTORY), True)


def test_looks_like_directory_rejects_styled_404():
    check("styled 404 rejected", discover_hs.looks_like_directory(STYLED_404), False)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'discover_hs'`

- [ ] **Step 3: Write `discover_hs.py`**

```python
"""Homepage -> staff directory, by scoring every link rather than taking the first.

The college crawler learned this the expensive way: taking the first plausible
link found the wrong page often enough to matter, and scoring every candidate
then adding a direct-path fallback lifted yield from 65% to 79%. The same shape
applies here with a school vocabulary instead of an athletics one.
"""

from __future__ import annotations

import html as _html
import re
from urllib.parse import urljoin

import _shared  # noqa: F401
import config_hs
from adapters.base import emails_in

_ANCHOR = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
_NOT_FOUND = re.compile(
    r"\b(page not found|404|no longer available|doesn'?t exist|cannot be found)\b", re.I
)


def _text(fragment: str) -> str:
    return _html.unescape(_TAGS.sub(" ", fragment)).replace("\xa0", " ").strip()


def score_link(text: str, href: str) -> int:
    """Higher means more likely to be a page listing people with addresses."""
    hay = f"{text} {href}".lower()
    score = 0
    for word, weight in config_hs.STAFF_LINK_WORDS:
        if word in hay:
            score += weight
    # A link whose text is exactly the phrase beats one that merely contains it.
    if text.strip().lower() in ("staff directory", "coaching staff", "coaches"):
        score += 4
    return score


def best_staff_links(html: str, base_url: str, limit: int = 5) -> list[str]:
    scored: list[tuple[int, str]] = []
    seen: set[str] = set()
    for href, frag in _ANCHOR.findall(html or ""):
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urljoin(base_url, href)
        if url in seen:
            continue
        seen.add(url)
        s = score_link(_text(frag), href)
        if s > 0:
            scored.append((s, url))
    scored.sort(key=lambda t: -t[0])
    return [u for _, u in scored[:limit]]


def direct_candidates(base_url: str) -> list[str]:
    base = base_url.rstrip("/")
    return [base + p for p in config_hs.STAFF_PATHS]


def looks_like_directory(html: str) -> bool:
    """A page is a directory only if it actually lists people.

    HTTP 200 is not a page. Styled 404s return 200 with a friendly message and
    parse into garbage, so the test is content-based: enough distinct addresses
    to be a listing, and no not-found language.
    """
    if not html:
        return False
    if _NOT_FOUND.search(html[:4000]):
        return False
    return len(set(emails_in(html))) >= config_hs.MIN_EMAILS_FOR_DIRECTORY
```

- [ ] **Step 4: Write `crawl_hs.py`**

```python
"""Drive the fetcher into the archive. Archive first, parse later, always.

Storing every page compressed means a parser change re-runs over the whole
corpus at zero network cost. On the college crawl that turned each adapter
revision from an hours-long re-fetch into a seconds-long re-parse, which is the
only reason iterating on parsers was affordable at all.
"""

from __future__ import annotations

import _shared  # noqa: F401
import archive
import discover_hs
import net


def crawl_target(fetcher: "net.Fetcher", arch: "archive.Archive",
                 target_id: str, start_url: str) -> str:
    """Fetch one district or private school. Returns ok | no-directory | unreachable."""
    home = fetcher.get(start_url)
    if not home.ok:
        arch.set_status(target_id, "unreachable", error=f"{home.status} {home.error}")
        return "unreachable"

    arch.store_page(target_id, "home", start_url, home.final_url,
                    home.status, home.html, "", None)

    candidates = discover_hs.best_staff_links(home.html, home.final_url)
    candidates += [u for u in discover_hs.direct_candidates(home.final_url)
                   if u not in candidates]

    for url in candidates:
        page = fetcher.get(url)
        if not page.ok:
            continue
        if not discover_hs.looks_like_directory(page.html):
            continue
        arch.store_page(target_id, "staff", url, page.final_url,
                        page.status, page.html, "", None)
        arch.set_status(target_id, "ok")
        return "ok"

    arch.set_status(target_id, "no-directory")
    return "no-directory"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `all passed`

- [ ] **Step 6: Crawl Metro Atlanta and report coverage**

```bash
cd tools/hs-scraper && python -c "
import _shared, archive, net, registry_hs, resolve_hs, crawl_hs
schools = registry_hs.load('data/ga_schools.csv')
arch = archive.Archive('data/hs_archive.sqlite')
f = net.Fetcher()
targets = []
for d, members in resolve_hs.district_groups(schools).items():
    if members[0].district_domain:
        targets.append((f'district:{d}', 'https://' + members[0].district_domain))
for s in schools:
    if not s.is_public and s.site_url:
        targets.append((s.school_id, s.site_url))
from collections import Counter
c = Counter(crawl_hs.crawl_target(f, arch, tid, url) for tid, url in targets)
print(dict(c)); print(arch.stats()); arch.close()
"
```

Expected: a majority `ok`. Record the counts — Task 8 interprets recall against them.

- [ ] **Step 7: Commit**

```bash
git add tools/hs-scraper/discover_hs.py tools/hs-scraper/crawl_hs.py \
        tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): staff-directory discovery and archiving crawl

Scores every candidate link rather than taking the first match - on the college
crawl that plus a direct-path fallback lifted yield 65% -> 79%.

looks_like_directory() is content-based, not status-based: a styled 404 returns
200 with friendly copy and parses into garbage, so a page counts as a directory
only when it lists at least MIN_EMAILS_FOR_DIRECTORY distinct addresses and
carries no not-found language.

Archive first, parse later. Every page is stored compressed so a parser change
re-runs over the corpus at zero network cost.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Generic proximity adapter

**Files:**
- Create: `tools/hs-scraper/adapters_hs/__init__.py`
- Create: `tools/hs-scraper/adapters_hs/generic.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `adapters.base.Adapter`, `adapters.base.CoachRecord`, `adapters.base.emails_in`,
  `adapters.base.PHONE`.
- Produces: `generic.GenericHS` with `detect(html) -> bool` and
  `parse(html, ctx) -> list[CoachRecord]`; `generic.blocks(html) -> list[str]`.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py`:

```python
from adapters_hs.generic import GenericHS

TABLE_DIR = """
<table>
 <tr><td>Jane Doe</td><td>Head Volleyball Coach</td>
     <td><a href="mailto:jane.doe@gcpsk12.org">email</a></td><td>770-555-0101</td></tr>
 <tr><td>John Roe</td><td>Assistant Football Coach</td>
     <td><a href="mailto:john.roe@gcpsk12.org">email</a></td></tr>
</table>
"""

CARD_DIR = """
<div class="staff-card"><h3>Ann Poe</h3><p>Head Soccer Coach</p>
  <a href="mailto:ann.poe@cobbk12.org">ann.poe@cobbk12.org</a></div>
<div class="staff-card"><h3>Ed Loe</h3><p>Athletic Director</p>
  <a href="mailto:ed.loe@cobbk12.org">ed.loe@cobbk12.org</a></div>
"""

CTX = {"school": "Test HS", "school_id": "ga-test", "state": "GA",
       "proof_url": "https://x.org/staff", "captured_at": "2026-09-16T00:00:00Z"}


def test_generic_parses_table_rows():
    rows = GenericHS().parse(TABLE_DIR, CTX)
    check("table row count", len(rows), 2)
    by_email = {r.email: r for r in rows}
    jane = by_email["jane.doe@gcpsk12.org"]
    check("table name", jane.name, "Jane Doe")
    check("table title", jane.title, "Head Volleyball Coach")
    check("table phone", jane.phone, "770-555-0101")
    check("table proof_url carried", jane.proof_url, "https://x.org/staff")


def test_generic_parses_cards():
    rows = GenericHS().parse(CARD_DIR, CTX)
    check("card row count", len(rows), 2)
    by_email = {r.email: r for r in rows}
    check("card title", by_email["ann.poe@cobbk12.org"].title, "Head Soccer Coach")


def test_generic_never_invents_an_address():
    html = "<div><h3>Someone With No Email</h3><p>Head Coach</p></div>"
    rows = GenericHS().parse(html, CTX)
    check("no email means no row", len(rows), 0)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'adapters_hs'`

- [ ] **Step 3: Write `adapters_hs/__init__.py` and `adapters_hs/generic.py`**

`adapters_hs/__init__.py` is empty.

```python
"""Proximity parser: the fallback that has to work everywhere.

High schools do not share a platform the way colleges share Sidearm. Rather
than guess at a dozen CMSs up front, this adapter anchors on the one thing
every directory has -- an address -- and reads the name and title from the
markup immediately around it.

It is built and MEASURED first. Platform-specific adapters get written only for
the gap this leaves, which keeps that work driven by recall data instead of by
a list of vendor names.

It never constructs an address. A block with no address yields no row.
"""

from __future__ import annotations

import html as _html
import re

import _shared  # noqa: F401
from adapters.base import Adapter, CoachRecord, PHONE, emails_in

# Split on the containers directories actually use. Each block should hold at
# most one person; over-splitting loses the title, under-splitting crosses two
# people's details, so these are the boundaries worth trusting.
_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")

# A person's name: two-to-four capitalised words, no digits.
_NAME = re.compile(r"\b([A-Z][a-z'\-]+(?:\s+[A-Z][a-z'\-\.]+){1,3})\b")

# Title words that mark a row as staff worth keeping.
_ROLE = re.compile(
    r"(?i)\b(head|assistant|asst\.?|associate|interim|volunteer|coach|coordinator|"
    r"director|trainer|athletic)\b"
)


def _flat(fragment: str) -> str:
    return _SPACE.sub(" ", _html.unescape(_TAGS.sub(" ", fragment))).strip()


# How far either side of an address to look for that person's name and title.
# Wide enough to clear a table row or a card, narrow enough not to reach the
# next person. Re-tune against real pages in Task 8; do not guess further here.
WINDOW_BEFORE = 400
WINDOW_AFTER = 200


def blocks(html: str) -> list[str]:
    """One window per address, centred where the address appears.

    NOT regex container matching. A container pattern with a backreference
    cannot nest: against an outer div wrapping inner cards it matches through
    the FIRST closing tag, keeping the outer opener and losing every inner
    card. Real staff directories nest three or four deep, so that approach
    silently under-extracts exactly where it matters most -- and flat test
    fixtures never reveal it.

    Anchoring on the address needs no well-formed markup at all, which is the
    same principle this adapter already rests on: the address is the one
    element every directory truly has.
    """
    html = html or ""
    low = html.lower()
    windows: list[str] = []
    for addr in set(emails_in(html)):
        idx = low.find(addr.lower())
        if idx < 0:
            continue
        start = max(0, idx - WINDOW_BEFORE)
        windows.append(html[start: idx + len(addr) + WINDOW_AFTER])
    return windows


class GenericHS(Adapter):
    name = "generic-hs"

    def detect(self, html: str) -> bool:
        return len(set(emails_in(html))) >= 3

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        out: list[CoachRecord] = []
        seen: set[str] = set()
        for block in blocks(html):
            addrs = emails_in(block)
            if not addrs:
                continue                      # no address, no row. Never invented.
            email = addrs[0]
            if email in seen:
                continue
            seen.add(email)

            text = _flat(block)
            name_m = _NAME.search(text)
            name = name_m.group(1).strip() if name_m else ""

            # The title is the role-bearing run of text, minus the name itself.
            title = ""
            for part in re.split(r"\s{2,}|\||•|,", text):
                part = part.strip()
                if part and part != name and _ROLE.search(part) and len(part) < 90:
                    title = part
                    break

            phone_m = PHONE.search(block)

            rec = CoachRecord(**Adapter._seed(ctx))
            rec.name = name
            rec.title = title
            rec.email = email
            rec.phone = phone_m.group(1) if phone_m else ""
            rec.platform = self.name
            out.append(rec)
        return out
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `all passed`

- [ ] **Step 5: Commit**

```bash
git add tools/hs-scraper/adapters_hs/ tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): generic proximity adapter

High schools share no platform the way colleges share Sidearm, so rather than
guess at a dozen CMSs this anchors on the one thing every directory has - an
address - and reads name and title from the markup around it.

Built and measured FIRST. Platform-specific adapters get written only for the
gap this leaves, so that work is driven by recall data rather than a list of
vendor names.

A block with no address yields no row. There is no code path that constructs an
address from a name.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Quality gates and export

**Files:**
- Create: `tools/hs-scraper/gates_hs.py`
- Create: `tools/hs-scraper/export_hs.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `adapters.base.CoachRecord`, `normalize.normalize`, `normalize.dedupe`,
  `config_hs.MAX_DOMAINS_PER_LOCAL_PART`.
- Produces: `gates_hs.status_for(rec) -> str`,
  `gates_hs.entropy_report(records) -> dict[str, int]`,
  `gates_hs.assert_entropy(records) -> None` (raises `EntropyError`),
  `gates_hs.keep(rec) -> bool`,
  `export_hs.to_csv(records, path) -> int`,
  `export_hs.to_sql(records, path, source) -> int`.

- [ ] **Step 1: Write the failing test**

Add to `tests_hs.py`:

```python
import gates_hs
from adapters.base import CoachRecord


def _rec(email, title="Head Coach", proof="https://x.org/staff"):
    return CoachRecord(name="A B", title=title, email=email, proof_url=proof,
                       school="S", state="GA", sport="football")


def test_status_requires_proof_url():
    check("no proof_url is unverified",
          gates_hs.status_for(_rec("a@x.org", proof="")), "unverified")


def test_status_requires_title():
    check("no title is unverified",
          gates_hs.status_for(_rec("a@x.org", title="")), "unverified")


def test_status_active_when_both_present():
    check("proof + title is active", gates_hs.status_for(_rec("a@x.org")), "active")


def test_entropy_flags_repeated_local_part():
    recs = [_rec(f"performance@d{i}.org") for i in range(5)]
    report = gates_hs.entropy_report(recs)
    check("repeated local part counted", report.get("performance"), 5)
    raised = False
    try:
        gates_hs.assert_entropy(recs)
    except gates_hs.EntropyError:
        raised = True
    check("entropy gate raises", raised, True)


def test_keep_drops_rows_with_no_target_sport():
    # normalize() returns None only when the EMAIL is missing -- a row whose
    # title folds to no sport survives it. The spec says drop those.
    ad = _rec("ad@x.org", title="Athletic Director")
    ad.sport = ""
    fb = _rec("fb@x.org", title="Head Football Coach")
    fb.sport = "football"
    check("sportless row dropped", gates_hs.keep(ad), False)
    check("target-sport row kept", gates_hs.keep(fb), True)


def test_entropy_allows_normal_names():
    recs = [_rec(f"person{i}@d{i}.org") for i in range(20)]
    raised = False
    try:
        gates_hs.assert_entropy(recs)
    except gates_hs.EntropyError:
        raised = True
    check("normal list passes entropy", raised, False)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'gates_hs'`

- [ ] **Step 3: Write `gates_hs.py`**

```python
"""The gates, enforced in code rather than by discipline.

Each one exists because something measurable went wrong:

  proof_url  Three fabricated families reached coach_contacts carrying
             validated=true. A row that cannot name the page it came from is
             not evidence of anything.
  title      Crawl-recovered titles bounce at 0.73%; untitled rows at 3.86%.
             The title is not seniority, it is proof a live page listed that
             person -- so a row without one is not a contact.
  entropy    performance@ appeared at 24 distinct domains. No real directory
             produces one identically-named mailbox at two dozen schools.
"""

from __future__ import annotations

from collections import defaultdict

import _shared  # noqa: F401
import config_hs
from adapters.base import CoachRecord


class EntropyError(RuntimeError):
    """Raised when one local part appears at too many domains to be real."""


def status_for(rec: CoachRecord) -> str:
    """'active' only when the row can defend itself. Otherwise 'unverified'."""
    if not (rec.proof_url or "").strip():
        return "unverified"
    if not (rec.title or "").strip():
        return "unverified"
    if not (rec.email or "").strip():
        return "unverified"
    return "active"


TARGET_SPORTS = {"football", "basketball", "soccer", "volleyball", "hockey"}


def keep(rec: CoachRecord) -> bool:
    """Is this row in scope at all?

    normalize.normalize() returns None only when the email is missing, so a row
    whose title folds to no sport -- an athletic director, a band director, a
    school nurse -- passes straight through it. The spec scopes this project to
    five sports, so the drop happens here instead.

    fold_sport()'s exclusions are absolute upstream: "Field Hockey" folds to ""
    rather than to hockey, so it arrives here and is dropped.
    """
    return (rec.sport or "") in TARGET_SPORTS


def entropy_report(records: list[CoachRecord]) -> dict[str, int]:
    """local part -> number of DISTINCT domains it appears at."""
    seen: dict[str, set[str]] = defaultdict(set)
    for r in records:
        if "@" not in (r.email or ""):
            continue
        local, _, domain = r.email.lower().partition("@")
        seen[local].add(domain)
    return {local: len(domains) for local, domains in seen.items()}


def assert_entropy(records: list[CoachRecord]) -> None:
    report = entropy_report(records)
    bad = {k: v for k, v in report.items() if v > config_hs.MAX_DOMAINS_PER_LOCAL_PART}
    if bad:
        worst = sorted(bad.items(), key=lambda kv: -kv[1])[:10]
        detail = ", ".join(f"{k}@ x{v}" for k, v in worst)
        raise EntropyError(
            f"{len(bad)} local part(s) appear at more than "
            f"{config_hs.MAX_DOMAINS_PER_LOCAL_PART} domains: {detail}. "
            "This is the fabrication signature - do not import."
        )
```

- [ ] **Step 4: Write `export_hs.py`**

```python
"""Output: a CSV to read, and SQL that inserts new rows and enriches existing ones.

The enrich half matters as much as the insert half. BookYourData's 1,163 Metro
Atlanta rows are proven deliverable but carry no title and no proof_url, which
is exactly why the verified-only send filter cannot protect them. Filling those
two fields -- and only where they are currently NULL -- moves that cohort from
"safe on delivery history" to "safe on delivery history and crawl-verified".
"""

from __future__ import annotations

import csv
from pathlib import Path

import _shared  # noqa: F401
import gates_hs
from adapters.base import CoachRecord

CSV_FIELDS = [
    "name", "first_name", "last_name", "title", "school", "state",
    "sport", "sport_detail", "email", "phone",
    "address_line", "address_city", "address_state", "address_zip",
    "proof_url", "captured_at", "platform", "status",
]


def _q(value: str) -> str:
    return "'" + str(value or "").replace("'", "''") + "'"


def to_csv(records: list[CoachRecord], path: Path | str) -> int:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in records:
            row = r.as_dict()
            row["status"] = gates_hs.status_for(r)
            w.writerow({k: row.get(k, "") for k in CSV_FIELDS})
    return len(records)


def to_sql(records: list[CoachRecord], path: Path | str, source: str) -> int:
    """INSERT new contacts; UPDATE only NULL title/proof_url on existing ones."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "-- High-school coach import. Generated by tools/hs-scraper.",
        "-- Inserts new contacts and enriches existing ones. Never overwrites.",
        "",
    ]
    for r in records:
        status = gates_hs.status_for(r)
        lines.append(
            "INSERT INTO coach_contacts "
            "(email, coach_name, school, sport, level, state, title, phone, "
            "address_line, address_city, address_state, address_zip, "
            "proof_url, captured_at, source, status) VALUES ("
            f"{_q(r.email)}, {_q(r.name)}, {_q(r.school)}, {_q(r.sport)}, 'hs', "
            f"{_q(r.state)}, {_q(r.title)}, {_q(r.phone)}, "
            f"{_q(r.address_line)}, {_q(r.address_city)}, {_q(r.address_state)}, "
            f"{_q(r.address_zip)}, {_q(r.proof_url)}, {_q(r.captured_at)}, "
            f"{_q(source)}, {_q(status)}) ON CONFLICT (email) DO NOTHING;"
        )
        # Enrichment: fill only what is missing, never change status or source.
        lines.append(
            "UPDATE coach_contacts SET "
            f"title = COALESCE(title, {_q(r.title)}), "
            f"proof_url = COALESCE(proof_url, {_q(r.proof_url)}) "
            f"WHERE lower(email) = lower({_q(r.email)}) "
            "AND (title IS NULL OR proof_url IS NULL);"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(records)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `all passed`

- [ ] **Step 6: Commit**

```bash
git add tools/hs-scraper/gates_hs.py tools/hs-scraper/export_hs.py \
        tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): quality gates and insert/enrich export

Each gate exists because something measurable went wrong. proof_url: three
fabricated families reached coach_contacts carrying validated=true. title:
titled rows bounce 0.73%, untitled 3.86%. entropy: performance@ appeared at 24
distinct domains.

Export inserts new contacts and enriches existing ones by filling only NULL
title/proof_url - never overwriting, never touching status or source. That
enrichment is what would let the verified-only send filter finally protect the
BookYourData cohort, which is proven deliverable but has no titles.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Scoring harness — measure the generic adapter alone

**Files:**
- Create: `tools/hs-scraper/score_metro.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `adapters.base.CoachRecord`.
- Produces: `score_metro.score(found, known) -> dict` with keys
  `recall, agreement, found_total, known_total, matched, missed, novel`;
  `score_metro.load_known(path) -> list[dict]`.

- [ ] **Step 1: Export the ground truth**

The 1,163 proven Metro Atlanta addresses come out of Supabase once:

```sql
COPY (
  SELECT lower(email) AS email, coach_name, school, sport
  FROM coach_contacts
  WHERE source ILIKE 'BookYourData%' AND status='active'
) TO STDOUT WITH CSV HEADER;
```

Save as `tools/hs-scraper/data/metro_known.csv`.

- [ ] **Step 2: Write the failing test**

Add to `tests_hs.py`:

```python
import score_metro


def test_score_computes_recall_and_agreement():
    known = [
        {"email": "a@d.org", "coach_name": "Ann Aye", "school": "Alpha"},
        {"email": "b@d.org", "coach_name": "Bob Bee", "school": "Beta"},
        {"email": "c@d.org", "coach_name": "Cid Cee", "school": "Gamma"},
    ]
    found = [
        CoachRecord(email="a@d.org", name="Ann Aye", school="Alpha"),
        CoachRecord(email="b@d.org", name="Bob Bee", school="Beta"),
        CoachRecord(email="z@d.org", name="Zed Zee", school="Zulu"),
    ]
    r = score_metro.score(found, known)
    check("recall 2 of 3", r["recall"], 66.7)
    check("matched", r["matched"], 2)
    check("missed", r["missed"], 1)
    check("novel counted separately", r["novel"], 1)
    check("agreement 100pct", r["agreement"], 100.0)


def test_agreement_catches_wrong_school():
    known = [{"email": "a@d.org", "coach_name": "Ann Aye", "school": "Alpha"}]
    found = [CoachRecord(email="a@d.org", name="Ann Aye", school="WRONG")]
    r = score_metro.score(found, known)
    check("recall still 100", r["recall"], 100.0)
    check("agreement drops", r["agreement"], 0.0)
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — `ModuleNotFoundError: No module named 'score_metro'`

- [ ] **Step 4: Write `score_metro.py`**

```python
"""Score the crawl against 1,163 addresses already proven to deliver.

Recall is the metric, not precision. Those addresses each have a delivery on
record, so every one the crawler misses is a real gap in the parsers -- and that
gap would be invisible in all 49 states where there is no ground truth.

Novel finds are NOT errors. BookYourData is a purchased subset of Metro
Atlanta, so finding people it lacks is the point.

Scope: the 106 schools BookYourData covers, never all of Georgia. Scoring
statewide would dilute recall by construction.
"""

from __future__ import annotations

import csv
from pathlib import Path

import _shared  # noqa: F401
from adapters.base import CoachRecord

GATE_RECALL = 60.0
GATE_AGREEMENT = 95.0


def load_known(path: Path | str) -> list[dict]:
    with Path(path).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def _norm(s: str) -> str:
    return " ".join((s or "").lower().split())


def score(found: list[CoachRecord], known: list[dict]) -> dict:
    known_by_email = {(k.get("email") or "").lower().strip(): k for k in known}
    found_by_email = {(f.email or "").lower().strip(): f for f in found}

    hit = set(known_by_email) & set(found_by_email)
    missed = set(known_by_email) - set(found_by_email)
    novel = set(found_by_email) - set(known_by_email)

    agree = 0
    for email in hit:
        k, f = known_by_email[email], found_by_email[email]
        if _norm(k.get("school", "")) == _norm(f.school):
            agree += 1

    return {
        "known_total": len(known_by_email),
        "found_total": len(found_by_email),
        "matched": len(hit),
        "missed": len(missed),
        "novel": len(novel),
        "recall": round(100.0 * len(hit) / len(known_by_email), 1) if known_by_email else 0.0,
        "agreement": round(100.0 * agree / len(hit), 1) if hit else 0.0,
    }


def verdict(result: dict) -> str:
    ok = result["recall"] >= GATE_RECALL and result["agreement"] >= GATE_AGREEMENT
    return "PASS - crawl the next state" if ok else (
        f"HOLD - recall {result['recall']}% (need {GATE_RECALL}%), "
        f"agreement {result['agreement']}% (need {GATE_AGREEMENT}%). "
        "Fix the parsers before adding states."
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: `all passed`

- [ ] **Step 6: Parse the archive with the generic adapter and score it**

```bash
cd tools/hs-scraper && python -c "
import _shared, archive, normalize, score_metro, gates_hs, export_hs
from adapters_hs.generic import GenericHS
arch = archive.Archive('data/hs_archive.sqlite')
ad, found = GenericHS(), []
for page in arch.iter_pages('staff'):
    ctx = {'school': page.get('school_id',''), 'school_id': page.get('school_id',''),
           'state': 'GA', 'proof_url': page.get('final_url') or page.get('url',''),
           'captured_at': page.get('fetched_at','')}
    found += ad.parse(page['html'], ctx)
found = normalize.dedupe([r for r in (normalize.normalize(x) for x in found) if r])
found = [r for r in found if gates_hs.keep(r)]
gates_hs.assert_entropy(found)
res = score_metro.score(found, score_metro.load_known('data/metro_known.csv'))
print(res); print(score_metro.verdict(res))
export_hs.to_csv(found, 'out/ga_coaches.csv')
arch.close()
"
```

**This is the decision point.** If the verdict is PASS, skip Task 9 entirely and
go to Task 10. If HOLD, Task 9 closes the gap — and the `missed` list tells you
which pages to look at.

- [ ] **Step 7: Commit**

```bash
git add tools/hs-scraper/score_metro.py tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): recall scoring against proven Metro Atlanta addresses

Recall is the metric, not precision. Those 1,163 addresses each have a delivery
on record, so every one the crawler misses is a real parser gap - and that gap
would be invisible in all 49 states where there is no ground truth.

Novel finds are not errors: BookYourData is a purchased subset, so finding
people it lacks is the point. Scoped to the 106 schools it covers, never all of
Georgia, because scoring statewide would dilute recall by construction.

Gate: recall >= 60%, agreement >= 95%.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Platform census and targeted adapters — only if Task 8 said HOLD

**Files:**
- Create: `tools/hs-scraper/adapters_hs/census.py`
- Create: one adapter module per platform above threshold, e.g.
  `tools/hs-scraper/adapters_hs/finalsite.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: `archive.Archive.iter_pages`, `adapters.base.Adapter`, `CoachRecord`.
- Produces: `census.platform_of(html) -> str`, `census.run(arch) -> dict[str, int]`;
  each new adapter exposes `detect(html) -> bool` and `parse(html, ctx) -> list[CoachRecord]`,
  matching `GenericHS`.

- [ ] **Step 1: Write the census**

```python
"""Which CMS platforms does the archive actually contain?

Written after the crawl, not before. Guessing a vendor list up front produces
adapters for platforms nobody uses and none for the one that matters.
"""

from __future__ import annotations

import re

import _shared  # noqa: F401

SIGNATURES = [
    ("finalsite",     re.compile(r"finalsite|fs-element|/fs/", re.I)),
    ("edlio",         re.compile(r"edlio", re.I)),
    ("schoolwires",   re.compile(r"schoolwires|blackboard|/site/handlers/", re.I)),
    ("apptegy",       re.compile(r"apptegy|thrillshare", re.I)),
    ("schoolmessenger", re.compile(r"schoolmessenger|/apps/pages/", re.I)),
    ("rschooltoday",  re.compile(r"rschooltoday", re.I)),
    ("8to18",         re.compile(r"8to18", re.I)),
    ("vnn",           re.compile(r"vnnsports|vnn\.tv", re.I)),
    ("arbiter",       re.compile(r"arbitersports", re.I)),
]


def platform_of(html: str) -> str:
    for name, pattern in SIGNATURES:
        if pattern.search(html or ""):
            return name
    return "unknown"


def run(arch) -> dict[str, int]:
    counts: dict[str, int] = {}
    for page in arch.iter_pages("staff"):
        p = platform_of(page.get("html") or "")
        counts[p] = counts.get(p, 0) + 1
    return dict(sorted(counts.items(), key=lambda kv: -kv[1]))
```

- [ ] **Step 2: Run the census against the archive**

```bash
cd tools/hs-scraper && python -c "
import _shared, archive
from adapters_hs.census import run
arch = archive.Archive('data/hs_archive.sqlite'); print(run(arch)); arch.close()
"
```

- [ ] **Step 3: For each platform holding ≥10% of pages, extract a failing sample**

```bash
cd tools/hs-scraper && python -c "
import _shared, archive
from adapters_hs.census import platform_of
from adapters_hs.generic import GenericHS
arch, ad = archive.Archive('data/hs_archive.sqlite'), GenericHS()
for page in arch.iter_pages('staff'):
    html = page.get('html') or ''
    if platform_of(html) == 'finalsite' and len(ad.parse(html, {})) == 0:
        open('data/_sample_finalsite.html','w',encoding='utf-8').write(html); break
arch.close()
"
```

- [ ] **Step 4: Write a failing test from that real sample**

Open `data/_sample_finalsite.html` saved in Step 3, find one complete person in
it, and paste that fragment below. The expected values are read off that same
fragment. This is a real page the generic parser returned zero rows for, which
is what makes the test worth having:

```python
from adapters_hs.finalsite import FinalsiteHS

# Paste one person's container from data/_sample_finalsite.html. Finalsite
# markup looks like this -- the class names are real, the contents are whatever
# your archived page holds. Keep it to ONE person so the count assertion below
# is meaningful.
FINALSITE_SAMPLE = """
<div class="fsConstituentItem">
  <h3 class="fsFullName">Jane Doe</h3>
  <div class="fsTitles"><div class="fsTitle">Head Volleyball Coach</div></div>
  <div class="fsEmail"><a href="mailto:jane.doe@example.org">Email</a></div>
</div>
"""
# Replace these three expected values with what your pasted fragment says.
EXPECT_EMAIL = "jane.doe@example.org"
EXPECT_TITLE = "Head Volleyball Coach"


def test_finalsite_extracts_person():
    rows = FinalsiteHS().parse(FINALSITE_SAMPLE, CTX)
    check("finalsite row count", len(rows), 1)
    check("finalsite email", rows[0].email, EXPECT_EMAIL)
    check("finalsite title", rows[0].title, EXPECT_TITLE)
```

- [ ] **Step 5: Run it to verify it fails**

Run: `cd tools/hs-scraper && python tests_hs.py`
Expected: FAIL — module missing, or 0 rows returned.

- [ ] **Step 6: Write the adapter against the sample**

Subclass `Adapter` exactly as `GenericHS` does — `detect()` matches the
platform signature, `parse()` walks that platform's container markup. Keep the
address-anchored rule: no address, no row.

- [ ] **Step 7: Re-run the tests, then re-score**

```bash
cd tools/hs-scraper && python tests_hs.py
```
Then repeat Task 8 Step 6 with the new adapter tried before `GenericHS`.
Expected: recall rises. Repeat Steps 3–7 per platform until the verdict is PASS.

- [ ] **Step 8: Commit**

```bash
git add tools/hs-scraper/adapters_hs/ tools/hs-scraper/tests_hs.py
git commit -m "feat(hs-scraper): platform census and targeted adapters

Written after the crawl, not before. Guessing a vendor list up front produces
adapters for platforms nobody uses and none for the one that matters - the
census counts what the archive actually holds, and adapters are written only
for platforms where the generic parser measurably fails.

Every adapter test is built from a real archived page that the generic parser
returned zero rows for.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Generalize to the remaining 49 states

**Files:**
- Create: `tools/hs-scraper/associations/<state>.py` per association
- Create: `tools/hs-scraper/run_state.py`
- Modify: `tools/hs-scraper/tests_hs.py`

**Interfaces:**
- Consumes: everything above.
- Produces: `run_state.run(state_code: str) -> dict` returning the same keys as
  `score_metro.score` plus `{"crawled": int, "exported": int}`.

- [ ] **Step 1: Confirm the Georgia gate passed**

Do not start this task until Task 8's verdict reads PASS. That gate exists so a
parser gap is fixed once rather than inherited fifty times.

- [ ] **Step 2: Write `run_state.py` as one pipeline**

```python
"""One state, end to end. Georgia is the only state with ground truth, so every
other state runs the same pipeline with scoring skipped.
"""

from __future__ import annotations

import importlib

import _shared  # noqa: F401
import archive
import crawl_hs
import export_hs
import gates_hs
import net
import normalize
import registry_hs
import resolve_hs
from adapters_hs.generic import GenericHS


def run(state_code: str) -> dict:
    assoc = importlib.import_module(f"associations.{state_code.lower()}")
    schools = assoc.fetch_members(net.Fetcher())
    registry_hs.save(schools, f"data/{state_code.lower()}_schools.csv")

    arch = archive.Archive(f"data/hs_archive_{state_code.lower()}.sqlite")
    fetcher = net.Fetcher()
    crawled = 0
    for district, members in resolve_hs.district_groups(schools).items():
        if members[0].district_domain:
            crawl_hs.crawl_target(fetcher, arch, f"district:{district}",
                                  "https://" + members[0].district_domain)
            crawled += 1
    for s in schools:
        if not s.is_public and s.site_url:
            crawl_hs.crawl_target(fetcher, arch, s.school_id, s.site_url)
            crawled += 1

    ad, found = GenericHS(), []
    for page in arch.iter_pages("staff"):
        ctx = {"school": page.get("school_id", ""), "school_id": page.get("school_id", ""),
               "state": state_code.upper(),
               "proof_url": page.get("final_url") or page.get("url", ""),
               "captured_at": page.get("fetched_at", "")}
        found += ad.parse(page.get("html") or "", ctx)
    found = normalize.dedupe([r for r in (normalize.normalize(x) for x in found) if r])
    found = [r for r in found if gates_hs.keep(r)]
    gates_hs.assert_entropy(found)

    exported = export_hs.to_csv(found, f"out/{state_code.lower()}_coaches.csv")
    export_hs.to_sql(found, f"out/{state_code.lower()}_import.sql",
                     f"Scrape HS {state_code.upper()} 2026-09")
    arch.close()
    return {"crawled": crawled, "exported": exported}
```

- [ ] **Step 3: Add the combined national export**

Each state writes its own CSV, which is how the work is reviewed and how a state
can be re-run without touching the others. A combined file is what actually gets
imported, so it is built by concatenation rather than by a second crawl — the
per-state files stay the source of truth.

Append to `run_state.py`:

```python
def combine(out_dir="out", path="out/all_states_coaches.csv") -> int:
    """Concatenate every per-state CSV into one national file.

    Concatenation, not a re-crawl: the per-state files are the record, and a
    national file rebuilt from them can never disagree with them. Reads the
    header from the first file only, and verifies the rest match it -- a column
    drift between states would otherwise shift every field silently.
    """
    import csv
    from pathlib import Path

    files = sorted(Path(out_dir).glob("*_coaches.csv"))
    files = [f for f in files if f.name != Path(path).name]
    if not files:
        return 0

    header, rows = None, []
    for f in files:
        with f.open(newline="", encoding="utf-8") as fh:
            r = csv.reader(fh)
            head = next(r, None)
            if head is None:
                continue
            if header is None:
                header = head
            elif head != header:
                raise ValueError(f"{f.name} column drift: {head} != {header}")
            rows.extend(r)

    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(header)
        w.writerows(rows)
    return len(rows)
```

Run it:

```bash
cd tools/hs-scraper && python -c "
import _shared, run_state
print('combined rows:', run_state.combine())
"
```

Expected: the sum of the per-state row counts. A `ValueError` means one state's
export drifted from the others' columns — fix the export, never the combiner.

- [ ] **Step 4: Run one new state and confirm the entropy gate holds**

```bash
cd tools/hs-scraper && python -c "
import _shared, run_state; print(run_state.run('TX'))
"
```

Expected: no `EntropyError`. If it raises, a parser is picking up a shared
mailbox pattern — inspect before importing anything.

- [ ] **Step 5: Commit**

```bash
git add tools/hs-scraper/run_state.py tools/hs-scraper/associations/
git commit -m "feat(hs-scraper): one-command state pipeline

Georgia is the only state with ground truth, so every other state runs the same
pipeline with scoring skipped. The entropy gate still runs everywhere - it is
the only fabrication check that needs no ground truth at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Run `python tests_hs.py` from inside `tools/hs-scraper/`.** The package relies on the
  current directory being on `sys.path` so its own modules win over the college package's
  same-named ones.
- **`data/` and `out/` are gitignored** (see the repo root `.gitignore`). Never commit
  `hs_archive.sqlite` — the college equivalent is 29 MB.
- **If a step's expected output does not match, stop.** Every "Expected:" line in this plan is
  a real assertion, not a guess — particularly the school counts in Task 2 Step 6 and the match
  rate in Task 3 Step 5.
- **Task 9 is conditional.** If Task 8 returns PASS, skip straight to Task 10.
