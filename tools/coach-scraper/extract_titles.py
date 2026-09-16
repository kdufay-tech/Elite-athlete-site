"""Recover (email -> title) pairs from already-archived directory HTML.

Deliberately NOT parse.parse_school: that also runs address extraction over the
full page for every school, which a title backfill does not need and which made
a 143-page run take minutes. Here only the adapter runs.

Filters are not applied. The target-sport / head-coach filters exist to build a
send list; they would discard exactly the assistants and coordinators whose
titles this is trying to recover.
"""
from __future__ import annotations
import csv, sqlite3, zlib, sys, collections
from pathlib import Path
from adapters import adapter_for

HERE = Path(__file__).parent
db = sqlite3.connect(HERE / "data" / "archive.sqlite")
pages = db.execute(
    "SELECT school_id, url, final_url, html_z, fetched_at FROM pages "
    "WHERE status=200 AND html_z IS NOT NULL AND kind='directory'").fetchall()
print("directory pages archived: %d" % len(pages), flush=True)
if not pages:
    pages = db.execute(
        "SELECT school_id, url, final_url, html_z, fetched_at FROM pages "
        "WHERE status=200 AND html_z IS NOT NULL").fetchall()
    print("  (no kind='directory'; using all %d archived pages)" % len(pages), flush=True)

rows, seen, per_platform = [], set(), collections.Counter()
for i, (sid, url, final_url, blob, fetched) in enumerate(pages, 1):
    try:
        html = zlib.decompress(blob).decode("utf-8", "replace")
        ad = adapter_for(html)
        recs = ad.parse(html, {"school": sid, "school_id": sid, "division": "",
                               "state": "", "conference": "",
                               "proof_url": final_url or url or "",
                               "captured_at": fetched or ""})
        per_platform[ad.name] += len(recs)
        for r in recs:
            em = (r.email or "").strip().lower()
            ti = (r.title or "").strip()
            if not em or not ti or em in seen:
                continue
            seen.add(em)
            rows.append({"email": em, "title": ti,
                         "category": (r.category or "").strip(),
                         "proof_url": r.proof_url or "", "school_id": sid})
    except Exception as e:                      # one bad page must not lose the rest
        print("  !! %s: %s" % (sid, str(e)[:70]), flush=True)
    if i % 25 == 0:
        print("  %d/%d pages, %d titled emails" % (i, len(pages), len(rows)), flush=True)

out = HERE / "out" / "archive_titles.csv"
out.parent.mkdir(exist_ok=True)
with out.open("w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=["email","title","category","proof_url","school_id"])
    w.writeheader(); w.writerows(rows)

doms = collections.Counter(e.split("@")[1] for e in seen)
print("\nTITLED EMAILS: %d across %d domains" % (len(rows), len(doms)), flush=True)
print("by platform:", dict(per_platform), flush=True)
print("top domains:", ", ".join("%s(%d)" % kv for kv in doms.most_common(10)), flush=True)
