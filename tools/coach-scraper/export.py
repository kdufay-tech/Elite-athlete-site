"""Stage 3: write CSV that coach-contacts-import.js already understands.

Column headers match HEADER_MAP in netlify/functions/coach-contacts-import.js
exactly, so the file drags straight into /admin -> Coach Ops with no backend
change:

    Email -> email          Coach Name -> coach_name    School -> school
    Sport -> sport          Level -> level              State -> state
    Phone -> phone          Classification -> classification
    Proof URL -> website    Email Status -> validated   Source -> source

"Proof URL" is deliberate: HEADER_MAP already treats it as a synonym for
website, so the stored value is the exact page the address was read from
rather than a generic homepage. Columns the importer does not recognise
(Title, Address, Platform, ...) are reported as unmapped and ignored, which is
harmless -- they are there for your own review before import.
"""

from __future__ import annotations

import csv
from pathlib import Path

import config
from adapters.base import CoachRecord

# (csv header, record attribute; None means constant or classifier-supplied)
#
# Header ORDER is load-bearing. buildColumnIndex() in the importer keeps the
# FIRST column that matches a field's synonym list, and HEADER_MAP lists
# 'conference' as a synonym for region. So "Region" must appear BEFORE
# "Conference", or every row's region is set to a conference name and the
# Send-to-a-folder region filter stops matching anything.
COLUMNS = [
    ("Email",          "email"),
    ("Coach Name",     "name"),
    ("First Name",     "first_name"),
    ("Last Name",      "last_name"),
    ("Title",          "title"),
    ("School",         "school"),
    ("Sport",          "sport"),
    ("Sport Detail",   "sport_detail"),
    ("Level",          None),
    # coach_contacts.classification is ALREADY a quality taxonomy, not a
    # division: the table holds COLLEGE_VERIFIED_SCRAPER, EDU_AMBIGUOUS,
    # STUDENT_LIKELY, EXCLUDED_MED_DOMAIN and friends. Writing "D2"/"NAIA"
    # there would put a second, incompatible vocabulary into one column and
    # quietly break any filter that reads it. These rows ARE verified scraper
    # rows, so they take the existing label; the division travels in Division
    # (a new column, see migration.sql) and in Source.
    ("Classification", None),
    ("Division",       "division"),
    ("State",          "state"),
    ("Region",         None),        # filled by classify.py; MUST precede Conference
    ("Conference",     "conference"),
    ("Phone",          "phone"),
    ("Address",        "address_line"),
    ("Address City",   "address_city"),
    ("Address State",  "address_state"),
    ("Address Zip",    "address_zip"),
    # --- classification, for segmenting the send (importer ignores these) ---
    ("Role Tier",      None),
    ("Program",        None),
    ("Confidence",     None),
    ("Name Check",     None),
    ("Contact Completeness", None),
    # --- provenance ---
    ("Proof URL",      "proof_url"),
    ("Captured At",    "captured_at"),
    ("Platform",       "platform"),
    ("Email Status",   None),
    ("Source",         None),
]

# Columns classify.py supplies rather than the record.
CLASSIFIED = {"Region", "Role Tier", "Program", "Confidence", "Name Check",
              "Contact Completeness", "State"}

# isVerified() in the importer matches /verified/i, so this sets validated=true.
# It is earned here: every address was read out of the page at Proof URL.
EMAIL_STATUS = "verified-onpage"

# Matches the label already used by 5,629 rows in coach_contacts. These rows
# qualify on the same terms: an address read from a live staff directory, with
# the page URL recorded.
CLASSIFICATION = "COLLEGE_VERIFIED_SCRAPER"

# Source label follows the convention the import UI suggests ("BookYourData GA
# HS"): a readable provenance string per row, so these rows stay separable from
# every previously collected list inside coach_contacts.
SOURCE_PREFIX = "Scrape NCAA"


def _source_for(record: CoachRecord) -> str:
    month = (record.captured_at or "")[:7]
    return f"{SOURCE_PREFIX} {record.division} {month}".strip()


def to_row(record: CoachRecord) -> dict:
    """One exported row as a dict, classified."""
    import classify

    row = {}
    for header, attr in COLUMNS:
        row[header] = "" if attr is None else (getattr(record, attr, "") or "")
    row["Level"] = config.LEVEL
    row["Classification"] = CLASSIFICATION
    row["Email Status"] = EMAIL_STATUS
    row["Source"] = _source_for(record)
    return classify.classify(row)


SUPPRESSION_FILE = Path(__file__).parent / "data" / "suppression.txt"


def load_suppression(path: Path | str = SUPPRESSION_FILE) -> set[str]:
    """Addresses that must never be exported, whatever the page says.

    Sourced from coach_contacts where status is unsubscribed / bounced /
    excluded / inactive. A scraper has no way to know someone opted out --
    the page still lists them -- so without this file a re-scrape quietly
    resurrects every unsubscribe, which is both a compliance problem and the
    fastest way to earn a spam complaint from someone who already said no.
    """
    path = Path(path)
    if not path.exists():
        return set()
    out = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip().lower()
        if line and not line.startswith("#"):
            out.add(line)
    return out


def write_csv(records: list[CoachRecord], path: str | Path,
              suppression: set[str] | None = None) -> tuple[Path, int]:
    """Write rows, dropping anything on the do-not-contact list.

    Returns (path, suppressed_count).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    blocked = load_suppression() if suppression is None else suppression
    headers = [h for h, _ in COLUMNS]
    dropped = 0
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=headers, extrasaction="ignore")
        writer.writeheader()
        ordered = sorted(records,
                         key=lambda x: (x.division, x.school, x.sport, x.last_name))
        for record in ordered:
            if (record.email or "").lower() in blocked:
                dropped += 1
                continue
            writer.writerow(to_row(record))
    return path, dropped


def write_by_confidence(records: list[CoachRecord], out_dir: str | Path) -> list[Path]:
    """Split by confidence tier so a warm-up send can start with tier A only."""
    out_dir = Path(out_dir)
    buckets: dict[str, list[CoachRecord]] = {}
    for record in records:
        buckets.setdefault(to_row(record)["Confidence"], []).append(record)
    blocked = load_suppression()
    written = []
    for tier in sorted(buckets):
        path, _ = write_csv(buckets[tier], out_dir / f"coaches_tier_{tier}.csv", blocked)
        written.append(path)
    return written


def write_per_sport(records: list[CoachRecord], out_dir: str | Path) -> list[Path]:
    """One file per sport -- Coach Ops sends per sport, so import per sport."""
    out_dir = Path(out_dir)
    blocked = load_suppression()
    written = []
    for sport in config.SPORTS:
        subset = [r for r in records if r.sport == sport]
        if subset:
            path, _ = write_csv(subset, out_dir / ("coaches_" + sport + ".csv"), blocked)
            written.append(path)
    return written


MIGRATION_SQL = """\
-- Adds mailing address and provenance to coach_contacts.
-- coach_contacts currently has no address column, so the Address* columns in
-- the export are dropped on import until this runs. Review before applying.
--
-- Apply in the Supabase SQL editor. Additive and reversible: it only adds
-- nullable columns, so existing rows and existing queries are unaffected.

ALTER TABLE coach_contacts
  ADD COLUMN IF NOT EXISTS address_line  text,
  ADD COLUMN IF NOT EXISTS address_city  text,
  ADD COLUMN IF NOT EXISTS address_state text,
  ADD COLUMN IF NOT EXISTS address_zip   text,
  ADD COLUMN IF NOT EXISTS title         text,
  ADD COLUMN IF NOT EXISTS sport_detail  text,
  ADD COLUMN IF NOT EXISTS proof_url     text,
  ADD COLUMN IF NOT EXISTS captured_at   timestamptz,
  ADD COLUMN IF NOT EXISTS division      text;   -- D1 | D2 | D3 | NAIA | JUCO

COMMENT ON COLUMN coach_contacts.division IS
  'NCAA/NAIA/JUCO tier. Separate from classification, which is the existing
   email-quality taxonomy (COLLEGE_VERIFIED_SCRAPER, EDU_AMBIGUOUS, ...).';

COMMENT ON COLUMN coach_contacts.proof_url IS
  'Exact staff-directory URL this row was scraped from; provenance for validated=true.';

CREATE INDEX IF NOT EXISTS idx_coach_contacts_state_sport
  ON coach_contacts (address_state, sport);

-- To make the importer carry these through, add to HEADER_MAP in
-- netlify/functions/coach-contacts-import.js:
--
--   address_line:  ['address', 'address line', 'street', 'street address'],
--   address_city:  ['address city', 'city', 'town'],
--   address_state: ['address state'],
--   address_zip:   ['address zip', 'zip', 'zip code', 'postal code'],
--   title:         ['title', 'job title', 'role', 'position'],
--   sport_detail:  ['sport detail', 'program'],
--   captured_at:   ['captured at', 'scraped at'],
--   division:      ['division', 'tier', 'ncaa division'],
--
-- and add the matching fields to the object returned by toContact().
"""


def write_migration(path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(MIGRATION_SQL, encoding="utf-8")
    return path
