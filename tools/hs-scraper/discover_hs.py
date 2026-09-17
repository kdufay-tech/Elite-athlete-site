"""Homepage -> staff directory, by scoring every link rather than taking the first.

The college crawler learned this the expensive way: taking the first plausible
link found the wrong page often enough to matter, and scoring every candidate
then adding a direct-path fallback lifted yield from 65% to 79%. The same shape
applies here with a school vocabulary instead of an athletics one.
"""

from __future__ import annotations

import html as _html
import re
from urllib.parse import urljoin, urlparse

import _shared  # noqa: F401
import config_hs
from adapters.base import emails_in

_ANCHOR = re.compile(r'<a\s[^>]*href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', re.S | re.I)
_TAGS = re.compile(r"<[^>]+>")
_NOT_FOUND = re.compile(
    r"\b(page not found|404|no longer available|doesn'?t exist|cannot be found)\b", re.I
)


def _text(fragment: str) -> str:
    return _html.unescape(_TAGS.sub(" ", fragment)).replace("\xa0", " ").strip()


def score_link(text: str, href: str) -> int:
    """Higher means more likely to be a page listing people with addresses."""
    hay = f"{text} {href}".lower()
    score = 0
    for word, weight in config_hs.STAFF_LINK_WORDS:
        if word in hay:
            score += weight
    # A link whose text is exactly the phrase beats one that merely contains it.
    if text.strip().lower() in ("staff directory", "coaching staff", "coaches"):
        score += 4
    return score


# Social, video and vendor hosts. A link whose text reads "Athletics" but points
# at Facebook scores exactly as high as a real one; following it wastes a fetch
# at best and archives a login wall at worst.
OFFSITE_BLOCKED = frozenset({
    "facebook.com", "twitter.com", "x.com", "instagram.com", "youtube.com",
    "youtu.be", "tiktok.com", "linkedin.com", "pinterest.com", "flickr.com",
    "vimeo.com", "google.com", "apple.com", "maxpreps.com", "hudl.com",
    "eventlink.com", "gofan.co", "rankone.com", "8to18.com",
})


def _reg_host(url: str) -> str:
    host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) > 1 else host


def best_staff_links(html: str, base_url: str, limit: int = 5) -> list[str]:
    """Score every link, keep the best few. ONE off-domain hop is allowed.

    Off-domain is permitted because several schools publish athletics on their
    own separate domain (nmhsathletics.com, chsspartansathletics.com) linked
    from the school site -- a same-origin-only crawl scores zero on exactly the
    schools that publish the most coach data.

    It is guarded rather than free: a social or vendor host never qualifies no
    matter how well its link text scores, and an off-domain link must clear a
    higher bar than a same-origin one, because leaving the school's own site is
    a weaker signal that the page belongs to the school.
    """
    home = _reg_host(base_url)
    scored: list[tuple[int, str]] = []
    seen: set[str] = set()
    for href, frag in _ANCHOR.findall(html or ""):
        if href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        url = urljoin(base_url, href)
        if url in seen:
            continue
        seen.add(url)
        s = score_link(_text(frag), href)
        if s <= 0:
            continue
        host = _reg_host(url)
        if host != home:
            if not host or host in OFFSITE_BLOCKED:
                continue
            if s < 5:
                continue
        scored.append((s, url))
    scored.sort(key=lambda t: -t[0])
    return [u for _, u in scored[:limit]]


def direct_candidates(base_url: str) -> list[str]:
    base = base_url.rstrip("/")
    return [base + p for p in config_hs.STAFF_PATHS]


def looks_like_directory(html: str) -> bool:
    """A page is a directory only if it actually lists people.

    HTTP 200 is not a page. Styled 404s return 200 with a friendly message and
    parse into garbage, so the test is content-based: enough distinct addresses
    to be a listing, and no not-found language.
    """
    if not html:
        return False
    if _NOT_FOUND.search(html[:4000]):
        return False
    return len(set(emails_in(html))) >= config_hs.MIN_EMAILS_FOR_DIRECTORY
