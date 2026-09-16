"""Classification layer: turn scraped rows into segmented, sendable records.

Everything here is derived from data already collected -- nothing is fetched,
nothing is guessed about a person. Four dimensions get added:

  state / region   so Coach Ops can file rows into its state/region folders
  role_tier        head / coordinator / assistant / support
  program          men's / women's / coed, from the directory heading
  confidence       how well the row corroborates itself (see below)

The confidence tier is the one that matters for a first send. It grades how
independently the row checks out, NOT whether the mailbox is live -- no amount
of parsing proves deliverability. Use tier A for a warm-up send and hold C back
until the bounce rate on A is known.
"""

from __future__ import annotations

import re

# Same mapping as US_REGION in netlify/functions/coach-contacts-import.js, so
# rows classified here land in the folders Coach Ops already expects.
US_REGION = {
    **{s: "Northeast" for s in "CT ME MA NH NJ NY PA RI VT".split()},
    **{s: "Southeast" for s in "AL AR FL GA KY LA MS NC SC TN VA WV DC DE MD".split()},
    **{s: "Midwest" for s in "IL IN IA KS MI MN MO NE ND OH SD WI".split()},
    **{s: "Southwest" for s in "AZ NM OK TX".split()},
    **{s: "West" for s in "AK CA CO HI ID MT NV OR UT WA WY".split()},
}

# D1 schools whose athletics domain was harvested from a CSV that carried no
# state column, and whose scraped footer had no address either. Nineteen rows,
# each an unambiguous public fact about where the institution sits.
SCHOOL_STATE = {
    "Air Force": "CO", "App State": "NC", "BYU": "UT", "Cincinnati": "OH",
    "Clemson": "SC", "Creighton": "NE", "Indiana": "IN", "Iowa": "IA",
    "Iowa State": "IA", "LSU": "LA", "Memphis": "TN", "Notre Dame": "IN",
    "Ohio State": "OH", "Penn State": "PA", "San Diego State": "CA",
    "Stanford": "CA", "Texas A&M": "TX", "UCF": "FL", "Alabama": "AL",
    "Auburn": "AL", "Arizona": "AZ", "Arkansas": "AR", "Army": "NY",
    "Baylor": "TX", "Boise State": "ID", "Boston College": "MA",
    "Colorado": "CO", "Connecticut": "CT", "Cornell": "NY", "Duke": "NC",
    "Florida": "FL", "Florida State": "FL", "Fresno State": "CA",
    "Georgia": "GA", "Georgetown": "DC", "Gonzaga": "WA", "Houston": "TX",
    "Illinois": "IL", "James Madison": "VA", "Kansas": "KS",
    "Kansas State": "KS", "Kentucky": "KY", "Louisville": "KY",
    "Marquette": "WI", "Marshall": "WV", "Maryland": "MD", "Miami FL": "FL",
    "Michigan": "MI", "Michigan State": "MI", "Minnesota": "MN",
    "Mississippi State": "MS", "Missouri": "MO", "NC State": "NC",
    "Navy": "MD", "Nebraska": "NE", "North Carolina": "NC",
    "North Dakota": "ND", "Northwestern": "IL", "Ole Miss": "MS",
    "Oklahoma": "OK", "Oregon": "OR", "Pittsburgh": "PA", "Purdue": "IN",
    "Rutgers": "NJ", "South Carolina": "SC", "Syracuse": "NY", "TCU": "TX",
    "Tennessee": "TN", "Texas": "TX", "Troy": "AL", "Tulane": "LA",
    "UCLA": "CA", "USC": "CA", "Vanderbilt": "TN", "Villanova": "PA",
    "Virginia": "VA", "Virginia Tech": "VA", "Wake Forest": "NC",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI",
    "Xavier": "OH", "Denver": "CO",
}

# Order of these three is load-bearing, and the reason is the same pattern that
# bit filters.py: "Associate Head Coach" and "Assistant Head Coach" both
# CONTAIN "head coach". Testing HEAD first promotes every senior assistant to
# head coach, which is precisely the distinction the tier exists to make --
# the head coach is the decision-maker, the associate is not.
SECOND_IN_COMMAND = re.compile(
    r"\b(?:associate|assistant|asst\.?|co-?|interim|acting)\s+head\s+coach\b", re.I)
HEAD = re.compile(r"\bhead\s+coach\b|\bhead\s+(?:men|women|football|basketball"
                  r"|soccer|volleyball|hockey)", re.I)
COORDINATOR = re.compile(r"\bcoordinator\b", re.I)
ASSISTANT = re.compile(r"\bassistant\b|\bass't\b|\basst\.?\b", re.I)

# "(M)" / "(W)" are checked as well as the spelled-out words: several
# directories label programs as "Basketball (M)" rather than "Men's Basketball".
# Note WOMENS is tested first everywhere, because "women" contains "men".
MENS = re.compile(r"\bmen'?s?\b|\(\s*m\s*\)|\bmale\b", re.I)
WOMENS = re.compile(r"\bwomen'?s?\b|\(\s*w\s*\)|\bfemale\b|\bladies\b", re.I)


def state_for(row: dict) -> str:
    """Best available state: scraped address, then registry, then school map."""
    for key in ("Address State", "State"):
        value = (row.get(key) or "").strip().upper()
        if len(value) == 2 and value.isalpha():
            return value
    return SCHOOL_STATE.get((row.get("School") or "").strip(), "")


def region_for(state: str) -> str:
    return US_REGION.get((state or "").upper(), "")


def role_tier(title: str) -> str:
    """Seniority band. Head coaches decide; assistants often answer.

    SECOND_IN_COMMAND is tested before HEAD so "Associate Head Coach" does not
    get promoted to "head" by the substring it contains.
    """
    if SECOND_IN_COMMAND.search(title):
        return "coordinator"
    if HEAD.search(title):
        return "head"
    if COORDINATOR.search(title):
        return "coordinator"
    if ASSISTANT.search(title):
        return "assistant"
    return "other"


def program(sport_detail: str, title: str) -> str:
    """Men's / women's / coed. A women's program is a different buyer from
    the men's program at the same school, so this must survive."""
    blob = f"{sport_detail} {title}"
    has_w, has_m = bool(WOMENS.search(blob)), bool(MENS.search(blob))
    if has_w and not has_m:
        return "womens"
    if has_m and not has_w:
        return "mens"
    if has_w and has_m:
        return "both"
    return ""


def name_corroborates(name: str, email: str) -> str:
    """Does the local-part independently corroborate the person's name?

    This is the pairing check: if the parser ever attached the wrong person's
    address to a row, this is what fails. Returns 'name', 'initials',
    'departmental' or ''.
    """
    local = email.split("@")[0].lower()
    alpha = re.sub(r"[^a-z]", "", local)
    parts = [re.sub(r"[^a-z]", "", p.lower()) for p in name.split()]
    parts = [p for p in parts if len(p) > 1]
    if not parts or not alpha:
        return ""
    first, last = parts[0], parts[-1]

    candidates = [last, first, first[:1] + last, first + last[:1],
                  last + first[:1], last[:5], first[:1] + last[:5],
                  first[:2] + last[:4], last[:4] + first[:2]]
    if any(len(c) >= 3 and c in alpha for c in candidates):
        return "name"

    # Initials plus an employee number, e.g. Auburn's irb0008 = Ian R. Borders.
    m = re.fullmatch(r"([a-z])([a-z])?([a-z])\d{1,6}", local)
    if m and m.group(1) == first[:1] and m.group(3) == last[:1]:
        return "initials"

    if re.fullmatch(
        r"(m|w|a|[a-z]{0,8})?(football|soccer|basketball|volleyball|hockey"
        r"|bball|vball|hoops|athletics|recruit\w*|coach\w*)\d*", alpha
    ):
        return "departmental"
    return ""


def confidence(row: dict) -> str:
    """A / B / C. Grades self-corroboration, NOT deliverability.

    A  a real platform adapter parsed it AND the local-part corroborates the
       person's name. These are the rows to send first.
    B  a real adapter parsed it, but the address is departmental or initials-
       based, so the name link cannot be independently confirmed.
    C  the generic adapter produced it, or nothing corroborates the pairing.
       Hold these back until A's bounce rate is known.
    """
    platform = (row.get("Platform") or "").strip()
    corroboration = name_corroborates(row.get("Coach Name", ""), row.get("Email", ""))
    structured = platform in ("sidearm", "wmt", "presto")

    if structured and corroboration == "name":
        return "A"
    if structured and corroboration in ("initials", "departmental"):
        return "B"
    return "C"


def classify(row: dict) -> dict:
    """Add the derived columns to one exported row, in place."""
    state = state_for(row)
    row["State"] = state
    row["Region"] = region_for(state)
    row["Role Tier"] = role_tier(row.get("Title", ""))
    row["Program"] = program(row.get("Sport Detail", ""), row.get("Title", ""))
    row["Confidence"] = confidence(row)
    row["Name Check"] = name_corroborates(row.get("Coach Name", ""), row.get("Email", ""))
    contact = ["email"]
    if row.get("Phone", "").strip():
        contact.append("phone")
    if row.get("Address", "").strip():
        contact.append("address")
    row["Contact Completeness"] = "+".join(contact)
    return row
