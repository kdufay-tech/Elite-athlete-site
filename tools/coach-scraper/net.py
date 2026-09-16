"""Polite, resilient HTTP layer.

Three problems are solved here so no other module has to think about them:

1. TLS interception. On this machine every HTTPS request fails certificate
   validation because a local security product re-signs traffic with a root CA
   that is in the Windows certificate store but not in certifi's bundle, which
   is what requests uses by default. Routing through ssl.create_default_context()
   picks up the OS store and the same requests succeed. Without this the whole
   crawler silently collects zero rows.

2. Politeness. One request per second per host, robots.txt honored, honest
   User-Agent. Per-HOST rather than global, so 1,900 different schools are not
   serialised behind each other.

3. Transient failure. Retries with exponential backoff on 429/5xx, honoring
   Retry-After when the server sends it.
"""

from __future__ import annotations

import logging
import ssl
import threading
import time
import urllib.robotparser
from dataclasses import dataclass
from urllib.parse import urlparse

import requests
from requests.adapters import HTTPAdapter

import config

log = logging.getLogger(__name__)

# Failures that a retry cannot fix. Matched on the exception chain's text
# because urllib3 wraps the underlying cause in a generic ConnectionError,
# so the exception type alone does not distinguish "host does not exist"
# from "host was briefly unreachable".
_PERMANENT_SIGNS = (
    "NameResolutionError",
    "getaddrinfo failed",
    "nodename nor servname",
    "Name or service not known",
    "CertificateError",
    "certificate verify failed",
    "UnicodeError",
)


def _is_permanent(exc: Exception) -> bool:
    text = f"{type(exc).__name__}: {exc}"
    return any(sign in text for sign in _PERMANENT_SIGNS)


class SystemTrustAdapter(HTTPAdapter):
    """Validate TLS against the OS trust store instead of certifi's bundle."""

    def init_poolmanager(self, *args, **kwargs):
        kwargs["ssl_context"] = ssl.create_default_context()
        return super().init_poolmanager(*args, **kwargs)

    def proxy_manager_for(self, *args, **kwargs):
        kwargs["ssl_context"] = ssl.create_default_context()
        return super().proxy_manager_for(*args, **kwargs)


class RateLimiter:
    """Enforce a minimum interval between requests to the same host."""

    def __init__(self, delay: float):
        self._delay = delay
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, host: str) -> None:
        with self._lock:
            now = time.monotonic()
            earliest = self._last.get(host, 0.0) + self._delay
            sleep_for = earliest - now
            # Reserve the slot before releasing the lock so concurrent callers
            # for the same host queue up instead of all sleeping the same delay.
            self._last[host] = max(now, earliest)
        if sleep_for > 0:
            time.sleep(sleep_for)


class RobotsCache:
    """One robots.txt fetch per host, cached for the life of the process.

    Fails OPEN: if robots.txt cannot be fetched we allow the request. A site
    that returns 500 for robots.txt has not expressed a preference, and treating
    that as a blanket ban would silently drop schools from the dataset.
    """

    def __init__(self, fetcher: "Fetcher"):
        # Holds the Fetcher rather than a Session so each thread's robots.txt
        # request goes through that thread's own session.
        self._fetcher = fetcher
        self._cache: dict[str, urllib.robotparser.RobotFileParser | None] = {}
        self._lock = threading.Lock()

    def allows(self, url: str) -> bool:
        if not config.RESPECT_ROBOTS:
            return True
        parts = urlparse(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        with self._lock:
            if origin not in self._cache:
                self._cache[origin] = self._load(origin)
            parser = self._cache[origin]
        if parser is None:
            return True
        return parser.can_fetch(config.USER_AGENT, url)

    def _load(self, origin: str):
        parser = urllib.robotparser.RobotFileParser()
        try:
            resp = self._fetcher.session.get(
                f"{origin}/robots.txt",
                timeout=config.REQUEST_TIMEOUT,
                headers={"User-Agent": config.USER_AGENT},
            )
            if resp.status_code >= 400:
                return None
            parser.parse(resp.text.splitlines())
            return parser
        except requests.RequestException:
            return None


@dataclass
class Fetched:
    """Outcome of one fetch. `ok` means we have HTML worth parsing."""

    url: str
    final_url: str
    status: int | None
    html: str | None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == 200 and bool(self.html)


class Fetcher:
    """The only thing in this project that touches the network.

    One Session per thread. requests.Session is not documented as thread-safe,
    and the crawl runs 12 workers against it -- sharing one invites rare,
    maddening failures (crossed responses, connection-pool races) that surface
    as a handful of inexplicably empty pages in an otherwise fine run. A
    Session per thread costs a few connection pools and removes the question.

    The rate limiter and robots cache ARE shared and explicitly locked, because
    those must see every thread's activity to do their job at all.
    """

    def __init__(self, delay: float | None = None):
        self._local = threading.local()
        self.limiter = RateLimiter(config.DELAY_PER_DOMAIN if delay is None else delay)
        self.robots = RobotsCache(self)

    @property
    def session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            adapter = SystemTrustAdapter(pool_connections=8, pool_maxsize=8)
            session.mount("https://", adapter)
            session.mount("http://", adapter)
            session.headers.update({
                "User-Agent": config.USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            })
            self._local.session = session
        return session

    def get(self, url: str) -> Fetched:
        host = urlparse(url).netloc

        if not self.robots.allows(url):
            log.info("robots.txt disallows %s", url)
            return Fetched(url, url, None, None, error="robots-disallowed")

        last_error = None
        for attempt in range(config.MAX_RETRIES):
            self.limiter.wait(host)
            try:
                resp = self.session.get(
                    url, timeout=config.REQUEST_TIMEOUT, allow_redirects=True
                )
            except requests.RequestException as exc:
                last_error = f"{type(exc).__name__}: {exc}"
                # A domain that does not resolve will not resolve on the next
                # attempt either. Retrying permanent failures turned a registry
                # with ~30 dead domains into a 50-minute run, almost all of it
                # spent waiting on DNS that had already given a final answer.
                if _is_permanent(exc):
                    return Fetched(url, url, None, None, error=last_error)
                self._backoff(attempt)
                continue

            if resp.status_code in (429, 500, 502, 503, 504):
                last_error = f"HTTP {resp.status_code}"
                self._backoff(attempt, resp.headers.get("Retry-After"))
                continue

            return Fetched(url, resp.url, resp.status_code, resp.text)

        return Fetched(url, url, None, None, error=last_error or "unknown")

    @staticmethod
    def _backoff(attempt: int, retry_after: str | None = None) -> None:
        if retry_after:
            try:
                time.sleep(min(float(retry_after), 60.0))
                return
            except ValueError:
                pass
        time.sleep(config.BACKOFF_BASE * (2 ** attempt))
