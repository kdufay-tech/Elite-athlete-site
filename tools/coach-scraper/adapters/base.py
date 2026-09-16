"""Adapter contract and the shared record type.

An adapter's whole job: given archived HTML for one school, return
CoachRecord rows. Adapters never touch the network and never normalize --
they report what the page literally said, and normalize.py cleans it up.
That split keeps each adapter small enough to reason about and lets the
normalizer be tested once rather than per-platform.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict


# --- email recovery -------------------------------------------------------
# Sidearm (and several imitators) hide addresses from scrapers by splitting
# them across two JS variables assembled at render time:
#     var firstHalf = "beckeker"; var secondHalf = "gvsu.edu";
#     placeholder.href = 'mailto:' + firstHalf + '@' + secondHalf;
# A regex for a whole address finds nothing on these pages -- which is exactly
# what makes most scrapers reach for a headless browser. Matching the assembly
# instead recovers the address from static HTML.
SPLIT_EMAIL = re.compile(
    r'firstHalf\s*=\s*"([^"]+)"\s*;\s*var\s+secondHalf\s*=\s*"([^"]+)"', re.S
)
# Plain addresses, for platforms that do not obfuscate.
PLAIN_EMAIL = re.compile(r'mailto:([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})')
BARE_EMAIL = re.compile(r'\b([A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,})\b')
PHONE = re.compile(r'(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4})')


def emails_in(html: str) -> list[str]:
    """Every address recoverable from a fragment, obfuscated or not.

    Order matters: the split form is checked first because a page using it has
    no plain address to find, and the plain forms are checked in descending
    order of confidence (an explicit mailto: beats a bare string that might be
    body copy).
    """
    found = [f"{a}@{b}" for a, b in SPLIT_EMAIL.findall(html)]
    found += PLAIN_EMAIL.findall(html)
    if not found:
        found += BARE_EMAIL.findall(html)
    seen, out = set(), []
    for e in found:
        e = e.strip().strip('.').lower()
        if e and e not in seen:
            seen.add(e)
            out.append(e)
    return out


@dataclass
class CoachRecord:
    """One scraped person. Fields mirror coach_contacts plus provenance."""

    # identity
    name: str = ""
    first_name: str = ""
    last_name: str = ""
    title: str = ""

    # affiliation
    school: str = ""
    school_id: str = ""
    division: str = ""          # D1 | D2 | D3 | NAIA | JUCO
    state: str = ""
    conference: str = ""

    # sport
    category: str = ""          # raw heading, e.g. "Men's Basketball"
    sport: str = ""             # folded: football|basketball|soccer|volleyball|hockey
    sport_detail: str = ""      # e.g. "Men's Basketball"

    # contact
    email: str = ""
    phone: str = ""

    # mailing address
    address_line: str = ""
    address_city: str = ""
    address_state: str = ""
    address_zip: str = ""

    # provenance -- what makes validated=true defensible
    proof_url: str = ""         # exact page this row came from
    captured_at: str = ""
    platform: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


class Adapter:
    """Base class. Subclasses set `name` and implement detect/parse."""

    name = "base"

    def detect(self, html: str) -> bool:
        """True if this adapter recognises the page."""
        raise NotImplementedError

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        """Extract rows. `ctx` carries school/division/proof_url."""
        raise NotImplementedError

    @staticmethod
    def _seed(ctx: dict) -> dict:
        return {
            "school": ctx.get("school", ""),
            "school_id": ctx.get("school_id", ""),
            "division": ctx.get("division", ""),
            "state": ctx.get("state", ""),
            "conference": ctx.get("conference", ""),
            "proof_url": ctx.get("proof_url", ""),
            "captured_at": ctx.get("captured_at", ""),
        }
