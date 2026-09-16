"""Stage 1: fetch staff directories into the archive.

Tries each candidate staff-directory path in turn and keeps the first response
that an adapter actually recognises -- a 200 is not enough, because most
athletics sites serve a styled 404 page with status 200.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor

import address
import config
from adapters import detect_platform, adapter_for
from archive import Archive
from net import Fetcher
from registry import School

log = logging.getLogger(__name__)


KNOWN_PLATFORMS = ("sidearm", "wmt", "presto")


def looks_like_directory(html: str) -> bool:
    """Reject soft-404s and empty shells before archiving them.

    A 200 is not evidence: most athletics sites serve a styled "page not
    found" with status 200, so a staff path that does not exist still looks
    successful to requests. Recognition by an adapter is the real test.
    """
    if not html or len(html) < 2000:
        return False
    if adapter_for(html).name in KNOWN_PLATFORMS:
        return True
    # For unrecognised platforms, demand at least a few plausible addresses.
    from adapters.base import emails_in
    return len(emails_in(html)) >= 3


def crawl_school(school: School, fetcher: Fetcher, arc: Archive,
                 want_contact: bool = True) -> str:
    """Fetch one school. Returns its crawl state."""
    last_error = None
    for url in school.staff_urls():
        result = fetcher.get(url)
        if result.error == "robots-disallowed":
            arc.set_status(school.school_id, "disallowed", result.error)
            return "disallowed"
        if not result.ok:
            last_error = result.error or f"HTTP {result.status}"
            continue
        if not looks_like_directory(result.html):
            last_error = "no-directory-content"
            continue

        platform = detect_platform(result.html)
        arc.store_page(school.school_id, "staff", url, result.final_url,
                       result.status, result.html, platform)

        # Only go looking for a contact page when the staff page did not
        # already carry an address. Measured over a real run, the footer of
        # the staff page yields one ~60% of the time while the contact-page
        # guesses succeed ~12%, so fetching it unconditionally spends roughly
        # 450 requests per full crawl to gain almost nothing.
        if want_contact and not address.extract(result.html)["address_line"]:
            _fetch_contact(school, fetcher, arc)

        arc.set_status(school.school_id, "ok")
        log.info("ok   %-34s %s", school.school, platform)
        return "ok"

    state = "no-directory" if last_error == "no-directory-content" else "failed"
    arc.set_status(school.school_id, state, last_error)
    log.warning("%-4s %-34s %s", state, school.school, last_error)
    return state


def _fetch_contact(school: School, fetcher: Fetcher, arc: Archive) -> None:
    """Best-effort second request for the mailing address. Never fatal."""
    for url in school.contact_urls():
        result = fetcher.get(url)
        if result.ok and len(result.html) > 1000:
            arc.store_page(school.school_id, "contact", url,
                           result.final_url, result.status, result.html)
            return


def crawl_all(schools: list[School], arc: Archive, resume: bool = True,
              want_contact: bool = True, limit: int | None = None,
              workers: int | None = None) -> dict:
    """Crawl every school, concurrently across hosts.

    Concurrency here is across DIFFERENT schools only -- the 1 req/sec limit in
    net.RateLimiter is keyed by host, so no individual site is hit any faster
    than it would be sequentially. What the pool removes is 1,900 unrelated
    schools queueing behind each other, which is the difference between a
    ~40-minute run and an ~8-hour one.
    """
    fetcher = Fetcher()
    done = arc.completed() if resume else set()
    todo = [s for s in schools if s.school_id not in done]
    if limit:
        todo = todo[:limit]

    workers = workers or config.MAX_WORKERS
    log.info("crawling %d schools across %d workers (%d already complete)",
             len(todo), workers, len(done))

    tally: dict[str, int] = {}
    tally_lock = threading.Lock()
    completed = 0

    def run(school: School) -> None:
        nonlocal completed
        try:
            state = crawl_school(school, fetcher, arc, want_contact)
        except Exception as exc:            # a crash on one school must never
            log.warning("crawl error %s: %s", school.school, exc)
            arc.set_status(school.school_id, "failed", str(exc)[:300])
            state = "failed"                # take down the rest of the run
        with tally_lock:
            tally[state] = tally.get(state, 0) + 1
            completed += 1
            if completed % 25 == 0:
                log.info("  ... %d/%d  %s", completed, len(todo), tally)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(run, todo))
    return tally
