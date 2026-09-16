"""Command line for the coach directory collector.

Typical run:

    python main.py registry-import --csv "<path to a contact csv>" --division D1
    python main.py verify-registry            # which domains actually resolve
    python main.py crawl --division D2        # polite, resumable
    python main.py titles                     # tune filters.py against real data
    python main.py export                     # CSVs + migration.sql
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import config
import crawl as crawl_mod
import export as export_mod
import parse as parse_mod
import registry
from archive import Archive
from net import Fetcher

HERE = Path(__file__).parent
DB_PATH = HERE / "data" / "archive.sqlite"
OUT_DIR = HERE / "out"


def _log(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname).1s %(message)s",
        stream=sys.stdout,
    )


def _schools(args) -> list[registry.School]:
    schools = registry.load()
    division = getattr(args, "division", None)
    if division:
        wanted = {d.strip().upper() for d in division.split(",")}
        schools = [s for s in schools if s.division in wanted]
    return schools


# ---- commands -----------------------------------------------------------
def cmd_registry_import(args):
    incoming = registry.import_domains_from_csv(args.csv, args.division.upper())
    merged = registry.merge(registry.load(), incoming)
    registry.save(merged)
    print("imported %d domains; registry now %d schools" % (len(incoming), len(merged)))


def cmd_verify_registry(args):
    """Confirm each athletics domain resolves before a full crawl depends on it.

    Writes the unreachable rows to out/registry_failed.csv so a bad seed can be
    pruned rather than silently dragging every later crawl.
    """
    schools = _schools(args)
    fetcher = Fetcher()
    lock = threading.Lock()
    good, bad = [], []

    def probe(s):
        result = fetcher.get(s.athletics_url)
        reachable = bool(result.ok or (result.status and result.status < 400))
        with lock:
            (good if reachable else bad).append(s)
            if reachable:
                print("  ok    %-5s %-36s %s" % (s.division, s.school[:34], s.athletics_url))
            else:
                print("  FAIL  %-5s %-36s %s  (%s)" % (
                    s.division, s.school[:34], s.athletics_url,
                    (result.error or result.status)))

    with ThreadPoolExecutor(max_workers=args.workers or config.MAX_WORKERS) as pool:
        list(pool.map(probe, schools))

    if bad:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        registry.save(bad, OUT_DIR / "registry_failed.csv")
        print("\nunreachable rows written to %s" % (OUT_DIR / "registry_failed.csv"))
        if args.prune:
            registry.save(sorted(good, key=lambda s: (s.division, s.school)))
            print("pruned registry to %d reachable schools" % len(good))

    print("\n%d reachable, %d unreachable, %d total"
          % (len(good), len(bad), len(schools)))


def cmd_crawl(args):
    schools = _schools(args)
    if not schools:
        print("no schools in registry; run registry-import first")
        return 1
    arc = Archive(DB_PATH)
    tally = crawl_mod.crawl_all(
        schools, arc, resume=not args.no_resume,
        want_contact=not args.no_address, limit=args.limit,
        workers=args.workers,
    )
    print("\ncrawl result:", json.dumps(tally, indent=2))
    print("archive:", json.dumps(arc.stats(), indent=2, default=str))
    arc.close()
    return 0


def cmd_parse(args):
    arc = Archive(DB_PATH)
    records, stats = parse_mod.parse_all(arc, _schools(args),
                                         apply_filter=not args.no_filter)
    print(json.dumps(stats, indent=2))
    for r in records[:15]:
        print("  %-5s %-24s%-11s%-24s%-28s%s" % (
            r.division, r.school[:22], r.sport, r.name[:22], r.title[:26], r.email))
    arc.close()
    return 0


def cmd_titles(args):
    arc = Archive(DB_PATH)
    counter = parse_mod.title_distribution(arc, _schools(args))
    print("%d distinct titles in target sports\n" % len(counter))
    for title, n in counter.most_common(args.top):
        print("  %5d  %s" % (n, title))
    arc.close()
    return 0


def cmd_export(args):
    arc = Archive(DB_PATH)
    records, stats = parse_mod.parse_all(arc, _schools(args),
                                         apply_filter=not args.no_filter)
    combined, suppressed = export_mod.write_csv(records, OUT_DIR / "coaches_all.csv")
    per_sport = export_mod.write_per_sport(records, OUT_DIR)
    per_tier = export_mod.write_by_confidence(records, OUT_DIR)
    migration = export_mod.write_migration(OUT_DIR / "migration.sql")
    print(json.dumps(stats, indent=2))
    print("\nsuppressed (do-not-contact list): %d" % suppressed)
    print("wrote %s" % combined)
    for p in per_sport + per_tier:
        print("      %s" % p)
    print("      %s" % migration)
    arc.close()
    return 0


def cmd_stats(args):
    arc = Archive(DB_PATH)
    print(json.dumps(arc.stats(), indent=2, default=str))
    arc.close()
    return 0


def cmd_selftest(args):
    """Parse the bundled fixture. Proves the pipeline without network access."""
    import filters
    import normalize
    from adapters import adapter_for

    fixture = HERE / "gv_fixture.html"
    if not fixture.exists():
        print("fixture missing:", fixture)
        return 1

    html = fixture.read_text(encoding="utf-8")
    adapter = adapter_for(html)
    ctx = {
        "school": "Grand Valley State", "school_id": "grand-valley-state",
        "division": "D2", "state": "MI",
        "proof_url": "https://gvsulakers.com/staff-directory",
        "captured_at": "fixture",
    }
    raw = adapter.parse(html, ctx)
    clean = [c for c in (normalize.normalize(r) for r in raw) if c]
    target = [c for c in clean if c.sport]
    coaches = [c for c in target
               if filters.is_target_coach(c.title, c.category, c.sport)]

    print("adapter        : %s" % adapter.name)
    print("rows parsed    : %d" % len(raw))
    print("with email     : %d" % len(clean))
    print("in 5 sports    : %d" % len(target))
    print("pass filter    : %d" % len(coaches))
    print()
    for c in coaches[:10]:
        print("  %-20s%-22s%-26s%s" % (c.sport, c.name[:20], c.title[:24], c.email))

    assert adapter.name == "sidearm", "expected sidearm adapter"
    assert len(raw) > 100, "fixture should yield >100 rows"
    assert len(coaches) > 10, "filter should keep a realistic number of coaches"
    assert all(c.email and "@" in c.email for c in coaches), "every row needs an email"
    assert all(c.proof_url for c in coaches), "every row needs provenance"
    print("\nSELFTEST PASS")
    return 0


def build_parser():
    p = argparse.ArgumentParser(
        prog="coach-scraper", description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("-v", "--verbose", action="store_true")
    sub = p.add_subparsers(dest="cmd", required=True)

    divisions = list(config.DIVISIONS) + [d.lower() for d in config.DIVISIONS]

    s = sub.add_parser("registry-import", help="harvest domains from a contact CSV")
    s.add_argument("--csv", required=True)
    s.add_argument("--division", required=True, choices=divisions)
    s.set_defaults(func=cmd_registry_import)

    s = sub.add_parser("verify-registry", help="check athletics domains resolve")
    s.add_argument("--division")
    s.add_argument("--workers", type=int)
    s.add_argument("--prune", action="store_true",
                   help="rewrite schools.csv keeping only reachable rows")
    s.set_defaults(func=cmd_verify_registry)

    s = sub.add_parser("crawl", help="fetch staff directories into the archive")
    s.add_argument("--division")
    s.add_argument("--limit", type=int)
    s.add_argument("--no-resume", action="store_true")
    s.add_argument("--no-address", action="store_true",
                   help="skip the second request for the mailing address")
    s.add_argument("--workers", type=int,
                   help="concurrent hosts (default %d)" % config.MAX_WORKERS)
    s.set_defaults(func=cmd_crawl)

    s = sub.add_parser("parse", help="parse the archive (offline)")
    s.add_argument("--division")
    s.add_argument("--no-filter", action="store_true")
    s.set_defaults(func=cmd_parse)

    s = sub.add_parser("titles", help="title distribution, for tuning filters.py")
    s.add_argument("--division")
    s.add_argument("--top", type=int, default=60)
    s.set_defaults(func=cmd_titles)

    s = sub.add_parser("export", help="write CSVs and migration.sql")
    s.add_argument("--division")
    s.add_argument("--no-filter", action="store_true")
    s.set_defaults(func=cmd_export)

    s = sub.add_parser("stats", help="archive contents")
    s.set_defaults(func=cmd_stats)

    s = sub.add_parser("selftest", help="parse the bundled fixture, no network")
    s.set_defaults(func=cmd_selftest)
    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    _log(args.verbose)
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
