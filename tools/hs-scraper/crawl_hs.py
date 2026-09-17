"""Drive the fetcher into the archive. Archive first, parse later, always.

Storing every page compressed means a parser change re-runs over the whole
corpus at zero network cost. On the college crawl that turned each adapter
revision from an hours-long re-fetch into a seconds-long re-parse, which is the
only reason iterating on parsers was affordable at all.
"""

from __future__ import annotations

import _shared  # noqa: F401
import archive
import discover_hs
import net


def crawl_school(fetcher: "net.Fetcher", arch: "archive.Archive",
                 school) -> str:
    """Fetch one school. Returns ok | no-directory | unreachable.

    Two start urls, tried in order, because roughly 43% of the association's
    published school urls do not answer: the school's own site first, then its
    published mail domain. ALPHARETTA's site school.fultonschools.org is dead
    while fultonschools.org returns 200, so the fallback costs one extra fetch
    only for schools that already failed.

    Archived under school_id, never under a domain. A shared district domain
    serves many schools, so a domain-keyed archive could not say which school
    a stored page belongs to.
    """
    starts = [u for u in (
        school.site_url,
        f"https://{school.email_domain}" if school.email_domain else "",
    ) if u]

    home = None
    for start in starts:
        resp = fetcher.get(start)
        if resp.ok and resp.html:
            home = resp
            break
    if home is None:
        arch.set_status(school.school_id, "unreachable",
                        error=f"no start url answered ({len(starts)} tried)")
        return "unreachable"

    arch.store_page(school.school_id, "home", home.final_url, home.final_url,
                    home.status, home.html, "", None)

    candidates = discover_hs.best_staff_links(home.html, home.final_url)
    candidates += [u for u in discover_hs.direct_candidates(home.final_url)
                   if u not in candidates]

    for url in candidates:
        page = fetcher.get(url)
        if not page.ok:
            continue
        if not discover_hs.looks_like_directory(page.html):
            continue
        arch.store_page(school.school_id, "staff", url, page.final_url,
                        page.status, page.html, "", None)
        arch.set_status(school.school_id, "ok")
        return "ok"

    arch.set_status(school.school_id, "no-directory")
    return "no-directory"
