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
import manifest
import associations.ghsa as _ghsa
import discover_hs
import adapters_hs.finalsite as finalsite

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


def test_host_is_case_insensitive_about_the_scheme():
    # Lower-casing after the regex left "https:" as the host, merging every
    # mis-cased url into one fake unit.
    check("upper scheme", domains.registrable("HTTPS://www.dekalb.k12.ga.us/staff"),
          "dekalb.k12.ga.us")
    check("mixed scheme", domains.registrable("Http://CobbK12.org/x"), "cobbk12.org")
    check("upper WWW", domains.registrable("HTTP://WWW.HALLCO.ORG"), "hallco.org")
    check("scheme-less", domains.registrable("CobbK12.org"), "cobbk12.org")


def test_host_drops_port_credentials_and_query():
    check("port", domains.registrable("https://cobbk12.org:8443/x"), "cobbk12.org")
    check("query", domains.registrable("https://cobbk12.org/?a=1"), "cobbk12.org")
    check("fragment", domains.registrable("https://cobbk12.org/#staff"), "cobbk12.org")
    check("userinfo", domains.registrable("https://u:p@cobbk12.org/x"), "cobbk12.org")


def test_registrable_collapses_a_multi_label_k12_subdomain():
    # www. is stripped before the k12 branch runs, so a www-only test never puts
    # more than one label in front of .k12. -- this is what actually covers it.
    check("boe subdomain", domains.registrable("https://boe.richmond.k12.ga.us/"),
          "richmond.k12.ga.us")
    check("two subdomains", domains.registrable("http://a.b.dekalb.k12.ga.us/x"),
          "dekalb.k12.ga.us")
    check("bare district host", domains.registrable("https://henry.k12.ga.us"),
          "henry.k12.ga.us")
    check("k12 in the NAME is not the suffix",
          domains.registrable("https://www.cobbk12.org"), "cobbk12.org")


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


def test_assign_clears_a_stale_district_domain():
    s = registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                             site_url="", email_domain="")
    s.district_domain = "leftover.k12.ga.us"      # from an earlier run
    domains.assign([s])
    check("stale value cleared, not inherited", s.district_domain, "")


def test_mail_domain_no_longer_branches_on_is_public():
    # A public school whose district_domain was never resolved must NOT report a
    # blank mail domain while it has a site_url of its own.
    s = registry_hs.HSSchool(school_id="ga-x", school="X", state="GA",
                             is_public=True, site_url="https://bowdon.org")
    check("falls back to its own host", s.mail_domain, "bowdon.org")


def _school(i, dom, site=""):
    return registry_hs.HSSchool(school_id=f"ga-{i}", school=str(i), state="GA",
                                district_domain=dom, site_url=site)


def _entry(sid, name, sports):
    return _ghsa.RosterEntry(school_id=sid, name=name, codes=[], sports=sports)


def test_build_groups_targets_under_their_school_domain():
    schools = [_school(1, "cobbk12.org"), _school(2, "cobbk12.org"),
               _school(3, "wesleyan.org")]
    roster = [_entry("ga-1", "Ann Reed", ["football"]),
              _entry("ga-2", "Bo Katz", ["volleyball"]),
              _entry("ga-3", "Cy Doe", ["soccer"])]
    units = manifest.build(schools, roster)
    check("two units", len(units), 2)
    check("largest first", units[0].domain, "cobbk12.org")
    check("shared unit holds both schools", len(units[0].schools), 2)
    check("and both their coaches", len(units[0].targets), 2)
    check("shared flag set", units[0].is_shared, True)
    check("solo unit not flagged shared", units[1].is_shared, False)


def test_build_drops_roster_rows_with_no_target_sport():
    schools = [_school(1, "cobbk12.org")]
    roster = [_entry("ga-1", "Ann Reed", ["football"]),
              _entry("ga-1", "Pat Null", [])]          # principal, AD-only, band
    units = manifest.build(schools, roster)
    check("only the coach is a target", [t.name for t in units[0].targets],
          ["Ann Reed"])


def test_build_skips_schools_with_no_domain():
    schools = [_school(1, ""), _school(2, "cobbk12.org")]
    roster = [_entry("ga-1", "Ghost Coach", ["football"]),
              _entry("ga-2", "Real Coach", ["football"])]
    units = manifest.build(schools, roster)
    check("one unit only", len(units), 1)
    check("the unresolved school's coach is not smuggled in",
          [t.name for t in units[0].targets], ["Real Coach"])
    check("and it is reported unresolved",
          [s.school_id for s in manifest.unresolved(schools)], ["ga-1"])


def test_build_never_synthesises_an_address():
    # The manifest carries names so a crawler can RECOGNISE them. If any field
    # of a target ever contains an "@", something has constructed an address.
    schools = [_school(1, "cobbk12.org")]
    units = manifest.build(schools, [_entry("ga-1", "Ann Reed", ["football"])])
    t = units[0].targets[0]
    check("no address anywhere on the target",
          any("@" in str(v) for v in vars(t).values()), False)


def test_attribute_resolves_a_district_page_to_the_right_school():
    # One cobbk12.org staff page serves many schools. Which school a coach
    # belongs to must come from MATCHING THEIR NAME, not from which url we
    # happened to fetch.
    from adapters.base import CoachRecord
    schools = [_school(1, "cobbk12.org"), _school(2, "cobbk12.org")]
    schools[0].school, schools[1].school = "Allatoona", "Kennesaw Mountain"
    roster = [_entry("ga-1", "Ann Reed", ["football"]),
              _entry("ga-2", "Bo Katz", ["volleyball"])]
    unit = manifest.build(schools, roster)[0]
    recs = [CoachRecord(name="Bo Katz", email="b@cobbk12.org", school=""),
            CoachRecord(name="Ann Reed", email="a@cobbk12.org", school=""),
            CoachRecord(name="Nobody Here", email="n@cobbk12.org", school="")]
    counts = manifest.attribute(recs, unit)
    check("bo went to his own school", recs[0].school, "Kennesaw Mountain")
    check("ann went to hers", recs[1].school, "Allatoona")
    check("unlisted person is NOT guessed into a school", recs[2].school, "")
    check("matched counted", counts["matched"], 2)
    check("unmatched counted", counts["unmatched"], 1)


def test_attribute_matches_names_case_and_punctuation_insensitively():
    from adapters.base import CoachRecord
    s = _school(1, "cobbk12.org"); s.school = "Allatoona"
    unit = manifest.build([s], [_entry("ga-1", "Ann O'Reed-Smith", ["football"])])[0]
    rec = CoachRecord(name="  ANN OREED SMITH ", email="a@cobbk12.org", school="")
    manifest.attribute([rec], unit)
    check("normalised match still lands", rec.school, "Allatoona")


NAV = """
<html><body>
  <a href="/about">About Us</a>
  <a href="/athletics/staff-directory">Staff Directory</a>
  <a href="/athletics">Athletics</a>
  <a href="/lunch-menu">Lunch Menu</a>
</body></html>
"""

DIRECTORY = """
<table>
 <tr><td>Jane Doe</td><td>Head Volleyball Coach</td>
     <td><a href="mailto:jane.doe@gcpsk12.org">jane.doe@gcpsk12.org</a></td></tr>
 <tr><td>John Roe</td><td>Assistant Football Coach</td>
     <td><a href="mailto:john.roe@gcpsk12.org">john.roe@gcpsk12.org</a></td></tr>
 <tr><td>Ann Poe</td><td>Head Soccer Coach</td>
     <td><a href="mailto:ann.poe@gcpsk12.org">ann.poe@gcpsk12.org</a></td></tr>
</table>
"""

STYLED_404 = "<html><body><h1>Page Not Found</h1><p>Sorry.</p></body></html>"


def test_score_link_prefers_staff_directory():
    hi = discover_hs.score_link("Staff Directory", "/athletics/staff-directory")
    lo = discover_hs.score_link("Lunch Menu", "/lunch-menu")
    if hi <= lo:
        FAILURES.append(f"staff directory should outscore lunch menu: {hi} vs {lo}")


def test_best_staff_links_orders_by_score():
    links = discover_hs.best_staff_links(NAV, "https://x.org")
    check("best link is the staff directory", links[0],
          "https://x.org/athletics/staff-directory")


def test_looks_like_directory_accepts_real_page():
    check("real directory accepted", discover_hs.looks_like_directory(DIRECTORY), True)


def test_looks_like_directory_rejects_styled_404():
    check("styled 404 rejected", discover_hs.looks_like_directory(STYLED_404), False)


FS_DIR = """
<div class="fsConstituentItem" data-constituent-id="17178">
  <h3 class="fsFullName"> Yeshi Abzgi </h3>
  <div class="fsTitles"><strong>Titles:</strong> Custodian </div>
  <div class="fsEmail"><strong>Email: </strong><div id="fsEmail-275112-14869-directory">
    <script type="text/javascript">setTimeout(function(){ FS.util.insertEmail("fsEmail-275112-14869-directory", "gro.21kspcg", "igzba.ihsey", false); }, 20);</script>
  </div></div>
</div>
<div class="fsConstituentItem" data-constituent-id="21606">
  <h3 class="fsFullName"> Cory Cason </h3>
  <div class="fsTitles"><strong>Titles:</strong> Tchr Health &amp; PE </div>
  <div class="fsEmail"><strong>Email: </strong><div id="fsEmail-275112-19297-directory">
    <script type="text/javascript">setTimeout(function(){ FS.util.insertEmail("fsEmail-275112-19297-directory", "gro.21kspcg", "nosac.yroc", false); }, 20);</script>
  </div></div>
</div>
"""

PLAIN_PAGE = "<table><tr><td>Jane Doe</td><td>jane@x.org</td></tr></table>"


def test_decode_email_reverses_both_halves():
    check("brookwood custodian",
          finalsite.decode_email("gro.21kspcg", "igzba.ihsey"),
          "yeshi.abzgi@gcpsk12.org")
    check("coach", finalsite.decode_email("gro.21kspcg", "nosac.yroc"),
          "cory.cason@gcpsk12.org")
    check("blank halves yield nothing", finalsite.decode_email("", ""), "")
    check("half blank yields nothing", finalsite.decode_email("gro.x", ""), "")


def test_detect_fires_only_on_finalsite():
    check("real finalsite markup", finalsite.Finalsite().detect(FS_DIR), True)
    check("a plain table is not finalsite",
          finalsite.Finalsite().detect(PLAIN_PAGE), False)
    check("empty", finalsite.Finalsite().detect(""), False)


def test_parse_recovers_name_title_and_decoded_address():
    recs = finalsite.Finalsite().parse(FS_DIR, {})
    check("two people", len(recs), 2)
    by = {r.email: r for r in recs}
    check("custodian name", by["yeshi.abzgi@gcpsk12.org"].name, "Yeshi Abzgi")
    check("custodian title", by["yeshi.abzgi@gcpsk12.org"].title, "Custodian")
    check("coach name", by["cory.cason@gcpsk12.org"].name, "Cory Cason")
    check("entities unescaped in title",
          by["cory.cason@gcpsk12.org"].title, "Tchr Health & PE")
    check("platform stamped", by["cory.cason@gcpsk12.org"].platform, "finalsite")


def test_parse_invents_nothing_when_the_address_is_absent():
    # A constituent with a name and a title but NO insertEmail call yields no
    # row. There is no path from a name to an address, by design.
    no_addr = """
    <div class="fsConstituentItem">
      <h3 class="fsFullName"> Ghost Person </h3>
      <div class="fsTitles"><strong>Titles:</strong> Head Football Coach </div>
    </div>
    """
    check("no address, no row", finalsite.Finalsite().parse(no_addr, {}), [])


def test_query_urls():
    check("search by surname",
          finalsite.search_url("https://x.gcpsk12.org/directory", "Fowler"),
          "https://x.gcpsk12.org/directory?const_search_last_name=Fowler")
    check("search url-encodes",
          finalsite.search_url("https://x.org/d", "O'Brien"),
          "https://x.org/d?const_search_last_name=O%27Brien")
    check("pagination",
          finalsite.page_url("https://x.gcpsk12.org/directory", 2),
          "https://x.gcpsk12.org/directory?const_page=2")
    check("existing query string is preserved",
          finalsite.page_url("https://x.org/d?a=1", 3),
          "https://x.org/d?a=1&const_page=3")


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
