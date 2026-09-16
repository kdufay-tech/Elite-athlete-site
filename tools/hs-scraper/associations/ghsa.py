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
    """Download the feed. Binary, so this bypasses Fetcher's HTML handling.

    Uses fetcher.session.get(), not a bare requests.get(): the session already
    carries the SystemTrustAdapter (see coach-scraper/net.py) that validates
    TLS against the OS trust store. A bare requests.get() falls back to
    certifi and fails SSLCertVerificationError on machines where a local
    security product intercepts and re-signs TLS -- this one included.
    """
    ua = fetcher.session.headers.get("User-Agent", "")
    r = fetcher.session.get(FEED_URL, timeout=90, headers={"User-Agent": ua})
    r.raise_for_status()
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(r.content)
