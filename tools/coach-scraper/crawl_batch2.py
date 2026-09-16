"""Crawl the newly discovered athletics sites into the shared archive.

Reuses crawl.crawl_school, which already tries each candidate staff-directory
path and rejects styled-404 pages by checking that an adapter recognises the
content - a 200 is not enough on these sites.
"""
import csv, logging, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import crawl as crawl_mod
from archive import Archive
from net import Fetcher
from registry import School

logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
schools=[School(school_id=r["school_id"], school=r["school"], division=r["division"],
                state=r["state"], conference=r["conference"], athletics_url=r["athletics_url"])
         for r in csv.DictReader(open("data/schools_blast.csv", encoding="utf-8"))]
arc=Archive(Path("data/archive.sqlite")); f=Fetcher()
states={}
def one(s):
    try: return s.school, crawl_mod.crawl_school(s, f, arc, want_contact=False)
    except Exception as e: return s.school, "error:%s" % str(e)[:60]
with ThreadPoolExecutor(max_workers=10) as ex:
    for name, st in ex.map(one, schools):
        states[st]=states.get(st,0)+1
print("\n=== crawl states ===", flush=True)
for k,v in sorted(states.items(), key=lambda kv:-kv[1]): print("  %-16s %d" % (k,v))
