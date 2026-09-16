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
import re
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


_PERSON_APOSTROPHE = re.compile(r"['’]")
_PERSON_PUNCT = re.compile(r"[^a-z ]+")


def norm_person(s: str) -> str:
    """Fold a name for comparison. Deliberately conservative.

    Apostrophes are dropped outright (O'Reed -> oreed) rather than folded to a
    space, because a page's rendering of a name may or may not keep one and
    the two must still compare equal. Every other punctuation mark (hyphens,
    periods) folds to a space, so a hyphenated surname still splits into
    separate tokens.
    """
    s = _PERSON_APOSTROPHE.sub("", (s or "").lower())
    s = _PERSON_PUNCT.sub(" ", s)
    return " ".join(s.split())


def attribute(records: list, unit: CrawlUnit) -> dict[str, int]:
    """Resolve each record's school by matching its name against the unit.

    A shared district domain serves many schools from ONE staff page, so the
    url a record came from cannot say which school it belongs to. The
    association named every coach and said where they work, so the name is the
    evidence and the url is not.

    An exact normalised match only. A fuzzy match here would attach a coach to
    a neighbouring school in the same district -- a wrong row that looks
    completely well-formed and that no downstream filter can catch. A record
    matching nobody keeps a blank school, is reported, and is exported
    `unverified`; it is never assigned to the unit's largest school or any
    other convenient default.
    """
    by_name: dict[str, str] = {}
    schools = {s.school_id: s for s in unit.schools}
    for t in unit.targets:
        key = norm_person(getattr(t, "name", ""))
        school = schools.get(getattr(t, "school_id", ""))
        if not key or school is None:
            continue
        if key in by_name and by_name[key] != school.school_id:
            by_name[key] = ""          # same name at two schools: ambiguous
        else:
            by_name.setdefault(key, school.school_id)

    counts = {"matched": 0, "unmatched": 0}
    for r in records:
        sid = by_name.get(norm_person(getattr(r, "name", "")), "")
        school = schools.get(sid)
        if school is None:
            counts["unmatched"] += 1
            continue
        r.school = school.school
        if hasattr(r, "school_id"):
            r.school_id = school.school_id
        counts["matched"] += 1
    return counts


def save(units: list[CrawlUnit], path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["domain", "is_shared", "schools", "targets", "school_ids"])
        for u in units:
            w.writerow([u.domain, u.is_shared, len(u.schools), len(u.targets),
                        "|".join(s.school_id for s in u.schools)])
