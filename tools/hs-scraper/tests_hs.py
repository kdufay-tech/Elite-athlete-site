"""Tests for the high-school scraper. Run: python tests_hs.py

Dependency-free on purpose, matching tools/coach-scraper/tests.py -- it runs
anywhere the scraper runs. Every case here is a regression, not decoration.
"""

from __future__ import annotations

import sys
import traceback

import _shared  # noqa: F401  -- must import first; puts coach-scraper on sys.path
import registry_hs
import domains
import associations.ghsa as ghsa

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


def test_merge_never_flips_is_public():
    # False == 0 in Python, so a naive blank-check reads is_public=False as
    # "unset" and lets a later pass overwrite it. is_public decides the whole
    # discovery path, so this must hold.
    existing = [registry_hs.HSSchool(school_id="ga-priv", school="Priv", state="GA",
                                     is_public=False)]
    incoming = [registry_hs.HSSchool(school_id="ga-priv", school="Priv", state="GA",
                                     is_public=True, nces_id="999")]
    merged = registry_hs.merge(existing, incoming)
    check("private school stays private", merged[0].is_public, False)
    check("other fields still fill", merged[0].nces_id, "999")


def test_merge_still_fills_zero_enrollment():
    # enrollment 0 genuinely means "not known", so 0 must remain fillable.
    existing = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                                     enrollment=0)]
    incoming = [registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                                     enrollment=1500)]
    merged = registry_hs.merge(existing, incoming)
    check("zero enrollment is fillable", merged[0].enrollment, 1500)


ENTRY = [
    "ACE CHARTER (2-AA)",
    "5665 New Forsyth Road",
    "Macon, GA 31210",
    "Phone:\t478-238-5757",
    "www.acemacon.org",
    "gryphon@acemacon.org",
    "Colors:\tRoyal Blue & Emerald Green",
    "Mascot:\tGryphon",
    "Robby Jones P",
    "Thomas Darrah AD*,1",
    "Henry Avery 1,5*",
    "Andrea Blair 13",
    "Cal Cee 4",
]


def test_ghsa_parses_school_fields():
    school, _ = ghsa.parse_entry(ENTRY)
    check("school name", school.school, "ACE CHARTER")
    check("classification", school.classification, "2-AA")
    check("city", school.city, "Macon")
    check("state", school.state, "GA")
    check("site_url", school.site_url, "https://www.acemacon.org")
    check("school_id", school.school_id, "ga-ace-charter")


def test_ghsa_parses_roster_with_sports():
    _, roster = ghsa.parse_entry(ENTRY)
    by_name = {r.name: r for r in roster}
    check("roster size", len(roster), 5)
    check("AD also coaches football", by_name["Thomas Darrah"].sports, ["football"])
    check("star means head", by_name["Thomas Darrah"].is_head, True)
    check("track code 5 is not a target", by_name["Henry Avery"].sports, ["football"])
    check("star on a later code still means head", by_name["Henry Avery"].is_head, True)
    check("code 13 is volleyball", by_name["Andrea Blair"].sports, ["volleyball"])
    check("no star means not head", by_name["Andrea Blair"].is_head, False)
    check("principal coaches nothing", by_name["Robby Jones"].sports, [])
    check("principal is not a head coach", by_name["Robby Jones"].is_head, False)
    check("baseball code 4 is not a target", by_name["Cal Cee"].sports, [])


def test_ghsa_captures_the_email_domain_not_the_address():
    school, _ = ghsa.parse_entry(ENTRY)
    check("domain captured", school.email_domain, "acemacon.org")
    check("no address stored anywhere on the school",
          any("@" in str(v) for v in vars(school).values()), False)


def test_ghsa_ignores_a_free_mail_address():
    entry = [l for l in ENTRY if "@" not in l] + ["coachbob@gmail.com"]
    school, _ = ghsa.parse_entry(entry)
    check("free mail is not a school domain", school.email_domain, "")


def test_an_email_line_is_not_parsed_as_a_person():
    _, roster = ghsa.parse_entry(ENTRY)
    check("no roster entry came from the email line",
          any("@" in r.name for r in roster), False)


def test_ghsa_rejects_a_non_entry():
    check("front matter is not an entry",
          ghsa.parse_entry(["GHSA Staff", "Tim Scott, Executive Director"]), None)


def test_group_entries_splits_on_headers_not_pages():
    lines = [
        "GHSA Staff", "Tim Scott, Executive Director",     # front matter, no header yet
        "ALPHA HIGH (1-A)", "1 Main St", "Ann Aye 1*",
        "BETA HIGH (2-AA)", "2 Oak Rd", "Bob Bee 13",
    ]
    blocks = ghsa.group_entries(lines)
    check("front matter starts no block", len(blocks), 2)
    check("first block is Alpha", blocks[0][0], "ALPHA HIGH (1-A)")
    check("second block is Beta", blocks[1][0], "BETA HIGH (2-AA)")
    check("roster line stayed with its school", blocks[0][-1], "Ann Aye 1*")


def test_group_entries_keeps_the_final_block():
    # The last school in the document has no following header to flush it.
    # Without the trailing flush it vanishes, and the count looks like drift.
    blocks = ghsa.group_entries(["OMEGA HIGH (7-AAAAAAA)", "9 End Ave", "Zed Zee 2*"])
    check("final block survives", len(blocks), 1)
    check("final block is complete", len(blocks[0]), 3)


def test_group_entries_spans_a_page_break():
    # A roster continuing after a page boundary must stay in the same block;
    # extract_text() gives us one flat stream, so a page break is just a line.
    lines = ["GAMMA HIGH (3-AAA)", "3 Elm St", "Cy Cee 1*", "", "Dee Dee 13*"]
    blocks = ghsa.group_entries(lines)
    check("page break does not split the school", len(blocks), 1)
    check("both coaches kept", blocks[0][-1], "Dee Dee 13*")


def test_registrable_handles_the_k12_public_suffix():
    check("k12.ga.us keeps the district label",
          domains.registrable("https://www.dekalb.k12.ga.us/staff"), "dekalb.k12.ga.us")
    check("ordinary domain", domains.registrable("http://cobbk12.org/x"), "cobbk12.org")
    check("strips www", domains.registrable("https://www.hallco.org"), "hallco.org")
    check("blank url", domains.registrable(""), "")


def test_unit_key_keeps_shared_cms_hosts_apart():
    # Four unrelated county systems live on schooldesk.net. They are not one unit.
    a = domains.unit_key("http://colquitt.high.schooldesk.net")
    b = domains.unit_key("http://clayton.315.schooldesk.net")
    check("colquitt keeps its own host", a, "colquitt.high.schooldesk.net")
    check("clayton does not join it", b, "clayton.315.schooldesk.net")
    check("they are different units", a == b, False)


def test_unit_key_groups_a_real_district():
    check("same district, different schools",
          domains.unit_key("https://www.dekalb.k12.ga.us/a")
          == domains.unit_key("http://dekalb.k12.ga.us/b"), True)


def test_assign_sets_district_domain_and_orders_by_size():
    mk = lambda i, u: registry_hs.HSSchool(school_id=f"ga-{i}", school=str(i),
                                           state="GA", site_url=u)
    schools = [mk(1, "http://cobbk12.org/a"), mk(2, "http://cobbk12.org/b"),
               mk(3, "http://wesleyan.org"), mk(4, "")]
    units = domains.assign(schools)
    check("largest unit first", list(units)[0], "cobbk12.org")
    check("shared unit has both", len(units["cobbk12.org"]), 2)
    check("district_domain set", schools[0].district_domain, "cobbk12.org")
    check("solo school gets its own", schools[2].district_domain, "wesleyan.org")
    check("no site_url yields no unit", schools[3].district_domain, "")
    check("unresolved school is in no unit",
          any(schools[3] in v for v in units.values()), False)


def test_assign_prefers_the_email_domain_over_the_website():
    # ALLATOONA: booster site, district mail. The mail domain must win.
    s = registry_hs.HSSchool(school_id="ga-a", school="A", state="GA",
                             site_url="http://allatoonabucs.com",
                             email_domain="cobbk12.org")
    units = domains.assign([s])
    check("keyed on mail, not the booster site", s.district_domain, "cobbk12.org")
    check("unit is the district", list(units), ["cobbk12.org"])


def test_assign_falls_back_to_the_website_when_no_email():
    s = registry_hs.HSSchool(school_id="ga-b", school="B", state="GA",
                             site_url="http://wesleyan.org", email_domain="")
    domains.assign([s])
    check("website used as fallback", s.district_domain, "wesleyan.org")


def test_mail_domain_no_longer_branches_on_is_public():
    # A public school whose district_domain was never resolved must NOT report a
    # blank mail domain while it has a site_url of its own.
    s = registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                             is_public=True, site_url="https://bowdon.org")
    check("falls back to its own host", s.mail_domain, "bowdon.org")


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
