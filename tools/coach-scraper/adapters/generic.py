"""Last-resort adapter for sites on no recognised platform.

Deliberately conservative. It only emits a row when an email sits close to
something that looks like a person's name, because the alternative -- emitting
every address on the page -- floods the export with webmaster@ and info@
addresses that are worse than no row at all. Lower recall here is the correct
trade: a missing coach can be collected later, a wrong one gets emailed.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup

from .base import Adapter, CoachRecord, emails_in, PHONE

# Two-to-four capitalised words, allowing the punctuation real names carry.
NAME_RE = re.compile(r"^[A-Z][A-Za-z'\-\.]+(?:\s+[A-Z][A-Za-z'\-\.]+){1,3}$")

# Addresses that are never an individual coach.
ROLE_LOCALPARTS = {
    "info", "webmaster", "admin", "athletics", "tickets", "boxoffice",
    "media", "sid", "compliance", "support", "contact", "help", "office",
    "noreply", "no-reply", "marketing", "donate", "giving", "alumni",
}

COACH_WORDS = ("coach", "coordinator", "director", "trainer", "manager",
               "assistant", "associate", "instructor", "performance")


class GenericAdapter(Adapter):
    name = "generic"

    def detect(self, html: str) -> bool:
        return True  # always last in the chain

    def parse(self, html: str, ctx: dict) -> list[CoachRecord]:
        soup = BeautifulSoup(html, "lxml")
        seed = self._seed(ctx)
        out: dict[str, CoachRecord] = {}

        for node in soup.find_all(["tr", "li", "div", "article", "section", "p"]):
            fragment = str(node)
            if "@" not in fragment and "mailto" not in fragment:
                continue
            emails = emails_in(fragment)
            if len(emails) != 1:
                continue
            email = emails[0]
            if email.split("@")[0] in ROLE_LOCALPARTS:
                continue

            lines = [t.strip() for t in node.stripped_strings if t.strip()]
            name = next((l for l in lines if NAME_RE.match(l) and "@" not in l), "")
            if not name:
                continue
            title = next(
                (l for l in lines
                 if l != name and any(w in l.lower() for w in COACH_WORDS)), ""
            )
            phone = PHONE.search(fragment)

            candidate = CoachRecord(
                name=name, title=title, category="",
                email=email, phone=phone.group(1) if phone else "",
                platform=self.name, **seed,
            )
            prior = out.get(email)
            if prior is None or len(candidate.title) > len(prior.title):
                out[email] = candidate
        return list(out.values())
