"""Group schools by the domain that actually serves their mail.

The crawl unit is the domain, not the school. Georgia proves why: 44 domains
carry 187 of 410 schools, and one of them (dekalb.k12.ga.us) carries 19 across
12 cities. Fetch a district's staff directory once and you have resolved a
dozen schools.

This is measured, never inferred. The school's own published email domain
decides its unit, falling back to its site_url only when no email was
captured -- no step anywhere turns a district NAME into a district DOMAIN,
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

    Keys on the school's email domain when the association published one --
    it is the domain that actually receives mail -- and falls back to the
    website otherwise. A school with neither gets no unit and keeps a blank
    district_domain. It is unresolved, and Task 4 resolves it -- it is never
    guessed at.
    """
    units: dict[str, list[HSSchool]] = collections.defaultdict(list)
    for s in schools:
        key = unit_key(s.email_domain or s.site_url)
        if not key:
            continue
        s.district_domain = key
        units[key].append(s)
    return dict(sorted(units.items(), key=lambda kv: (-len(kv[1]), kv[0])))
