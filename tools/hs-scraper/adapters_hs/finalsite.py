"""Finalsite school directories: decode what the generic parser cannot see.

Finalsite is the CMS behind four of the five largest reachable district domains
in Georgia -- gcpsk12.org, fultonschools.org, dekalbschoolsga.org and
clayton.k12.ga.us, 59 schools between them in the top five alone.

Its directory pages are NOT javascript-rendered and NOT bot-gated: a browser and
this scraper receive byte-identical responses, and every staff name and title is
already in that response. Only the addresses are obfuscated, each one emitted as
a call whose two arguments are the domain and the local part, both REVERSED:

    FS.util.insertEmail("fsEmail-...", "gro.21kspcg", "igzba.ihsey", false)
      -> yeshi.abzgi@gcpsk12.org

One fetch of a directory page yields 100 exact name + title + address triples
that emails_in() sees as one.

DECODING IS NOT FORMULA GENERATION. This project forbids constructing an address
from a person's name, and that ban is why its worst-bouncing cohort exists. The
string "igzba.ihsey" is data the school PUBLISHES; reversing it transcribes the
school's own assertion. The distinguishing test is that the address survives the
removal of the name -- it is stored independently. Accordingly decode_email()
takes only the two encoded strings and there is deliberately no parameter by
which a name could ever reach it.
"""

from __future__ import annotations

import html as _html
import re
from urllib.parse import quote

import _shared  # noqa: F401
from adapters.base import Adapter, CoachRecord, PHONE

# The obfuscated address. Tolerant of whitespace and of the trailing argument,
# which varies between "false", "true" and a display string across installs.
_INSERT = re.compile(
    r"""FS\.util\.insertEmail\(\s*["'][^"']*["']\s*,\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']""",
    re.I,
)

# One constituent: name, optional titles, then the address call. Non-greedy and
# anchored on the address, so a person with no address simply does not match.
_ITEM = re.compile(
    r'fsFullName["\']?\s*>\s*(?P<name>.*?)\s*</h3>'
    r'(?P<mid>.*?)'
    r'FS\.util\.insertEmail\(\s*["\'][^"\']*["\']\s*,\s*["\'](?P<dom>[^"\']*)["\']\s*,\s*["\'](?P<loc>[^"\']*)["\']',
    re.I | re.S,
)

_TITLES = re.compile(r"Titles:\s*</strong>\s*(.*?)\s*</div>", re.I | re.S)
_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")

_MARKERS = ("fs.util.insertemail", "fsconstituent", "fsconstituentitem")


def decode_email(rev_domain: str, rev_local: str) -> str:
    """Reverse both halves into an address.

    Takes ONLY the two encoded strings. There is no name parameter and there
    must never be one: that is the line between transcribing an address the
    page publishes and inventing one from a person's name.
    """
    dom = (rev_domain or "").strip()[::-1]
    loc = (rev_local or "").strip()[::-1]
    if not dom or not loc or "." not in dom:
        return ""
    return f"{loc}@{dom}".lower()


def _clean(fragment: str) -> str:
    return _SPACE.sub(" ", _html.unescape(_TAGS.sub(" ", fragment or ""))).strip()


def search_url(base_url: str, last_name: str) -> str:
    """Query one surname instead of walking the whole directory.

    We already know which coaches we are looking for -- the association named
    all 8,201 of them -- so one page per surname beats paginating through a
    two-thousand-person staff list.
    """
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}const_search_last_name={quote(last_name, safe='')}"


def page_url(base_url: str, page: int) -> str:
    sep = "&" if "?" in base_url else "?"
    return f"{base_url}{sep}const_page={int(page)}"


class Finalsite(Adapter):
    name = "finalsite"

    def detect(self, html: str) -> bool:
        low = (html or "").lower()
        return any(m in low for m in _MARKERS)

    def parse(self, html: str, ctx: dict) -> "list[CoachRecord]":
        out: list[CoachRecord] = []
        seen: set[str] = set()
        for m in _ITEM.finditer(html or ""):
            email = decode_email(m.group("dom"), m.group("loc"))
            if not email or email in seen:
                continue
            seen.add(email)

            mid = m.group("mid")
            t = _TITLES.search(mid)

            rec = CoachRecord(**Adapter._seed(ctx))
            rec.name = _clean(m.group("name"))
            rec.title = _clean(t.group(1)) if t else ""
            rec.email = email
            phone = PHONE.search(mid)
            rec.phone = phone.group(1) if phone else ""
            rec.platform = self.name
            out.append(rec)
        return out
