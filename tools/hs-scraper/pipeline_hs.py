"""Archive -> contacts, in one place that everything calls.

This module exists because of a failure, not a design. Three capabilities on
this project were built, tested, green -- and never reached by anything: the
Finalsite adapter nothing imported, the crawl gate that discarded the very
pages that adapter could read, and the coach roster nothing consulted. Each was
invisible until an end-to-end number was finally measured, because unit tests
call a function directly and therefore cannot tell you that production does not.

So there is exactly ONE extraction path, and the scorer and the state runner
both call it. A second copy of these six lines is how the fourth one happens.

ORDER IS LOAD-BEARING. normalize() assigns

    record.sport = fold_sport(record.category, record.title)

unconditionally, so attribution MUST run after it. Attributing first would set
the sport from the association's roster and then have normalize silently
overwrite it with a blank derived from a title like "Asst. Coach" -- the code
would run, the tests would pass, and the join would do nothing at all.
"""

from __future__ import annotations

import _shared  # noqa: F401
import adapters_hs
import manifest
import normalize


def iter_staff_pages(arch):
    """Every archived staff page, including paginated ones.

    archive.iter_pages() matches `kind` exactly, and paginated pages are stored
    as "staff:2", "staff:3" and so on because the archive's upsert key is
    (school_id, kind) -- reusing "staff" would overwrite page one. The college
    package is off limits to modify, so this reads the same connection with a
    prefix match rather than changing iter_pages().
    """
    import zlib

    cur = arch.conn.execute(
        "SELECT * FROM pages WHERE (kind = 'staff' OR kind LIKE 'staff:%') "
        "AND html_z IS NOT NULL ORDER BY school_id, kind"
    )
    for row in cur:
        data = dict(row)
        data["html"] = zlib.decompress(row["html_z"]).decode("utf-8", "replace")
        yield data


def extract(arch, schools: list, roster: list) -> list:
    """Parse every archived staff page into normalised, attributed contacts.

    Returns deduped CoachRecords. Never constructs an address: a page with no
    addresses yields no rows, and a record matching no roster entry keeps a
    blank school and sport rather than being assigned a convenient default.
    """
    units = manifest.build(schools, roster)
    unit_of = {s.school_id: u for u in units for s in u.schools}

    raw: list = []
    page_school: dict[int, str] = {}
    for page in iter_staff_pages(arch):
        html = page.get("html") or ""
        if not html:
            continue
        school_id = page.get("school_id", "")
        ctx = {
            "school": school_id,
            "school_id": school_id,
            "state": "GA",
            "proof_url": page.get("final_url") or page.get("url", ""),
            "captured_at": page.get("fetched_at", ""),
        }
        for rec in adapters_hs.adapter_for(html).parse(html, ctx):
            page_school[id(rec)] = school_id
            raw.append(rec)

    # normalize first -- it drops rows with no address and folds whatever sport
    # the page's own title states. See the module docstring: reversing these two
    # steps silently disables the roster join.
    clean = [r for r in (normalize.normalize(x) for x in raw) if r]

    # Attribute per unit. A shared district page serves many schools, so which
    # school a coach belongs to comes from matching their NAME against that
    # unit's roster, never from which url we happened to fetch.
    by_unit: dict[int, list] = {}
    for rec in clean:
        unit = unit_of.get(page_school.get(id(rec), ""))
        if unit is not None:
            by_unit.setdefault(id(unit), []).append(rec)
    units_by_id = {id(u): u for u in units}
    for uid, recs in by_unit.items():
        manifest.attribute(recs, units_by_id[uid])

    return normalize.dedupe(clean)


def summarise(records: list) -> dict:
    """Counts worth printing after a run, and worth watching between runs."""
    return {
        "records": len(records),
        "with_name": sum(1 for r in records if r.name),
        "with_title": sum(1 for r in records if r.title),
        "with_sport": sum(1 for r in records if r.sport),
        "with_proof": sum(1 for r in records if r.proof_url),
        "schools": len({r.school for r in records if r.school}),
    }
