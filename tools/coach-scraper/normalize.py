"""Clean scraped rows into the shape coach_contacts expects.

Adapters report what a page said; this module decides what it meant. Keeping
the two apart means sport folding and name splitting are written and tested
once rather than repeated in every adapter.
"""

from __future__ import annotations

import re

import config
from adapters.base import CoachRecord

# Titles and suffixes that are not part of a person's name.
HONORIFICS = {"dr", "dr.", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "coach", "prof", "prof."}
SUFFIXES = {"jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "phd", "ph.d.", "m.d.", "ed.d."}

_EXCLUSIONS = [re.compile(p, re.I) for p in config.SPORT_EXCLUSIONS]
_SPORT_PATTERNS = {
    sport: [re.compile(p, re.I) for p in pats]
    for sport, pats in config.SPORT_PATTERNS.items()
}


def fold_sport(category: str, title: str = "") -> str:
    """Map a directory heading to one of the five target sports.

    Exclusions are checked first and are absolute: "Field Hockey" must never
    become "hockey", and a substring match would do exactly that.
    """
    blob = f"{category} {title}"
    for pattern in _EXCLUSIONS:
        if pattern.search(blob):
            return ""
    for sport, patterns in _SPORT_PATTERNS.items():
        if any(p.search(blob) for p in patterns):
            return sport
    return ""


def split_name(full: str) -> tuple[str, str]:
    """Split a display name into first and last.

    Sidearm frequently emits double spaces ("Keri  Becker") from empty middle
    name fields, so whitespace is collapsed before splitting.
    """
    cleaned = re.sub(r"\s+", " ", (full or "").strip())
    if not cleaned:
        return "", ""
    parts = [p for p in cleaned.split(" ") if p]
    while parts and parts[0].lower().strip(".") in {h.strip(".") for h in HONORIFICS}:
        parts.pop(0)
    while len(parts) > 2 and parts[-1].lower().strip(".") in {s.strip(".") for s in SUFFIXES}:
        parts.pop()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[-1]


def clean_phone(raw: str) -> str:
    """Normalize to (XXX) XXX-XXXX; return "" if it is not a US number."""
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return ""
    return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"


def clean_email(raw: str) -> str:
    email = (raw or "").strip().lower().strip(".")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", email):
        return ""
    # Image and asset paths occasionally survive the bare-email regex.
    if re.search(r"\.(png|jpg|jpeg|gif|svg|css|js|webp)$", email):
        return ""
    return email


def sport_detail(category: str) -> str:
    """Keep the gendered heading -- "Women's Soccer" is a different program
    from "Men's Soccer", and a recruit cares which one they are contacting.

    Some directories append contact details to the heading itself, producing
    values like "Basketball (M) 334-844-9760" and "Volleyball - Phone:
    828-262-2844". Those are stripped so the field stays a program name.
    """
    text = re.sub(r"\s+", " ", (category or "").strip())
    # Several directories append the department's own contact block to the
    # heading, e.g. "Women's Basketball - Suite 670 - - Fax:" and
    # "Men's Basketball | | Fax: menshoops@georgetown.edu". The program name is
    # always first, so cut at the first separator and drop the rest.
    text = re.split(r"\s*[•|]\s*", text)[0]
    text = re.sub(r"\s*[-|,]?\s*(?:phone|tel|ph|fax|office|suite|room)\b\s*:?\s*.*$",
                  "", text, flags=re.I)
    text = re.sub(r"\S+@\S+", "", text)
    text = re.sub(r"\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]\d{4}", "", text)
    return re.sub(r"\s+", " ", text).strip(" -|,•")


def normalize(record: CoachRecord) -> CoachRecord | None:
    """Clean one record in place. Returns None if it cannot be used."""
    record.email = clean_email(record.email)
    if not record.email:
        return None  # email is the dedupe key in coach_contacts; no email, no row

    record.phone = clean_phone(record.phone)
    record.name = re.sub(r"\s+", " ", (record.name or "").strip())
    record.first_name, record.last_name = split_name(record.name)
    record.title = re.sub(r"\s+", " ", (record.title or "").strip())
    record.sport = fold_sport(record.category, record.title)
    record.sport_detail = sport_detail(record.category)
    return record


def dedupe(records: list[CoachRecord]) -> list[CoachRecord]:
    """One row per email, matching the importer's own dedupe key.

    Where the same address appears under several sports (a strength coach
    covering four programs), keep the copy with the most complete data so the
    surviving row is the informative one.
    """
    def completeness(r: CoachRecord) -> int:
        return sum(bool(v) for v in (r.name, r.title, r.phone, r.sport, r.address_line))

    best: dict[str, CoachRecord] = {}
    for r in records:
        prior = best.get(r.email)
        if prior is None or completeness(r) > completeness(prior):
            best[r.email] = r
    return list(best.values())
