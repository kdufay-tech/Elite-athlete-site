"""Recover an athletics department mailing address from archived HTML.

Four sources, tried in descending order of reliability:

  1. schema.org JSON-LD  -- a machine-readable address the site published on purpose
  2. microdata PostalAddress
  3. STRICT regex        -- requires a recognised street type; precise
  4. ANCHORED regex      -- anchored on "City, ST ZIP"; catches the rest

The two-regex split is deliberate. STRICT parses "401 College Ave.  Ashland,
OH 44805" correctly but cannot see "2601 W Avenue N" (suffix after the street
type) or "500 El Camino Real" (street type not on any finite list). ANCHORED
catches both by keying on the one part of a US address that is always
well-formed -- the "City, ST ZIP" tail -- but it over-captures on noisy
footers ("Copyright 2024 | 1 Main St, ..."). Running strict first means the
common case is parsed cleanly and the fallback only sees what strict rejected.
"""

from __future__ import annotations

import json
import re

from bs4 import BeautifulSoup

STREET_TYPES = (
    r"Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Boulevard|Blvd|Lane|Ln|Way|Circle|Cir|"
    r"Court|Ct|Parkway|Pkwy|Highway|Hwy|Place|Pl|Terrace|Trail|Loop|Square|Sq"
)

# Precise: number, up to four name words, a known street type.
STRICT = re.compile(
    r"(\d{1,6}\s+(?:[A-Z][A-Za-z0-9.'\-]*\s+){0,4}(?:" + STREET_TYPES + r")\.?)"
    r"[\s,]+([A-Z][A-Za-z.'\- ]{1,28}?)\s*,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b"
)

# Recall: anything starting with a house number, keyed to the City, ST ZIP tail.
# "|" is excluded so a footer separator cannot be swallowed into the street.
ANCHORED = re.compile(
    r"(\d{1,6}\s+[^,;<>\n\r|]{3,60}?)"
    r"[\s,]+([A-Z][A-Za-z.'\- ]{1,28}?)\s*,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b"
)

BLANK = {"address_line": "", "address_city": "", "address_state": "", "address_zip": ""}


def extract(html: str) -> dict:
    """Return {address_line, address_city, address_state, address_zip}."""
    if not html:
        return dict(BLANK)

    soup = BeautifulSoup(html, "lxml")

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        found = _from_jsonld(script.string or "")
        if found:
            return found

    node = soup.find(attrs={"itemtype": re.compile("PostalAddress", re.I)})
    if node:
        found = _from_microdata(node)
        if found:
            return found

    text = soup.get_text(" ", strip=True)
    for pattern in (STRICT, ANCHORED):
        match = pattern.search(text)
        if match:
            return _clean(match.groups())
    return dict(BLANK)


def _clean(groups) -> dict:
    line, city, state, zip_code = (g.strip(" ,\t\r\n") for g in groups)
    line = re.sub(r"\s+", " ", line)
    city = re.sub(r"\s+", " ", city)
    return {
        "address_line": line,
        "address_city": city,
        "address_state": state.upper(),
        "address_zip": zip_code,
    }


def _from_jsonld(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    for node in _walk(data):
        if not isinstance(node, dict):
            continue
        addr = node.get("address")
        if isinstance(addr, dict) and addr.get("streetAddress"):
            return {
                "address_line": str(addr.get("streetAddress", "")).strip(),
                "address_city": str(addr.get("addressLocality", "")).strip(),
                "address_state": str(addr.get("addressRegion", "")).strip()[:2].upper(),
                "address_zip": str(addr.get("postalCode", "")).strip()[:10],
            }
    return None


def _from_microdata(node) -> dict | None:
    def prop(name: str) -> str:
        el = node.find(attrs={"itemprop": name})
        return el.get_text(" ", strip=True) if el else ""

    line = prop("streetAddress")
    if not line:
        return None
    return {
        "address_line": line,
        "address_city": prop("addressLocality"),
        "address_state": prop("addressRegion")[:2].upper(),
        "address_zip": prop("postalCode")[:10],
    }


def _walk(node):
    """Yield every dict in an arbitrarily nested JSON-LD document."""
    if isinstance(node, dict):
        yield node
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from _walk(item)
