"""Tests for the high-school scraper. Run: python tests_hs.py

Dependency-free on purpose, matching tools/coach-scraper/tests.py -- it runs
anywhere the scraper runs. Every case here is a regression, not decoration.
"""

from __future__ import annotations

import sys
import traceback

import _shared  # noqa: F401  -- must import first; puts coach-scraper on sys.path
import registry_hs

FAILURES: list[str] = []


def check(label, got, want):
    if got != want:
        FAILURES.append(f"{label}\n  got:  {got!r}\n  want: {want!r}")


def test_registry_roundtrip(tmp):
    rows = [
        registry_hs.HSSchool(
            school_id="ga-marietta", school="Marietta", state="GA", city="Marietta",
            classification="7A", is_public=True, district="Marietta City",
            district_domain="marietta-city.org", site_url="https://www.marietta-city.org",
            nces_id="1302640", enrollment=2600,
        ),
    ]
    registry_hs.save(rows, tmp)
    back = registry_hs.load(tmp)
    check("roundtrip len", len(back), 1)
    check("roundtrip is_public survives as bool", back[0].is_public, True)
    check("roundtrip enrollment survives as int", back[0].enrollment, 2600)
    check("roundtrip school_id", back[0].school_id, "ga-marietta")


def test_merge_prefers_incoming_non_empty():
    existing = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA")]
    incoming = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                                     nces_id="123", enrollment=900)]
    merged = registry_hs.merge(existing, incoming)
    check("merge keeps one row", len(merged), 1)
    check("merge fills nces_id", merged[0].nces_id, "123")


def test_merge_never_blanks_existing():
    existing = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA", nces_id="123")]
    incoming = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA", nces_id="")]
    merged = registry_hs.merge(existing, incoming)
    check("merge does not blank a populated field", merged[0].nces_id, "123")


def main():
    """Auto-discovers every global named test_*.

    Deliberately NOT a hand-maintained list. Nine tasks add tests to this file;
    a list is one forgotten line away from a green run that proved nothing.
    A test needing the temp CSV declares one parameter and receives `tmp`.
    """
    import inspect, tempfile, os
    fd, tmp = tempfile.mkstemp(suffix=".csv")
    os.close(fd)
    tests = sorted(
        ((name, fn) for name, fn in list(globals().items())
         if name.startswith("test_") and callable(fn)),
        key=lambda kv: kv[0],
    )
    for name, fn in tests:
        try:
            fn(tmp) if inspect.signature(fn).parameters else fn()
        except Exception:
            FAILURES.append(f"{name} raised:\n{traceback.format_exc()}")
    os.unlink(tmp)
    print(f"ran {len(tests)} tests")
    if FAILURES:
        print(f"{len(FAILURES)} FAILED\n")
        for f in FAILURES:
            print(f + "\n")
        sys.exit(1)
    print("all passed")


if __name__ == "__main__":
    main()
