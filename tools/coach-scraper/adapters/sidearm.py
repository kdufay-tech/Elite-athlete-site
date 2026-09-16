"""Sidearm Sports staff directories.

Sidearm powers the large majority of NCAA D1/D2/D3 and NAIA athletics sites,
so this adapter carries most of the dataset. The markup is a single table:

    <tr class="sidearm-staff-category" data-category-id="11">Men's Basketball</tr>
    <tr class="sidearm-staff-member"   data-category-id="11">
      <td headers="col-fullname ...">   <a aria-label="Name, Category, Title">Name</a>
      <td headers="col-staff_title ..."> Head Coach
      <td headers="col-staff_email ..."> <script>...firstHalf/secondHalf...</script>
      <td headers="col-staff_phone ..."> <a href="tel:...">

Members carry the same data-category-id as their heading, so sport attribution
is an exact id lookup rather than a walk over document order -- which matters
because a walk breaks silently the moment a site reorders or nests rows.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from .base import Adapter, CoachRecord, emails_in, PHONE


class SidearmAdapter(Adapter):
    name = "sidearm"

    def detect(self, html: str) -> bool:
        return "sidearm-staff-member" in html or "sidearm-staff-category" in html

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        soup = BeautifulSoup(html, "lxml")
        seed = self._seed(ctx)

        categories = {
            cat.get("data-category-id"): cat.get_text(" ", strip=True)
            for cat in soup.select(".sidearm-staff-category")
            if cat.get("data-category-id")
        }

        records: list[CoachRecord] = []
        for row in soup.select(".sidearm-staff-member"):
            rec = self._parse_row(row, categories, seed)
            if rec is not None:
                records.append(rec)
        return records

    def _parse_row(self, row, categories, seed) -> CoachRecord | None:
        name = self._cell_text(row, "col-fullname")
        title = self._cell_text(row, "col-staff_title")
        category = categories.get(row.get("data-category-id"), "")

        # aria-label is "Name, Category, Title" -- a useful fallback when the
        # category row is missing, which happens on single-sport sub-pages.
        if not category:
            link = row.select_one('[headers*="col-fullname"] a[aria-label]')
            if link:
                parts = [p.strip() for p in link["aria-label"].split(",")]
                if len(parts) >= 3:
                    category = parts[1]
                    title = title or parts[-1]

        email_cell = row.select_one('[headers*="col-staff_email"]')
        emails = emails_in(str(email_cell)) if email_cell else emails_in(str(row))

        phone_cell = row.select_one('[headers*="col-staff_phone"]')
        phone_src = str(phone_cell) if phone_cell else str(row)
        phone_match = PHONE.search(phone_src)

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
    def _cell_text(row, header_token: str) -> str:
        cell = row.select_one(f'[headers*="{header_token}"]')
        return cell.get_text(" ", strip=True) if cell else ""
