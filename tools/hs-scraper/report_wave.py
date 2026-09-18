"""What a wave actually produced, per school and per sport.

Run after crawl_wave.py. Parses the whole archive through the one extraction
path (pipeline_hs.extract) rather than a second copy of those six lines -- a
separate copy is exactly how four capabilities on this project ended up built,
green and unreachable.

Prints two things that matter for a send decision and nothing that does not:
how many rows carry BOTH a sport and a title, and which schools they are at.
A row without a title is not sendable -- measured over 3,141 sends, titled rows
bounced 0.73% and untitled 3.86%, and the parse defect fixed in this file's
sibling showed a second reason: the crossed name->address pairs were untitled
too, so the same gate caught all 25 of them.
"""

from __future__ import annotations

import collections
import csv
import sys

import _shared  # noqa: F401
import archive
import pipeline_hs
import registry_hs
from associations.ghsa import RosterEntry

OUT = "out/wave_report.csv"


def load_roster(path="data/ga_roster.csv") -> list:
    rows = []
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            rows.append(RosterEntry(
                school_id=row["school_id"], name=row["name"],
                codes=[c for c in (row["codes"] or "").split("|") if c],
                sports=[s for s in (row["sports"] or "").split("|") if s],
                is_head=(row["is_head"] == "True")))
    return rows


def main(argv) -> int:
    schools = registry_hs.load("data/ga_schools.csv")
    roster = load_roster()

    arch = archive.Archive("data/hs_archive.sqlite")
    records = pipeline_hs.extract(arch, schools, roster)
    arch.conn.close()

    sendable = [r for r in records if r.sport and r.title]
    print("archive parses to %d records; %d carry a sport; %d carry BOTH a "
          "sport and a title" % (len(records),
                                 sum(1 for r in records if r.sport),
                                 len(sendable)))
    print()

    by_sport = collections.Counter(r.sport for r in sendable)
    print("sendable by sport:")
    for sport, n in by_sport.most_common():
        print("   %-12s %4d" % (sport, n))

    print()
    print("sendable by school:")
    by_school = collections.Counter(r.school for r in sendable)
    for school, n in by_school.most_common():
        sports = sorted({r.sport for r in sendable if r.school == school})
        print("   %-34s %3d   %s" % (school[:34], n, ", ".join(sports)))

    with open(OUT, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(["name", "title", "email", "school", "sport",
                         "phone", "proof_url"])
        for r in sorted(sendable, key=lambda r: (r.sport, r.school or "",
                                                 r.name or "")):
            writer.writerow([r.name, r.title, r.email, r.school, r.sport,
                             r.phone, r.proof_url])
    print()
    print("wrote %s (%d rows)" % (OUT, len(sendable)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
