"""Find each school's athletics site from its institutional domain.

The registry docstring calls this the hard part, and it is: an email domain
does not give you the athletics host. Wake Forest mails from wfu.edu and plays
at godeacs.com. There is no public mapping, so this asks the school's own
homepage - which always links to its athletics site - instead of guessing.

Scoring, not first-match: a homepage carries dozens of outbound links, and the
athletics one is identifiable by host shape (go*.com, *sports.com,
*athletics.com) plus anchor text. Taking the first "athletics" substring hit
picks up news articles and department pages instead.
"""
from __future__ import annotations
import re, sys, csv
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin, urlparse
from net import Fetcher

# Mail-only prefixes that are never the web host.
STRIP = ("mail.", "admin.", "central.", "live.", "smail.", "terpmail.",
         "cougarnet.", "mailbox.", "ucmail.", "huntsman.", "warhawks.",
         "rockets.", "u.", "sass.", "g.", "mix.", "batten.")

HOSTY = re.compile(r"^(go[a-z]{3,}|[a-z]{3,}(sports|athletics|tickets)|"
                   r"[a-z]{3,}(cats|tigers|bears|eagles|lions|hawks|knights|"
                   r"huskies|bulldogs|wildcats|rams|owls|jays|devils))\.com$", re.I)
ATHLETIC_WORD = re.compile(r"athletic|varsity|sports", re.I)

def web_host(domain: str) -> str:
    d = domain
    for p in STRIP:
        if d.startswith(p):
            d = d[len(p):]
    return d

def pick(html: str, base: str, own_host: str) -> str:
    best, best_score = "", 0
    for m in re.finditer(r'<a\b[^>]*href=["\']([^"\']+)["\'][^>]*>(.{0,120}?)</a>',
                         html, re.I | re.S):
        href, text = m.group(1), re.sub(r"<[^>]+>", " ", m.group(2))
        url = urljoin(base, href)
        host = (urlparse(url).netloc or "").lower().replace("www.", "")
        if not host or host == own_host or host.endswith(".gov"):
            continue
        score = 0
        if HOSTY.match(host):                      score += 5
        if ATHLETIC_WORD.search(host):             score += 3
        if ATHLETIC_WORD.search(text):             score += 2
        if re.fullmatch(r"\s*athletics\s*", text, re.I): score += 3
        if urlparse(url).path.strip("/") == "":    score += 1   # site root, not an article
        if score > best_score:
            best, best_score = f"https://{host}", score
    return best if best_score >= 5 else ""

def main(path: str, limit: int | None) -> None:
    rows = [l.strip().split("|") for l in open(path, encoding="utf-8") if "|" in l]
    if limit: rows = rows[:limit]
    f = Fetcher()
    out, miss = [], []

    def one(pair):
        school, dom = pair
        host = web_host(dom)
        r = f.get(f"https://{host}/")
        if not r.ok:
            return (school, dom, "", f"home:{r.error or r.status}")
        url = pick(r.html, r.final_url or f"https://{host}/", host)
        if not url:
            # Many universities do not link athletics from the homepage at all,
            # but almost all keep /athletics as a redirect to the real site.
            # One extra request per miss, and it converts most of them.
            for guess in (f"https://{host}/athletics", f"https://{host}/athletics/"):
                g = f.get(guess)
                if g.ok and g.final_url:
                    gh = (g.final_url.split("/")[2] if "://" in g.final_url else "").lower().replace("www.","")
                    if gh and gh != host:
                        return (school, dom, f"https://{gh}", "")
                    u2 = pick(g.html, g.final_url, host)
                    if u2:
                        return (school, dom, u2, "")
        return (school, dom, url, "" if url else "no-link-found")

    with ThreadPoolExecutor(max_workers=8) as ex:
        for school, dom, url, err in ex.map(one, rows):
            if url:
                out.append((school, dom, url)); print("  OK   %-34s %s" % (school[:33], url), flush=True)
            else:
                miss.append((school, dom, err)); print("  --   %-34s %s" % (school[:33], err), flush=True)

    print("\nfound %d of %d (%.0f%%)" % (len(out), len(rows), 100*len(out)/max(len(rows),1)))
    with open("discovered_athletics.csv", "a", newline="", encoding="utf-8") as fh:
        csv.writer(fh).writerows(out)

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else None)
