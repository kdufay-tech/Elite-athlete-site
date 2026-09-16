"""The list of schools to crawl.

A school needs four things to be crawlable: an id, a display name, a division,
and an athletics domain. The domain is the hard part -- there is no public
machine-readable mapping from "Grand Valley State" to "gvsulakers.com", because
athletics sites use team-brand domains rather than institutional ones.

The registry is therefore a plain CSV you can extend by hand or by import, and
`main.py verify-registry` tells you which rows actually resolve, so the list
stays honest about its own coverage instead of asserting it.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

import config

DATA_DIR = Path(__file__).parent / "data"
REGISTRY_CSV = DATA_DIR / "schools.csv"
FIELDS = ["school_id", "school", "division", "state", "conference", "athletics_url"]


@dataclass
class School:
    school_id: str
    school: str
    division: str
    state: str = ""
    conference: str = ""
    athletics_url: str = ""

    def staff_urls(self) -> list[str]:
        """Candidate staff-directory URLs, most likely first."""
        base = self.athletics_url.rstrip("/")
        return [base + path for path in config.STAFF_PATHS]

    def contact_urls(self) -> list[str]:
        base = self.athletics_url.rstrip("/")
        return [base + path for path in config.CONTACT_PATHS]


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load(path: Path | str = REGISTRY_CSV) -> list[School]:
    path = Path(path)
    if not path.exists():
        return []
    out = []
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            url = (row.get("athletics_url") or "").strip()
            if not url:
                continue
            if not url.startswith("http"):
                url = "https://" + url
            out.append(School(
                school_id=(row.get("school_id") or slugify(row.get("school", ""))).strip(),
                school=(row.get("school") or "").strip(),
                division=(row.get("division") or "").strip().upper(),
                state=(row.get("state") or "").strip().upper(),
                conference=(row.get("conference") or "").strip(),
                athletics_url=url,
            ))
    return out


def save(schools: list[School], path: Path | str = REGISTRY_CSV) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        for s in schools:
            writer.writerow({f: getattr(s, f) for f in FIELDS})


def merge(existing: list[School], incoming: list[School]) -> list[School]:
    """Union by athletics domain; existing rows win on conflict."""
    by_domain = {_domain(s.athletics_url): s for s in existing}
    for s in incoming:
        key = _domain(s.athletics_url)
        if key and key not in by_domain:
            by_domain[key] = s
    return sorted(by_domain.values(), key=lambda s: (s.division, s.school))


def _domain(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url or "").split("/")[0].lower()


def import_domains_from_csv(path: Path | str, division: str) -> list[School]:
    """Harvest athletics domains out of an arbitrary contact CSV.

    Written for the existing `College Conference coaches.csv`: its emails were
    formula-generated and unusable, but its school names and athletics domains
    are real, so the salvageable half is recovered rather than retyped.
    """
    path = Path(path)
    found: dict[str, School] = {}
    with path.open(newline="", encoding="utf-8-sig") as fh:
        for row in csv.reader(fh):
            cells = [c.strip() for c in row if c and c.strip()]
            if len(cells) < 2:
                continue
            school_name = cells[0]
            domain = ""
            for cell in cells:
                m = re.match(r"^(?:https?://)?([a-z0-9\-]+\.[a-z0-9\-.]+)/", cell.lower())
                if m and "@" not in cell:
                    domain = m.group(1)
                    break
            if not domain or school_name.lower() in {"school", "name"}:
                continue
            # Strip sport qualifiers the source appended, e.g. "Texas Volleyball".
            base_name = re.sub(
                r"\s+(volleyball|soccer|hockey|basketball|football)$", "",
                school_name, flags=re.I,
            )
            if domain in found:
                continue
            found[domain] = School(
                school_id=slugify(base_name),
                school=base_name,
                division=division,
                athletics_url="https://" + domain,
            )
    return list(found.values())
