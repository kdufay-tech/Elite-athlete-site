"""WMT Digital staff directories.

Dominant on D1. Large athletics departments largely left Sidearm for custom
WMT builds, so a probe of D2/D3/NAIA sites -- all Sidearm -- is misleading
about D1: Auburn alone yields 455 staff rows across 53 departments here.

The markup nests rows inside their department, which is the cleanest of the
three platforms -- no id lookup and no document-order walking, just containment:

    <div class="staff-directory-table-department">
      <div class="staff-directory-table-department__title">Football</div>
      <tr class="staff-directory-table-member-position">
        <td class="...__name">     <td class="...__position">
        <td class="...__email">    <td class="...__phone">

Emails are plain `mailto:` links rather than split across JS variables, so no
de-obfuscation is needed here.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from .base import Adapter, CoachRecord, emails_in, PHONE

DEPARTMENT = "staff-directory-table-department"
DEPT_TITLE = "staff-directory-table-department__title"
MEMBER = "staff-directory-table-member-position"
CELL = "staff-directory-table-member-position__%s"


class WmtAdapter(Adapter):
    name = "wmt"

    def detect(self, html: str) -> bool:
        return MEMBER in html or DEPT_TITLE in html

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        soup = BeautifulSoup(html, "lxml")
        seed = self._seed(ctx)
        records: list[CoachRecord] = []
        seen_rows = set()

        for dept in soup.select("." + DEPARTMENT):
            title_el = dept.select_one("." + DEPT_TITLE)
            category = title_el.get_text(" ", strip=True) if title_el else ""
            for row in dept.select("." + MEMBER):
                seen_rows.add(id(row))
                rec = self._parse_row(row, category, seed)
                if rec is not None:
                    records.append(rec)

        # Rows outside any department container still carry contact details;
        # keep them with an empty category rather than dropping them silently.
        for row in soup.select("." + MEMBER):
            if id(row) not in seen_rows:
                rec = self._parse_row(row, "", seed)
                if rec is not None:
                    records.append(rec)

        return records

    def _parse_row(self, row, category: str, seed: dict) -> CoachRecord | None:
        name = self._cell(row, "name")
        title = self._cell(row, "position")

        email_cell = row.select_one("." + CELL % "email")
        emails = emails_in(str(email_cell)) if email_cell else emails_in(str(row))

        phone_cell = row.select_one("." + CELL % "phone")
        phone_match = PHONE.search(str(phone_cell) if phone_cell else str(row))

        if not name and not emails:
            return None

        return CoachRecord(
            name=name,
            title=title,
            category=category,
            email=emails[0] if emails else "",
            phone=phone_match.group(1) if phone_match else "",
            platform=self.name,
            **seed,
        )

    @staticmethod
    def _cell(row, token: str) -> str:
        el = row.select_one("." + CELL % token)
        return el.get_text(" ", strip=True) if el else ""
