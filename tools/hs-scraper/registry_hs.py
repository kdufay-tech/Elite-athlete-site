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
    "is_public", "district", "district_domain", "site_url", "email_domain",
    "staff_url", "nces_id", "enrollment",
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
    email_domain: str = ""        # observed domain of the school's published address
    staff_url: str = ""
    nces_id: str = ""
    enrollment: int = 0

    @property
    def mail_domain(self) -> str:
        """The domain this school's coach addresses are expected to be on.

        Measured, not inferred: district_domain is assigned from the school's
        own published site in Task 3, so a public school and a private one are
        resolved the same way. is_public no longer steers this -- a public
        school whose district was never resolved must still fall back to its
        own host rather than report nothing.
        """
        return self.district_domain or _host(self.site_url)


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
                email_domain=row.get("email_domain", ""),
                staff_url=row.get("staff_url", ""),
                nces_id=row.get("nces_id", ""),
                enrollment=int(row.get("enrollment") or 0),
            ))
    return out


def _is_blank(value) -> bool:
    """Is this field unset, for merge purposes?

    A bool is NEVER unset -- False is a real answer. Without this check,
    `value in ("", 0, None)` treats is_public=False as blank, because in
    Python False == 0. That would let a later pass silently flip a private
    school to public, and an explicit False would never propagate.

    An int 0 IS blank: enrollment=0 means "not known yet".
    """
    if isinstance(value, bool):
        return False
    return value in ("", 0, None)


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
        # NOTE: is_public is first-write-wins. _is_blank() treats no bool as blank,
        # so once a row exists its is_public cannot be corrected here -- not even
        # from the dataclass default True. Set it correctly at CONSTRUCTION (as the
        # GHSA parser does, reading public/private from the classification column);
        # do not expect a later merge to fix it.
        for f in fields(HSSchool):
            nv = getattr(new, f.name)
            if _is_blank(nv):
                continue
            if _is_blank(getattr(cur, f.name)):
                setattr(cur, f.name, nv)
    return list(by_id.values())
