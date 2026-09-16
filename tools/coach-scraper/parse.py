"""Stage 2: turn archived HTML into clean, filtered coach records.

Runs entirely offline against the archive, so parser changes cost nothing and
hit nobody. This is the loop you iterate on.
"""

from __future__ import annotations

import logging
from collections import Counter

import address as address_mod
import filters
import normalize
from adapters import adapter_for
from adapters.base import CoachRecord
from archive import Archive
from registry import School

log = logging.getLogger(__name__)


def parse_school(page: dict, school: School | None, arc: Archive) -> list[CoachRecord]:
    html = page["html"]
    adapter = adapter_for(html)
    ctx = {
        "school": school.school if school else page["school_id"],
        "school_id": page["school_id"],
        "division": school.division if school else "",
        "state": school.state if school else "",
        "conference": school.conference if school else "",
        "proof_url": page.get("final_url") or page.get("url") or "",
        "captured_at": page.get("fetched_at", ""),
    }

    records = adapter.parse(html, ctx)

    # Address: the contact page if we have one, otherwise the directory footer.
    contact = arc.get_page(page["school_id"], "contact")
    found = address_mod.extract(contact["html"]) if contact else {}
    if not found.get("address_line"):
        found = address_mod.extract(html)
    if found.get("address_line"):
        for r in records:
            r.address_line = found["address_line"]
            r.address_city = found["address_city"]
            r.address_state = found["address_state"]
            r.address_zip = found["address_zip"]

    return records


def parse_all(arc: Archive, schools: list[School],
              apply_filter: bool = True) -> tuple[list[CoachRecord], dict]:
    by_id = {s.school_id: s for s in schools}
    raw_total = 0
    kept: list[CoachRecord] = []
    dropped = Counter()

    for page in arc.iter_pages("staff"):
        school = by_id.get(page["school_id"])
        try:
            records = parse_school(page, school, arc)
        except Exception as exc:                      # one bad page must not
            log.warning("parse failed %s: %s", page["school_id"], exc)
            dropped["parse-error"] += 1               # stop the other 1,899
            continue

        raw_total += len(records)
        for rec in records:
            clean = normalize.normalize(rec)
            if clean is None:
                dropped["no-email"] += 1
                continue
            if not clean.sport:
                dropped["not-target-sport"] += 1
                continue
            if apply_filter and not filters.is_target_coach(
                    clean.title, clean.category, clean.sport):
                dropped["not-target-role"] += 1
                continue
            kept.append(clean)

    deduped = normalize.dedupe(kept)
    stats = {
        "rows_seen": raw_total,
        "kept_before_dedupe": len(kept),
        "kept": len(deduped),
        "dropped": dict(dropped),
        "by_division": dict(Counter(r.division for r in deduped)),
        "by_sport": dict(Counter(r.sport for r in deduped)),
        "with_phone": sum(1 for r in deduped if r.phone),
        "with_address": sum(1 for r in deduped if r.address_line),
    }
    return deduped, stats


def title_distribution(arc: Archive, schools: list[School]) -> Counter:
    """Every title seen in the five target sports, for tuning filters.py."""
    by_id = {s.school_id: s for s in schools}
    counter = Counter()
    for page in arc.iter_pages("staff"):
        try:
            records = parse_school(page, by_id.get(page["school_id"]), arc)
        except Exception:
            continue
        for rec in records:
            clean = normalize.normalize(rec)
            if clean and clean.sport and clean.title:
                counter[clean.title] += 1
    return counter
