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
    """Flatten markup, keeping field boundaries as "|".

    Tags become a separator rather than a space. A directory's fields are
    delimited by markup and by nothing else -- once <td>Jane Doe</td><td>Head
    Coach</td> collapses to "Jane Doe Head Coach" there is no boundary left to
    split a name from a title, and every downstream split is guessing.
    """
    text = _TAGS.sub("|", fragment or "")
    text = _html.unescape(text)
    text = _SPACE.sub(" ", text)
    text = re.sub(r"(?:\s*\|\s*)+", "|", text)
    return text.strip("| ").strip()


# How far either side of an address to look for that person's name and title.
# Wide enough to clear a table row or a card, narrow enough not to reach the
# next person. Re-tune against real pages in Task 8; do not guess further here.
WINDOW_BEFORE = 400
WINDOW_AFTER = 200


def blocks(html: str) -> "list[tuple[str, str]]":
    """One (address, window) per address occurrence, in document order.

    NOT regex container matching. A container pattern with a backreference
    cannot nest: against an outer div wrapping inner cards it matches through
    the FIRST closing tag, keeping the outer opener and losing every inner
    card. Real directories nest three or four deep, so that approach silently
    under-extracts exactly where it matters most.

    Anchoring on the address needs no well-formed markup at all -- the address
    is the one element every directory truly has.

    Two things make this work on dense pages, and both were learned by running
    it rather than reading it:

    The anchor address is RETURNED, not recovered from the window afterwards.
    Windows overlap whenever people sit closer together than WINDOW_BEFORE, and
    a window that reports its neighbour's address collapses two people into one.

    And each window is CLAMPED to its neighbours, so it can never run past the
    previous or next address. Without that, a person's name and title are read
    from whichever of them appears first in a shared span.
    """
    html = html or ""
    low = html.lower()

    hits: list[tuple[int, str]] = []
    for addr in set(emails_in(html)):
        needle, start = addr.lower(), 0
        while True:
            i = low.find(needle, start)
            if i < 0:
                break
            hits.append((i, addr))
            start = i + len(needle)
    hits.sort()

    out: list[tuple[str, str]] = []
    for n, (i, addr) in enumerate(hits):
        prev_end = (hits[n - 1][0] + len(hits[n - 1][1])) if n else 0
        nxt = hits[n + 1][0] if n + 1 < len(hits) else len(html)
        lo = max(prev_end, i - WINDOW_BEFORE)
        hi = min(nxt, i + len(addr) + WINDOW_AFTER)
        out.append((addr, html[lo:hi]))
    return out


class GenericHS(Adapter):
    name = "generic-hs"

    def detect(self, html: str) -> bool:
        return len(set(emails_in(html))) >= 3

    def parse(self, html: str, ctx: dict) -> "list[CoachRecord]":
        out: list[CoachRecord] = []
        seen: set[str] = set()
        for email, block in blocks(html):
            if email in seen:
                continue
            seen.add(email)

            text = _flat(block)
            fields = [f.strip() for f in text.split("|") if f.strip()]

            name = ""
            for f in fields:
                m = _NAME.fullmatch(f) or _NAME.search(f)
                if m and "@" not in f:
                    name = m.group(1).strip()
                    break

            title = ""
            for f in fields:
                if f != name and "@" not in f and _ROLE.search(f) and len(f) < 90:
                    title = f
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
