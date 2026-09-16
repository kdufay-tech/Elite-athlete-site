"""The school registry: one row per high school, built up over three stages.

Deliberately NOT reusing registry.School from the college package. That record
carries division/conference and assumes one domain per school; a public high
school's coaches live on a DISTRICT domain shared with a dozen other schools,
which is the single most important structural fact in this crawl.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, asdict, fields
from pathlib import Path

import _shared  # noqa: F401
from registry import slugify  # college package -- same slug rules, one definition

DATA_DIR = Path(__file__).parent / "data"
FIELDS = [
    "school_id", "school", "state", "city", "classification",
    "is_public", "district", "district_domain", "site_url", "staff_url",
    "nces_id", "enrollment",
]


@dataclass
class HSSchool:
    school_id: str = ""
    school: str = ""
    state: str = ""
    city: str = ""
    classification: str = ""      # association class, e.g. "7A", "AAA"
    is_public: bool = True
    district: str = ""
    district_domain: str = ""     # where public coaches' mail actually lives
    site_url: str = ""
    staff_url: str = ""
    nces_id: str = ""
    enrollment: int = 0

    @property
    def mail_domain(self) -> str:
        """The domain this school's coach addresses are expected to be on."""
        return self.district_domain if self.is_public else _host(self.site_url)


def _host(url: str) -> str:
    u = (url or "").split("//")[-1]
    return u.split("/")[0].lower().removeprefix("www.")


def make_id(state: str, school: str) -> str:
    return f"{state.lower()}-{slugify(school)}"


def save(rows: list[HSSchool], path: Path | str) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow(asdict(r))


def load(path: Path | str) -> list[HSSchool]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out.append(HSSchool(
                school_id=row.get("school_id", ""),
                school=row.get("school", ""),
                state=row.get("state", ""),
                city=row.get("city", ""),
                classification=row.get("classification", ""),
                is_public=str(row.get("is_public", "True")).strip().lower()
                          in ("true", "1", "yes"),
                district=row.get("district", ""),
                district_domain=row.get("district_domain", ""),
                site_url=row.get("site_url", ""),
                staff_url=row.get("staff_url", ""),
                nces_id=row.get("nces_id", ""),
                enrollment=int(row.get("enrollment") or 0),
            ))
    return out


def merge(existing: list[HSSchool], incoming: list[HSSchool]) -> list[HSSchool]:
    """Fill blanks from `incoming`; never blank a field that is already set.

    Same rule the coach_contacts importer follows: a later pass may add what an
    earlier one lacked, but may not erase it.
    """
    by_id = {r.school_id: r for r in existing}
    for new in incoming:
        cur = by_id.get(new.school_id)
        if cur is None:
            by_id[new.school_id] = new
            continue
        for f in fields(HSSchool):
            nv = getattr(new, f.name)
            if nv in ("", 0, None):
                continue
            if getattr(cur, f.name) in ("", 0, None):
                setattr(cur, f.name, nv)
    return list(by_id.values())
