"""Crawl the next tranche of schools on district domains already PROVEN to run
Finalsite.

Waves 1 and 2 each began by probing schools one at a time to find out which CMS
they run. That is the right move for an unexplored state and the wrong one
here, because Finalsite is licensed by the DISTRICT, not the school: once
brookwoodhs.gcpsk12.org is known to be Finalsite, so are the other seventeen
Gwinnett high schools, and probing each of them re-establishes a fact the
archive already holds.

So this selects by district domain, not by school, and spends its requests on
the surname lookups that actually return coaches.

Depth is measured in `staff:q:` pages, not in "has a staff page". Six Gwinnett
schools had a base directory page archived and zero surname lookups against it
-- they LOOKED crawled and were, in substance, untouched. Counting pages that
exist rather than pages that answer a question is how that stayed invisible.
"""

from __future__ import annotations

import collections
import csv
import re
import sys
import zlib

import _shared  # noqa: F401
import adapters_hs
import adapters_hs.finalsite as adapters_hs_finalsite
import archive
import crawl_hs
import manifest
import net
import registry_hs

# The five sports the project mails. A school's OTHER staff are not worth a
# request: the roster names 19,677 people and 8,282 of them coach these.
TARGET_SPORTS = {"football", "basketball", "volleyball", "soccer", "hockey"}

# Below this many surname lookups a school counts as un-crawled regardless of
# how many pages it has.
MIN_DEEP = 3

# Host shapes to try per district before falling back to a discovery pass.
MAX_TEMPLATES = 3


def proven_finalsite_domains(arch, by_id) -> set[str]:
    """District domains where an archived page actually parsed as Finalsite.

    Derived from the archive rather than hardcoded, so it grows by itself as
    each wave lands and never disagrees with what was really seen.
    """
    out: set[str] = set()
    for row in arch.conn.execute(
            "SELECT school_id, html_z FROM pages WHERE html_z IS NOT NULL"):
        school = by_id.get(row["school_id"])
        if not school or not school.mail_domain:
            continue
        html = zlib.decompress(row["html_z"]).decode("utf-8", "replace")
        if adapters_hs.adapter_for(html).name == "finalsite":
            out.add(school.mail_domain)
    return out


def target_surnames(roster_rows) -> list[str]:
    """Distinct surnames of the coaches we actually want, normalised.

    norm_person() is what manifest.attribute() matches on, so taking the
    surname from anywhere else would query a spelling the attributor cannot
    later join against.
    """
    names = set()
    for row in roster_rows:
        sports = {s for s in (row.get("sports") or "").split("|") if s}
        if not (TARGET_SPORTS & sports):
            continue
        norm = manifest.norm_person(row.get("name") or "")
        if norm:
            names.add(norm.split()[-1])
    return sorted(names)


def finalsite_base(arch, school_id: str) -> str:
    """A directory url already archived for this school, if one parsed as
    Finalsite. Saves a discovery pass for schools waves 1-2 half-crawled."""
    for row in arch.conn.execute(
            "SELECT url, final_url, html_z FROM pages "
            "WHERE school_id = ? AND kind LIKE 'staff%' AND html_z IS NOT NULL "
            "ORDER BY kind", (school_id,)):
        html = zlib.decompress(row["html_z"]).decode("utf-8", "replace")
        if adapters_hs.adapter_for(html).name != "finalsite":
            continue
        url = row["url"] or row["final_url"] or ""
        return url.split("?")[0]
    return ""


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def sibling_templates(arch, by_id) -> dict:
    """Per district, the host+path shapes its OTHER schools' directories use.

    A Gwinnett school's directory lives at norcrosshs.gcpsk12.org/directory --
    a host that appears in neither site_url nor email_domain, because the
    registry's site_url is the booster site (norcrosshigh.org,
    archertigersathletics.com, parkview.net). crawl_school_deep starts from
    those two fields, so it cannot reach the directory from either, and
    Norcross came back "no finalsite directory" while a 100-person directory
    sat at a host its siblings were already archived under.

    Inferred from the archive, never hardcoded: read the hosts of directories
    that really parsed as Finalsite, and keep the part that is NOT the school's
    own name. Ordered by how many siblings use each shape, so the common one
    costs one request.
    """
    counts: dict = {}
    for row in arch.conn.execute(
            "SELECT school_id, url, final_url, html_z FROM pages "
            "WHERE kind LIKE 'staff%' AND html_z IS NOT NULL"):
        school = by_id.get(row["school_id"])
        if not school or not school.district_domain:
            continue
        html = zlib.decompress(row["html_z"]).decode("utf-8", "replace")
        if adapters_hs.adapter_for(html).name != "finalsite":
            continue
        url = (row["url"] or row["final_url"] or "").split("?")[0]
        match = re.match(r"https?://([^/]+)(/.*)?$", url)
        if not match:
            continue
        host, path = match.group(1), (match.group(2) or "")
        if not host.endswith("." + school.district_domain):
            continue
        label = host[: -(len(school.district_domain) + 1)]
        name = _norm_name(school.school)
        # "www" and other district-wide hosts do not encode a school name, so
        # they yield no template -- which is correct, there is nothing to vary.
        if name and label.startswith(name):
            key = (school.district_domain, label[len(name):], path)
            counts[key] = counts.get(key, 0) + 1

    out: dict = {}
    for (domain, suffix, path), n in sorted(counts.items(), key=lambda kv: -kv[1]):
        out.setdefault(domain, []).append((suffix, path))
    return {d: v[:MAX_TEMPLATES] for d, v in out.items()}


def try_templates(fetcher, arch, school, templates) -> str:
    """Fetch this school's name plugged into each sibling shape. Returns a
    base url, or "" -- and archives whatever directory it finds."""
    name = _norm_name(school.school)
    if not name:
        return ""
    for i, (suffix, path) in enumerate(templates):
        url = "https://%s%s.%s%s" % (name, suffix, school.district_domain, path)
        resp = fetcher.get(url)
        if not resp.ok or not resp.html:
            continue
        if adapters_hs.adapter_for(resp.html).name != "finalsite":
            continue
        if not adapters_hs_finalsite.Finalsite().parse(resp.html, {}):
            continue
        kind = "staff" if i == 0 else "staff:t%d" % (i + 1)
        arch.store_page(school.school_id, kind, url, resp.final_url,
                        resp.status, resp.html, "finalsite", None)
        return url
    return ""


def load_roster(path="data/ga_roster.csv") -> dict:
    out = collections.defaultdict(list)
    with open(path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            out[row["school_id"]].append(row)
    return out


def main(argv) -> int:
    limit = int(argv[0]) if argv else 0

    schools = registry_hs.load("data/ga_schools.csv")
    by_id = {s.school_id: s for s in schools}
    roster = load_roster()

    arch = archive.Archive("data/hs_archive.sqlite")
    domains = proven_finalsite_domains(arch, by_id)
    depth = collections.Counter()
    for row in arch.conn.execute(
            "SELECT school_id FROM pages "
            "WHERE kind LIKE 'staff:q:%' AND html_z IS NOT NULL"):
        depth[row["school_id"]] += 1

    todo = []
    for school in schools:
        if school.mail_domain not in domains or not school.site_url:
            continue
        if depth[school.school_id] >= MIN_DEEP:
            continue
        surnames = target_surnames(roster.get(school.school_id, []))
        if surnames:
            todo.append((school, surnames))
    todo.sort(key=lambda t: -len(t[1]))
    if limit:
        todo = todo[:limit]

    print("%d proven-Finalsite district domains" % len(domains))
    print("%d schools below %d surname lookups, %d lookups queued"
          % (len(todo), MIN_DEEP, sum(len(s) for _, s in todo)))
    print()

    templates = sibling_templates(arch, by_id)
    fetcher = net.Fetcher()
    finalsite = adapters_hs_finalsite.Finalsite()
    totals = collections.Counter()
    for school, surnames in todo:
        # Cheapest first: a directory already archived costs nothing, a
        # sibling's host shape costs one request, a discovery pass costs a
        # home page plus up to six candidates.
        base = finalsite_base(arch, school.school_id)
        how = "archived"
        if not base:
            base = try_templates(fetcher, arch, school,
                                 templates.get(school.district_domain, []))
            how = "sibling"
        if not base:
            crawl_hs.crawl_school_deep(fetcher, arch, school)
            base = finalsite_base(arch, school.school_id)
            how = "discovered"
        if not base:
            # Not always "no directory": North Gwinnett has a Finalsite
            # directory listing 100 people and publishing zero addresses, and
            # its surname filter is ignored besides. A directory that names
            # staff without contacting them is nothing to us.
            print("  %-26s %-11s no directory that publishes addresses"
                  % (school.school_id, how))
            totals["no-directory"] += 1
            continue

        stored = crawl_hs.lookup_roster(
            fetcher, arch, school.school_id, base, finalsite, surnames)
        print("  %-26s %-11s %3d surnames -> %3d pages   %s"
              % (school.school_id, how, len(surnames), stored, base[:52]))
        totals["pages"] += stored
        totals["schools"] += 1 if stored else 0
        totals["empty"] += 0 if stored else 1

    arch.conn.close()
    print()
    print("wave complete: %d pages stored across %d schools "
          "(%d returned nothing, %d had no usable directory)"
          % (totals["pages"], totals["schools"], totals["empty"],
             totals["no-directory"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
