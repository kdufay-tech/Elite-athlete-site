"""Generate batched SQL to load the export into coach_contacts.

Mirrors netlify/functions/coach-contacts-import.js semantics exactly:
  * ON CONFLICT (email) DO NOTHING -- an existing row is never modified, the
    incoming duplicate is discarded, and an unsubscribe can never be revived
  * status='active', validated=true (earned: each address was read off the page
    recorded in proof_url)

The payload is normalized before emitting. School-level fields (state, region,
division, address, proof_url) are identical for every coach at a school, so
repeating them 1,582 times would trip the transport limit. They go into one
small mapping statement instead, and a single UPDATE joins them on. Only
genuinely per-person columns are repeated per row.
"""

from __future__ import annotations

import csv
import os
import shutil
from pathlib import Path

HERE = Path(__file__).parent
SRC = HERE / "out" / "coaches_all.csv"
OUT = HERE / "out" / "import"
BATCH = 150

# Per-person: varies row by row.
PERSON_COLS = ("email,coach_name,sport,phone,title,sport_detail,school,"
               "status,validated,level,classification")
PERSON_FIELDS = ["Email", "Coach Name", "Sport", "Phone", "Title",
                 "Sport Detail", "School"]
CONSTANTS = "'active',true,'college','COLLEGE_VERIFIED_SCRAPER'"

# Per-school: constant within a school, applied by join afterwards.
SCHOOL_FIELDS = ["School", "State", "Region", "Division", "Address",
                 "Address City", "Address State", "Address Zip", "Proof URL"]

CAPTURED_AT = "2026-09-14"   # every row in this export; verified day-precision


def q(value: str) -> str:
    value = (value or "").strip()
    return "NULL" if value == "" else "'" + value.replace("'", "''") + "'"


def main() -> None:
    rows = list(csv.DictReader(SRC.open(encoding="utf-8")))
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir(parents=True)

    # ---- per-person inserts ------------------------------------------------
    batches = 0
    for start in range(0, len(rows), BATCH):
        tuples = [
            "(" + ",".join(q(r[f]) for f in PERSON_FIELDS) + "," + CONSTANTS + ")"
            for r in rows[start:start + BATCH]
        ]
        sql = ("INSERT INTO coach_contacts (" + PERSON_COLS + ")\nVALUES\n"
               + ",\n".join(tuples) + "\nON CONFLICT (email) DO NOTHING;")
        batches += 1
        (OUT / ("b%d.sql" % batches)).write_text(sql, encoding="utf-8")

    # ---- per-school join ---------------------------------------------------
    schools: dict[str, list[str]] = {}
    for r in rows:
        schools.setdefault(r["School"], [r[f] for f in SCHOOL_FIELDS])
    tuples = ["(" + ",".join(q(v) for v in vals) + ")" for vals in schools.values()]
    join_sql = (
        "UPDATE coach_contacts c SET\n"
        "  state = s.state, region = s.region, division = s.division,\n"
        "  address_line = s.addr, address_city = s.city,\n"
        "  address_state = s.astate, address_zip = s.zip,\n"
        "  proof_url = s.proof, website = s.proof,\n"
        "  source = 'Scrape NCAA ' || s.division || ' 2026-09',\n"
        "  captured_at = '" + CAPTURED_AT + "'::timestamptz\n"
        "FROM (VALUES\n" + ",\n".join(tuples) +
        "\n) AS s(school, state, region, division, addr, city, astate, zip, proof)\n"
        # source IS NULL is the ONLY safe discriminator for freshly inserted
        # rows. An earlier draft used "division IS NULL", which looked specific
        # because division is a brand-new column -- but for exactly that reason
        # every pre-existing row has it NULL too, so the join would have
        # rewritten state/region/source on all 5,629 Autobuild rows. Verified:
        # 0 pre-existing rows have a null source.
        "WHERE c.school = s.school\n"
        "  AND c.source IS NULL;"
    )
    (OUT / "join_schools.sql").write_text(join_sql, encoding="utf-8")

    total = 0
    for name in sorted(os.listdir(OUT)):
        size = (OUT / name).stat().st_size
        total += size
        print("  %-18s %6d bytes" % (name, size))
    print("  %d person batches + 1 join, %d rows, %d schools, %d KB"
          % (batches, len(rows), len(schools), total // 1024))


if __name__ == "__main__":
    main()
