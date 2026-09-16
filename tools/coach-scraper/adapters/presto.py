"""PrestoSports staff directories.

Common on D3 and smaller NAIA sites. Presto renders staff as repeated blocks
rather than one table, and does not obfuscate email, so extraction is simpler
than Sidearm -- the work is grouping rows under the right sport heading, which
here genuinely does require document order because Presto emits no linking id.
"""

from __future__ import annotations

from bs4 import BeautifulSoup

from .base import Adapter, CoachRecord, emails_in, PHONE

HEADING_TAGS = ("h2", "h3", "h4")


class PrestoAdapter(Adapter):
    name = "presto"

    def detect(self, html: str) -> bool:
        markers = ("prestosports", "presto-", "pstrk", "staff_directory_list")
        lowered = html.lower()
        return any(m in lowered for m in markers)

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        soup = BeautifulSoup(html, "lxml")
        seed = self._seed(ctx)
        records: list[CoachRecord] = []
        current_category = ""

        # Walk headings and staff blocks in document order, carrying the most
        # recent heading forward as the category for the rows beneath it.
        for node in soup.find_all(list(HEADING_TAGS) + ["tr", "li", "div"]):
            if node.name in HEADING_TAGS:
                text = node.get_text(" ", strip=True)
                if 0 < len(text) < 60:
                    current_category = text
                continue

            fragment = str(node)
            if "@" not in fragment and "mailto" not in fragment:
                continue
            emails = emails_in(fragment)
            if not emails:
                continue
            # Skip container elements that swept up many rows at once; we want
            # the tightest element holding exactly one person.
            if len(emails) > 1:
                continue

            text = node.get_text(" | ", strip=True)
            name, title = self._split_name_title(text)
            if not name:
                continue
            phone = PHONE.search(fragment)
            records.append(CoachRecord(
                name=name, title=title, category=current_category,
                email=emails[0], phone=phone.group(1) if phone else "",
                platform=self.name, **seed,
            ))
        return self._dedupe(records)

    @staticmethod
    def _split_name_title(text: str) -> tuple[str, str]:
        parts = [p.strip() for p in text.split("|") if p.strip()]
        parts = [p for p in parts if "@" not in p and not PHONE.fullmatch(p)]
        if not parts:
            return "", ""
        return parts[0], (parts[1] if len(parts) > 1 else "")

    @staticmethod
    def _dedupe(records: list[CoachRecord]) -> list[CoachRecord]:
        """Nested elements yield the same person more than once; keep the
        richest copy of each address."""
        best: dict[str, CoachRecord] = {}
        for r in records:
            prior = best.get(r.email)
            if prior is None or len(r.title) > len(prior.title):
                best[r.email] = r
        return list(best.values())
