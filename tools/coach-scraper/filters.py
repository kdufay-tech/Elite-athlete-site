"""Who counts as a coach worth contacting.

This is the one module in the project that encodes a judgement about YOUR
outreach rather than a fact about HTML. A single D2 athletics directory holds
~163 people; roughly 40 are coaches in the five target sports and the rest are
ticket office, compliance, sports information and donor relations.

Real titles pulled from a live D2 directory, to show what is actually being
decided between:

    Head Coach                     <- certainly wanted
    Associate Head Coach           <- certainly wanted
    Assistant Coach                <- certainly wanted
    Director of Sports Performance <- S&C. Your entire D1 list was S&C staff.
    Graduate Assistant             <- wanted? they turn over every year
    Volunteer Assistant Coach      <- wanted?
    Director of Operations         <- admin, but sport-specific
    Team Chaplin                   <- almost certainly not
    Student Manager                <- certainly not
    Head Student Manager           <- certainly not

Run `python main.py titles` after a crawl to see the real distribution across
every school collected, then set the policy below against actual data.
"""

from __future__ import annotations

import re

# Titles that are never a coaching contact, regardless of policy.
#
# The "assistant to the head coach" family matters more than it looks: those
# titles CONTAIN "head coach", so without an explicit rejection they are
# matched by HEAD_COACH and kept as though they were the head coach. Auburn's
# directory alone has several. They are support staff, and mailing them as
# decision-makers wastes the send.
NEVER = re.compile(
    r"\b(student\s+manager|manager,\s*student|chaplin|chaplain|equipment\s+room"
    r"|intern|student\s+(?:assistant|worker|aide)|photographer|videographer"
    r"|broadcast|announcer|statistician|scorekeeper"
    r"|(?:executive|administrative|admin|personal|office)\s+assistant"
    r"|assistant\s+to\s+the\b|secretary|receptionist"
    r"|academic\s+(?:advisor|coordinator|counselor)"
    r"|nutritionist|dietitian|psychologist|counselor"
    r"|ticket|marketing|development\s+officer|donor|annual\s+giving)\b",
    re.I,
)

# Clear coaching titles, wanted under any policy.
CORE_COACH = re.compile(
    r"\b(head\s+coach|assistant\s+coach|associate\s+head\s+coach|co-?head\s+coach"
    r"|offensive\s+coordinator|defensive\s+coordinator|position\s+coach"
    r"|recruiting\s+coordinator)\b",
    re.I,
)

# Discretionary groups -- the actual decision.
STRENGTH = re.compile(r"\b(strength|conditioning|sports?\s+performance|s&c)\b", re.I)
GRAD_ASSISTANT = re.compile(r"\b(graduate\s+assistant|\bGA\b|grad\s+assistant)\b", re.I)
VOLUNTEER = re.compile(r"\bvolunteer\b", re.I)
OPERATIONS = re.compile(r"\b(director\s+of\s+operations|operations\s+coordinator"
                        r"|director\s+of\s+player\s+personnel)\b", re.I)


# ---------------------------------------------------------------------------
# TODO(you): set the four discretionary switches below.
#
# These four lines decide who receives your outreach. Each is a genuine
# trade-off, not a detail:
#
#   INCLUDE_STRENGTH    Your existing D1 list was 100% S&C staff, which implies
#                       they are the intended audience. But S&C coaches rarely
#                       control recruiting -- head coaches do. True widens reach
#                       by roughly 3-6 rows per school.
#   INCLUDE_GRAD_ASSTS  High volume, high turnover. Addresses go stale within a
#                       year, which drives future bounce rates up.
#   INCLUDE_VOLUNTEER   Often the most responsive people on a small staff, and
#                       often the least likely to have budget authority.
#   INCLUDE_OPERATIONS  Sport-specific admin. Frequently the person who actually
#                       reads the inbox and forwards what matters.
#
# Defaults below are deliberately conservative: core coaching staff only.
# ---------------------------------------------------------------------------
INCLUDE_STRENGTH = False
INCLUDE_GRAD_ASSTS = False
INCLUDE_VOLUNTEER = False
INCLUDE_OPERATIONS = False


# A head coach is wanted under every policy, and is checked before the
# discretionary groups so a combined title ("Head Coach & Director of
# Operations") is not rejected by the operations switch.
HEAD_COACH = re.compile(r"\bhead\s+coach\b", re.I)

# Generic catch-all: bare "Coach", or sport-prefixed variants such as
# "Pitching Coach" and "Goalkeeper Coach".
ANY_COACH = re.compile(r"\bcoach(es|ing)?\b", re.I)

# Order matters: each discretionary group is decided before ANY_COACH gets a
# say. Checking them afterwards silently defeats the switches, because titles
# in the wild read "Graduate Assistant Football Coach" and "Volunteer Assistant
# Coach" -- both contain "coach", so a trailing fallback lets every one of them
# through no matter how the flags are set.
DISCRETIONARY = (
    ("grad assistant", lambda: INCLUDE_GRAD_ASSTS, GRAD_ASSISTANT),
    ("volunteer", lambda: INCLUDE_VOLUNTEER, VOLUNTEER),
    ("strength", lambda: INCLUDE_STRENGTH, STRENGTH),
    ("operations", lambda: INCLUDE_OPERATIONS, OPERATIONS),
)


def is_target_coach(title: str, category: str, sport: str) -> bool:
    """Decide whether one scraped row belongs in the outreach export.

    `title`    the person's job title, e.g. "Assistant Coach"
    `category` the directory heading they sat under, e.g. "Men's Basketball"
    `sport`    folded sport, or "" when the row could not be attributed
    Returns True to keep the row.
    """
    if not sport:
        return False

    blob = f"{title} {category}"
    if NEVER.search(blob):
        return False
    if HEAD_COACH.search(title):
        return True

    for _label, flag, pattern in DISCRETIONARY:
        if pattern.search(blob):
            return bool(flag())

    if CORE_COACH.search(title):
        return True
    return bool(ANY_COACH.search(title))


def explain(title: str, category: str, sport: str) -> str:
    """Why a row was kept or dropped. Used when tuning the switches."""
    if not sport:
        return "drop: no target sport"
    blob = f"{title} {category}"
    if NEVER.search(blob):
        return "drop: never-contact title"
    if HEAD_COACH.search(title):
        return "keep: head coach"
    for label, flag, pattern in DISCRETIONARY:
        if pattern.search(blob):
            return f"{'keep' if flag() else 'drop'}: {label} (switch is {bool(flag())})"
    if CORE_COACH.search(title):
        return "keep: core coaching title"
    if ANY_COACH.search(title):
        return "keep: generic coach title"
    return "drop: not a coaching title"
