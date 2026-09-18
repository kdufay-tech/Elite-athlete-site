"""Proximity parser: the fallback that has to work everywhere.

High schools do not share a platform the way colleges share Sidearm. Rather
than guess at a dozen CMSs up front, this adapter anchors on the one thing
every directory has -- an address -- and reads the name and title from the
markup immediately around it.

It is built and MEASURED first. Platform-specific adapters get written only for
the gap this leaves, which keeps that work driven by recall data instead of by
a list of vendor names.

It never constructs an address. A block with no address yields no row.

WHICH SIDE THE NAME IS ON IS NOT FIXED, and assuming it was cost 21 of this
parser's 49 usable rows. Three real layouts, all in the archive:

    Campbell   <a href="mailto:ADDR">Trenton Pruett</a>      name AFTER
    Pope       <a href="mailto:ADDR">Hanson, Thomas</a>      name AFTER
    Mt Pisgah  ED WILSON <p>Head Coach</p> <a href=ADDR>CONTACT</a>   name BEFORE

Scanning one side first and taking the first hit returns, on the two link-text
layouts, the PREVIOUS PERSON -- because the nearest thing before the address is
the end of the previous card.

The rule is structural rather than positional: if the address sits inside an
href, the anchor's own text is its label and that is the name (unless the label
is something like "CONTACT" or "email"); otherwise the person is whoever is
listed immediately before. Picking the nearest name in EITHER direction fails
the dense case, where the nearest name after an address is the next person.
"""

from __future__ import annotations

import html as _html
import re
from urllib.parse import unquote

import _shared  # noqa: F401
from adapters.base import Adapter, CoachRecord, PHONE, emails_in

_TAGS = re.compile(r"<[^>]+>")
_SPACE = re.compile(r"\s+")

# Title words that mark a row as staff worth keeping.
_ROLE = re.compile(
    r"(?i)\b(head|assistant|asst\.?|associate|interim|volunteer|coach|coordinator|"
    r"director|trainer|athletic)\b"
)

# Words that prove a field is NOT a person, used only to reject name candidates.
# A job title and a name are the same SHAPE -- "Head Coach" and "Jane Doe" are
# both two capitalised words -- so shape alone cannot separate them, and the
# parser returned "Head Coach", "Special Education" and "Assistant Principal"
# as people's names. Vocabulary is what separates them.
_NOT_A_NAME = re.compile(
    r"(?i)\b(head|assistant|asst\.?|associate|interim|volunteer|coach|coordinator|"
    r"director|trainer|athletic|athletics|varsity|principal|teacher|secretary|"
    r"parapro|paraprofessional|nurse|custodian|counselor|counseling|education|"
    r"science|mathematics|math|english|history|language|arts|studies|department|"
    r"office|media|center|administration|faculty|staff|contact|email)\b"
)

# Markup that survived flattening. A field holding any of these is attribute
# debris, not text a human would read.
_DEBRIS = re.compile(r"[<>=\"@]|http|\d")

_WORD = re.compile(r"[A-Za-z][A-Za-z'\-\.]*")

EMAIL_SHAPE = re.compile(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}")


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


def _fields(fragment: str) -> "list[str]":
    return [f for f in (x.strip() for x in _flat(fragment).split("|")) if f]


def _readable(field: str) -> str:
    """The part of a field a human would actually see.

    Splitting on tags leaves the tail of the opening tag attached to its text,
    because an address inside href="mailto:..." ends the tag mid-attribute:
    `<a href="mailto:x@y" id="isPasted">Trenton Pruett` flattens with the
    attribute debris still on the front. Everything after the last ">" is the
    text; everything before it is markup.
    """
    if ">" in field:
        field = field.rsplit(">", 1)[1]
    return field.strip().strip('"').strip()


def looks_like_name(field: str) -> bool:
    """Is this field a person's name?

    Accepts the three forms directories actually print -- "Trenton Pruett",
    "ED WILSON", "Hanson, Thomas" (and "Danielson, Dr. Denise") -- and rejects
    job titles, departments and markup debris.
    """
    text = _readable(field)
    if not text or _DEBRIS.search(text):
        return False
    if _NOT_A_NAME.search(text):
        return False
    words = _WORD.findall(text)
    if not 2 <= len(words) <= 4:
        return False
    return all(w[0].isupper() for w in words)


def in_markup(block: str, at: int) -> bool:
    """Is the character at `at` inside a tag rather than in visible text?

    This is the whole decision. An address inside href="mailto:..." makes the
    anchor's TEXT that address's label -- the person's name on Campbell and
    Pope, the useless word "CONTACT" on Mt Pisgah. An address sitting in
    visible text has no label, and its person is whoever is listed before it.

    Distance cannot tell these apart. In

        Ann Poe | Head Soccer Coach | ADDR | Bob Roe | Head Football Coach

    Bob is nearer the address than Ann, and the address is Ann's.
    """
    opened = block.rfind("<", 0, at)
    closed = block.rfind(">", 0, at)
    return opened > closed


def name_and_title(block: str, addr: str) -> "tuple[str, str]":
    """This address's person and their role, or blanks.

    Order is: the anchor's own label, then the nearest name listed before the
    address. Never the nearest name in either direction -- on a dense page the
    nearest name AFTER an address is the next person, which is how Ann Poe's
    address was handed to Bob Roe.
    """
    i = block.find(addr)
    if i < 0:
        return "", ""
    before = _fields(block[:i])
    after = _fields(block[i + len(addr):])

    # 1. the label of the link this address is the target of
    if in_markup(block, i) and after and looks_like_name(after[0]):
        return _readable(after[0]), _role_in(after[1:])

    # 2. otherwise the nearest name BEFORE it, and the role between them
    for n, field in enumerate(reversed(before)):
        if looks_like_name(field):
            between = before[len(before) - n:] if n else []
            return _readable(field), _role_in(between)
    return "", ""


def _role_in(fields: "list[str]") -> str:
    """The first field that reads as a job title.

    Only ever called with the fields BETWEEN the chosen name and the address,
    so it cannot reach across another person. Scanning the whole window is what
    gave Trenton Pruett the title ", Head Football Coach", which belongs to
    Jeff Phillips, listed above him.
    """
    for field in fields:
        text = _readable(field)
        if text and "@" not in text and _ROLE.search(text) and len(text) < 90:
            return text
    return ""


# How far either side of an address to look for that person's name and title.
# Wide enough to clear a table row or a card, narrow enough not to reach the
# next person.
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


def unescape_address(email: str) -> str:
    """Percent-decode an address lifted out of an href, and trim it.

    Fourteen Cobb addresses arrive as %20bryan.rathke@cobbk12.org, because the
    page wrote href="mailto: bryan.rathke@..." with a stray space and the
    browser encoded it. Decoding %20 back to a space and trimming is reading
    the url exactly as a mail client would; nothing is guessed.

    This is deliberately NOT the same judgement as is_mangled(). Percent-
    decoding is defined by the url, so the answer is determined. Deciding that
    "mailto." is a typed-twice scheme rather than part of someone's local part
    is a guess, and a guess that invents an address is the one move this
    project does not make.
    """
    if "%" not in (email or ""):
        return email
    decoded = unquote(email).strip()
    return decoded if EMAIL_SHAPE.fullmatch(decoded) else email


def is_mangled(email: str) -> bool:
    """An address the page itself got wrong.

    Pope publishes href="mailto:mailto.denise.danielson@cobbk12.org" -- the
    school typed the scheme twice. The address that reaches us cannot deliver,
    and the obvious repair (drop the "mailto.") would CONSTRUCT an address the
    page does not contain, which is the one thing this project does not do. So
    the row is dropped. Two on that page.

    A local part still holding a % after unescape_address() has had its
    turn is the same situation: the escape did not decode to a real
    address, so what remains is unreadable rather than repairable.
    """
    local = (email or "").split("@")[0].lower()
    return local.startswith("mailto") or "%" in local or not local


class GenericHS(Adapter):
    name = "generic-hs"

    def detect(self, html: str) -> bool:
        return len(set(emails_in(html))) >= 3

    def parse(self, html: str, ctx: dict) -> "list[CoachRecord]":
        out: list[CoachRecord] = []
        seen: set[str] = set()
        for raw, block in blocks(html):
            email = unescape_address(raw)
            if email in seen or is_mangled(email):
                continue
            seen.add(email)

            # locate with the address AS PUBLISHED; the block still holds it
            name, title = name_and_title(block, raw)

            phone_m = PHONE.search(block)

            rec = CoachRecord(**Adapter._seed(ctx))
            rec.name = name
            rec.title = title
            rec.email = email
            rec.phone = phone_m.group(1) if phone_m else ""
            rec.platform = self.name
            out.append(rec)
        return out
