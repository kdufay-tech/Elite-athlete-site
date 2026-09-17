"""The gates, enforced in code rather than by discipline.

Each one exists because something measurable went wrong:

  proof_url  Three fabricated families reached coach_contacts carrying
             validated=true. A row that cannot name the page it came from is
             not evidence of anything.
  title      Crawl-recovered titles bounce at 0.73%; untitled rows at 3.86%.
             The title is not seniority, it is proof a live page listed that
             person -- so a row without one is not a contact.
  entropy    performance@ appeared at 24 distinct domains. No real directory
             produces one identically-named mailbox at two dozen schools.
"""

from __future__ import annotations

from collections import defaultdict

import _shared  # noqa: F401
import config_hs
from adapters.base import CoachRecord


class EntropyError(RuntimeError):
    """Raised when one local part appears at too many domains to be real."""


def status_for(rec: CoachRecord) -> str:
    """'active' only when the row can defend itself. Otherwise 'unverified'."""
    if not (rec.proof_url or "").strip():
        return "unverified"
    if not (rec.title or "").strip():
        return "unverified"
    if not (rec.email or "").strip():
        return "unverified"
    return "active"


TARGET_SPORTS = {"football", "basketball", "soccer", "volleyball", "hockey"}


def keep(rec: CoachRecord) -> bool:
    """Is this row in scope at all?

    normalize.normalize() returns None only when the email is missing, so a row
    whose title folds to no sport -- an athletic director, a band director, a
    school nurse -- passes straight through it. The spec scopes this project to
    five sports, so the drop happens here instead.

    fold_sport()'s exclusions are absolute upstream: "Field Hockey" folds to ""
    rather than to hockey, so it arrives here and is dropped.
    """
    return (rec.sport or "") in TARGET_SPORTS


def entropy_report(records: list[CoachRecord]) -> dict[str, int]:
    """local part -> number of DISTINCT domains it appears at."""
    seen: dict[str, set[str]] = defaultdict(set)
    for r in records:
        if "@" not in (r.email or ""):
            continue
        local, _, domain = r.email.lower().partition("@")
        seen[local].add(domain)
    return {local: len(domains) for local, domains in seen.items()}


def assert_entropy(records: list[CoachRecord]) -> None:
    report = entropy_report(records)
    bad = {k: v for k, v in report.items() if v > config_hs.MAX_DOMAINS_PER_LOCAL_PART}
    if bad:
        worst = sorted(bad.items(), key=lambda kv: -kv[1])[:10]
        detail = ", ".join(f"{k}@ x{v}" for k, v in worst)
        raise EntropyError(
            f"{len(bad)} local part(s) appear at more than "
            f"{config_hs.MAX_DOMAINS_PER_LOCAL_PART} domains: {detail}. "
            "This is the fabrication signature - do not import."
        )
