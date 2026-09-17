"""Score the crawl against 1,163 addresses already proven to deliver.

Recall is the metric, not precision. Those addresses each have a delivery on
record, so every one the crawler misses is a real gap in the parsers -- and that
gap would be invisible in all 49 states where there is no ground truth.

Novel finds are NOT errors. BookYourData is a purchased subset of Metro
Atlanta, so finding people it lacks is the point.

Scope: the 106 schools BookYourData covers, never all of Georgia. Scoring
statewide would dilute recall by construction.
"""

from __future__ import annotations

import csv
import re
from pathlib import Path

import _shared  # noqa: F401
from adapters.base import CoachRecord

GATE_RECALL = 60.0
GATE_AGREEMENT = 95.0


def load_known(path: Path | str) -> list[dict]:
    with Path(path).open(newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


_SCHOOL_WORDS = re.compile(r"\b(high\s+school|high|hs|school)\b", re.I)


def _norm(s: str) -> str:
    """Compare schools by identity rather than by spelling.

    The ground truth says "Campbell". A record may carry "ga-campbell" (the
    registry id, which is what the crawl context seeds) or "CAMPBELL HIGH
    SCHOOL" (what a directory page prints). All three are one school.

    Comparing the raw strings reported 0.0% agreement across six matches that
    were, every one of them, the correct school -- a score measuring the
    comparison instead of the data. An agreement figure that cannot rise above
    zero is not a strict test, it is a broken one, and it is worse than no
    figure because it looks like evidence.
    """
    s = (s or "").lower().replace("_", " ").replace("-", " ")
    s = _SCHOOL_WORDS.sub(" ", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = " ".join(s.split())
    # registry ids are state-prefixed; the ground truth is not
    if s.startswith("ga ") and s[3:].strip():
        s = s[3:].strip()
    return s


def score(found: list[CoachRecord], known: list[dict]) -> dict:
    known_by_email = {(k.get("email") or "").lower().strip(): k for k in known}
    found_by_email = {(f.email or "").lower().strip(): f for f in found}

    hit = set(known_by_email) & set(found_by_email)
    missed = set(known_by_email) - set(found_by_email)
    novel = set(found_by_email) - set(known_by_email)

    agree = 0
    for email in hit:
        k, f = known_by_email[email], found_by_email[email]
        if _norm(k.get("school", "")) == _norm(f.school):
            agree += 1

    return {
        "known_total": len(known_by_email),
        "found_total": len(found_by_email),
        "matched": len(hit),
        "missed": len(missed),
        "novel": len(novel),
        "recall": round(100.0 * len(hit) / len(known_by_email), 1) if known_by_email else 0.0,
        "agreement": round(100.0 * agree / len(hit), 1) if hit else 0.0,
    }


def verdict(result: dict) -> str:
    ok = result["recall"] >= GATE_RECALL and result["agreement"] >= GATE_AGREEMENT
    return "PASS - crawl the next state" if ok else (
        f"HOLD - recall {result['recall']}% (need {GATE_RECALL}%), "
        f"agreement {result['agreement']}% (need {GATE_AGREEMENT}%). "
        "Fix the parsers before adding states."
    )
