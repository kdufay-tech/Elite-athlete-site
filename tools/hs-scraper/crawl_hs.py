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


# Cap per school, so a malformed roster cannot walk a server indefinitely.
MAX_LOOKUPS_PER_SCHOOL = 120


def lookup_roster(fetcher, arch, school_id: str, base_url: str, adapter,
                  surnames) -> int:
    """Fetch one directory query per coach surname. Returns pages stored.

    NOT pagination, and deliberately so. Walking ?const_page=N does not work on
    this CMS: every page number, and the bare url too, returns whatever the
    edge cache last stored, and adding a cache-busting parameter makes the page
    return nothing at all. Worse, probing the cursor CHANGES what the bare url
    serves, so "page one" is whatever the last request left behind.

    Targeted lookup is the better tool regardless. Finding a school's 35 coaches
    by pagination means fetching twenty pages covering two thousand staff;
    by surname it is 35 requests returning exactly those 35 people. Pagination
    is what you reach for when you do not know who you are looking for, and the
    association named all 8,201 of them.

    Each result is archived under its own kind so the upsert key
    (school_id, kind) keeps them apart rather than overwriting.
    """
    stored = 0
    for surname in sorted(set(surnames))[:MAX_LOOKUPS_PER_SCHOOL]:
        if not surname:
            continue
        url = adapter_search_url(base_url, surname)
        resp = fetcher.get(url)
        if not resp.ok or not resp.html:
            continue
        if not adapter.parse(resp.html, {}):
            continue                  # nobody by that name here; store nothing
        key = "".join(c for c in surname.lower() if c.isalnum())[:24]
        arch.store_page(school_id, f"staff:q:{key}", url, resp.final_url,
                        resp.status, resp.html, adapter.name, None)
        stored += 1
    return stored


def adapter_search_url(base_url: str, surname: str) -> str:
    import adapters_hs.finalsite as _fs
    return _fs.search_url(base_url, surname)


# How many distinct directory pages to keep per school. A school's coaches are
# spread across an athletics index, a staff listing and sport-specific pages;
# stopping at the first hit takes whichever the link scorer happened to rank
# highest and discards the rest.
MAX_STAFF_PAGES_PER_SCHOOL = 6


def crawl_school_deep(fetcher, arch, school, roster_names=None) -> str:
    """Like crawl_school, but keeps EVERY candidate that is a directory.

    crawl_school returns on the first page that passes looks_like_directory().
    That was the right shape for proving the pipeline works and the wrong one
    for coverage: measured against 1,163 proven addresses, 74% sat at schools
    we had archived and we were still extracting only 17% of them, because one
    page is rarely the whole staff.

    Deduplicates on the SET OF ADDRESSES, not the url. The same listing is
    routinely reachable at /athletics/staff-directory and /staff-directory, and
    storing it twice inflates nothing but the page count -- while an unrelated
    second page with genuinely different people is exactly what we are here for.

    `roster_names` is ACCEPTED AND IGNORED. It fed a gate that rejected any page
    naming nobody from the school's crawl unit, on the reasoning that Milton's
    dead site fell back to fultonschools.org and archived the district directory
    -- 107 real addresses, not one a Milton employee.

    Measured, that gate made recall WORSE: 16.7% -> 12.3%, matched 194 -> 143.
    The reason is a population mismatch. manifest.build() filters roster entries
    to those carrying one of the five target sports, so unit.targets is not
    "everyone the association lists" but "coaches in our sports". Recall is
    measured against BookYourData, whose addresses include coaches the
    association coded with no sport, or never listed. Gating on one population
    while scoring against another discarded pages full of genuine matches.

    Kept as a parameter so callers need not change, and documented here so the
    idea is not re-derived and re-shipped: it is a reasonable-sounding filter
    that costs real coaches. If a page-relevance test is wanted, it has to be
    built against the population being scored, not this one.

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

    import adapters_hs

    kept = 0
    seen_sets: list[set] = []
    for url in candidates:
        if kept >= MAX_STAFF_PAGES_PER_SCHOOL:
            break
        page = fetcher.get(url)
        if not page.ok or not page.html:
            continue
        if not discover_hs.looks_like_directory(page.html):
            continue

        parsed = adapters_hs.adapter_for(page.html).parse(page.html, {})
        addrs = {r.email for r in parsed if r.email}
        if any(addrs and addrs <= prev for prev in seen_sets):
            continue                  # same listing by another path
        seen_sets.append(addrs)
        kind = "staff" if kept == 0 else f"staff:p{kept + 1}"
        arch.store_page(school.school_id, kind, url, page.final_url,
                        page.status, page.html, "", None)
        kept += 1

    arch.set_status(school.school_id, "ok" if kept else "no-directory")
    return "ok" if kept else "no-directory"
