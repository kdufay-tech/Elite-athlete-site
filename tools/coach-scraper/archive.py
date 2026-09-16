"""Local SQLite archive of fetched pages.

The reason this exists: parsing 1,900 schools correctly takes several
iterations, and if fetching and parsing were fused, every parser fix would cost
another full crawl -- another 1,900 requests against schools that did nothing
wrong. Archiving the bytes once means iteration two onward is offline, instant,
and free.

It also gives each exported row real provenance: the exact HTML and timestamp
the email was taken from. That is what makes validated=true mean something,
as opposed to a CSV that simply claims to be verified.

HTML is zlib-compressed; athletics staff pages run 500-800 KB each and
compress roughly 10:1, keeping a full crawl near 150 MB instead of 1.5 GB.
"""

from __future__ import annotations

import sqlite3
import threading
import zlib
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS pages (
    school_id   TEXT NOT NULL,
    kind        TEXT NOT NULL,           -- 'staff' | 'contact'
    url         TEXT NOT NULL,
    final_url   TEXT,
    status      INTEGER,
    html_z      BLOB,                    -- zlib-compressed utf-8
    platform    TEXT,
    error       TEXT,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (school_id, kind)
);

CREATE TABLE IF NOT EXISTS crawl_status (
    school_id   TEXT PRIMARY KEY,
    state       TEXT NOT NULL,           -- 'ok' | 'failed' | 'no-directory' | 'disallowed'
    attempts    INTEGER NOT NULL DEFAULT 0,
    last_error  TEXT,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pages_platform ON pages(platform);
CREATE INDEX IF NOT EXISTS idx_status_state   ON crawl_status(state);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Archive:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # check_same_thread=False plus an explicit lock: the crawl runs its
        # fetches across a thread pool, but every write still goes through one
        # serialized path, which is what sqlite actually requires.
        self.conn = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
        self._lock = threading.Lock()
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        # WAL lets a parse run read while a crawl run is still writing.
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.commit()

    # ---- writes ---------------------------------------------------------
    def store_page(self, school_id, kind, url, final_url, status,
                   html, platform=None, error=None) -> None:
        blob = zlib.compress(html.encode("utf-8", "replace"), 6) if html else None
        with self._lock:
            self._store_page(school_id, kind, url, final_url, status, blob, platform, error)

    def _store_page(self, school_id, kind, url, final_url, status, blob, platform, error):
        self.conn.execute(
            """INSERT INTO pages
                 (school_id, kind, url, final_url, status, html_z, platform, error, fetched_at)
               VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(school_id, kind) DO UPDATE SET
                 url=excluded.url, final_url=excluded.final_url, status=excluded.status,
                 html_z=excluded.html_z, platform=excluded.platform,
                 error=excluded.error, fetched_at=excluded.fetched_at""",
            (school_id, kind, url, final_url, status, blob, platform, error, _now()),
        )
        self.conn.commit()

    def set_status(self, school_id, state, error=None) -> None:
        with self._lock:
            self._set_status(school_id, state, error)

    def _set_status(self, school_id, state, error=None) -> None:
        self.conn.execute(
            """INSERT INTO crawl_status (school_id, state, attempts, last_error, updated_at)
               VALUES (?,?,1,?,?)
               ON CONFLICT(school_id) DO UPDATE SET
                 state=excluded.state,
                 attempts=crawl_status.attempts+1,
                 last_error=excluded.last_error,
                 updated_at=excluded.updated_at""",
            (school_id, state, error, _now()),
        )
        self.conn.commit()

    # ---- reads ----------------------------------------------------------
    def get_page(self, school_id, kind="staff") -> dict | None:
        row = self.conn.execute(
            "SELECT * FROM pages WHERE school_id=? AND kind=?", (school_id, kind)
        ).fetchone()
        if row is None:
            return None
        data = dict(row)
        data["html"] = zlib.decompress(row["html_z"]).decode("utf-8") if row["html_z"] else None
        return data

    def iter_pages(self, kind="staff"):
        cur = self.conn.execute(
            "SELECT * FROM pages WHERE kind=? AND html_z IS NOT NULL ORDER BY school_id",
            (kind,),
        )
        for row in cur:
            data = dict(row)
            data["html"] = zlib.decompress(row["html_z"]).decode("utf-8")
            yield data

    def completed(self) -> set[str]:
        """School ids that need no further crawling, for resume."""
        cur = self.conn.execute(
            "SELECT school_id FROM crawl_status WHERE state IN ('ok','disallowed','no-directory')"
        )
        return {r["school_id"] for r in cur}

    def stats(self) -> dict:
        rows = self.conn.execute(
            "SELECT state, COUNT(*) n FROM crawl_status GROUP BY state"
        ).fetchall()
        by_state = {r["state"]: r["n"] for r in rows}
        plat = self.conn.execute(
            "SELECT platform, COUNT(*) n FROM pages WHERE kind='staff' GROUP BY platform"
        ).fetchall()
        by_state["_platforms"] = {r["platform"] or "unknown": r["n"] for r in plat}
        return by_state

    def close(self) -> None:
        self.conn.close()
