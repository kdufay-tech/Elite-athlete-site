"""Tests for the parts that are easy to get subtly wrong.

Run: python tests.py

Deliberately dependency-free (no pytest) so it runs anywhere the scraper does.
Every case here comes from something that actually appeared in real data or
actually broke during development -- these are regressions, not decoration.
"""

from __future__ import annotations

import sys
import traceback

import address
import filters
import normalize
from adapters.base import emails_in

FAILURES: list[str] = []


def check(label: str, got, want):
    if got != want:
        FAILURES.append(f"{label}\n      got:  {got!r}\n      want: {want!r}")


def section(name: str):
    print(f"\n-- {name}")


# --------------------------------------------------------------------------
def test_email_recovery():
    section("email recovery")

    # The Sidearm split-variable form. This is the whole reason the scraper
    # does not need a headless browser.
    sidearm = '''
      var placeholder = document.getElementById("staff_email_3");
      var firstHalf = "beckeker";
      var secondHalf = "gvsu.edu";
      placeholder.href = 'mailto:' + firstHalf + '@' + secondHalf;
    '''
    check("split-variable email", emails_in(sidearm), ["beckeker@gvsu.edu"])

    # Apostrophes really do occur: angelosports.com publishes tyler.o'bryan.
    # We report what the page says rather than "correcting" it, because
    # silently altering a scraped address is how fabricated lists start.
    apos = 'var firstHalf = "tyler.o\'bryan"; var secondHalf = "angelo.edu";'
    check("apostrophe preserved", emails_in(apos), ["tyler.o'bryan@angelo.edu"])

    check("plain mailto", emails_in('<a href="mailto:Coach@School.EDU">x</a>'),
          ["coach@school.edu"])
    check("no email", emails_in("<p>nothing here</p>"), [])

    # A bare address is only used when nothing better exists, and asset paths
    # must not survive it.
    check("dedupes", emails_in('mailto:a@b.com mailto:a@b.com'), ["a@b.com"])


def test_sport_folding():
    section("sport folding")

    check("football", normalize.fold_sport("Football"), "football")
    check("mens basketball", normalize.fold_sport("Men's Basketball"), "basketball")
    check("womens soccer", normalize.fold_sport("Women's Soccer"), "soccer")
    check("volleyball", normalize.fold_sport("Women's Volleyball"), "volleyball")
    check("ice hockey", normalize.fold_sport("Men's Ice Hockey"), "hockey")

    # The two exclusions that a naive substring match gets wrong. Field hockey
    # is a different sport from ice hockey, and would otherwise be swept in by
    # the word "hockey".
    check("field hockey excluded", normalize.fold_sport("Field Hockey"), "")
    check("flag football excluded", normalize.fold_sport("Flag Football"), "")

    check("unrelated sport", normalize.fold_sport("Baseball"), "")
    check("admin category", normalize.fold_sport("Front Office"), "")

    # Gendered headings are preserved separately -- they are different programs.
    check("sport detail kept", normalize.sport_detail("Women's  Soccer"),
          "Women's Soccer")


def test_name_splitting():
    section("name splitting")

    check("simple", normalize.split_name("Cornell Mann"), ("Cornell", "Mann"))
    # Sidearm emits double spaces from empty middle-name fields.
    check("double space", normalize.split_name("Keri  Becker"), ("Keri", "Becker"))
    check("honorific", normalize.split_name("Dr. D.F. Arnold"), ("D.F.", "Arnold"))
    check("suffix", normalize.split_name("Robert Downey Jr."), ("Robert", "Downey"))
    check("three parts", normalize.split_name("Mary Anne Smith"), ("Mary", "Smith"))
    check("single name", normalize.split_name("Cher"), ("Cher", ""))
    check("empty", normalize.split_name(""), ("", ""))


def test_phone_and_email_cleaning():
    section("phone / email cleaning")

    check("parens", normalize.clean_phone("(616) 331-3233"), "(616) 331-3233")
    check("dashes", normalize.clean_phone("616-331-3205"), "(616) 331-3205")
    check("leading 1", normalize.clean_phone("1-616-331-3205"), "(616) 331-3205")
    check("too short", normalize.clean_phone("331-3205"), "")
    check("junk", normalize.clean_phone("n/a"), "")

    check("lowercased", normalize.clean_email("  Coach@School.EDU "), "coach@school.edu")
    check("asset path rejected", normalize.clean_email("logo@2x.png"), "")
    check("not an email", normalize.clean_email("not-an-email"), "")


def test_filter_precedence():
    section("filter precedence")

    # Defaults: core coaching staff only.
    filters.INCLUDE_GRAD_ASSTS = False
    filters.INCLUDE_VOLUNTEER = False
    filters.INCLUDE_STRENGTH = False
    filters.INCLUDE_OPERATIONS = False

    keep = lambda t: filters.is_target_coach(t, "Football", "football")

    check("head coach", keep("Head Coach"), True)
    check("assistant coach", keep("Assistant Coach"), True)
    check("coordinator", keep("Offensive Coordinator/Quarterbacks"), True)
    check("student manager", keep("Student Manager"), False)
    check("chaplain", keep("Team Chaplin"), False)

    # These CONTAIN "head coach", so HEAD_COACH matches them unless they are
    # rejected explicitly. Real rows from auburntigers.com.
    check("exec assistant to HC", keep("Executive Assistant to the Head Coach"), False)
    check("admin assistant", keep("Administrative Assistant, Football"), False)
    check("assistant to the HC", keep("Assistant to the Head Coach"), False)
    check("academic advisor", keep("Academic Advisor - Football"), False)
    check("ticket office", keep("Ticket Sales Coach Liaison"), False)

    # The regression that mattered: every one of these contains the word
    # "coach", so a trailing generic fallback let them all through regardless
    # of how the switches were set. Eight real rows leaked this way.
    check("grad assistant off", keep("Graduate Assistant Football Coach - Offense"), False)
    check("volunteer off", keep("Volunteer Assistant Coach"), False)
    check("strength off", keep("Director of Sports Performance"), False)
    check("operations off", keep("Director of Operations"), False)

    # A head coach is kept even when the title also names a discretionary role.
    check("combined title", keep("Head Coach & Director of Operations"), True)

    # Switches must work in the positive direction too.
    filters.INCLUDE_GRAD_ASSTS = True
    filters.INCLUDE_STRENGTH = True
    check("grad assistant on", keep("Graduate Assistant Football Coach - Offense"), True)
    check("strength on", keep("Director of Sports Performance"), True)
    check("volunteer still off", keep("Volunteer Assistant Coach"), False)

    filters.INCLUDE_GRAD_ASSTS = False
    filters.INCLUDE_STRENGTH = False

    # No sport attributed means no row, whatever the title says.
    check("no sport", filters.is_target_coach("Head Coach", "Baseball", ""), False)


def test_address_extraction():
    section("address extraction")

    def line(text):
        return address.extract(f"<html><body>{text}</body></html>")

    # Real footer from goashlandeagles.com -- two spaces, no comma before city.
    got = line("401 College Ave.  Ashland, OH 44805")
    check("ashland line", got["address_line"], "401 College Ave.")
    check("ashland city", got["address_city"], "Ashland")
    check("ashland state", got["address_state"], "OH")
    check("ashland zip", got["address_zip"], "44805")

    # Suffix after the street type; strict pattern misses, anchored catches.
    check("avenue with suffix", line("2601 W Avenue N, San Angelo, TX 76909")["address_line"],
          "2601 W Avenue N")
    # Street type on no finite list.
    check("el camino real", line("500 El Camino Real, Santa Clara, CA 95053")["address_city"],
          "Santa Clara")
    # ZIP+4 keeps only the five-digit part.
    check("zip plus four", line("1 Campus Center Drive, Big Rapids, MI 49307-2280")["address_zip"],
          "49307")
    # A footer separator must not be swallowed into the street line.
    check("footer noise", line("Copyright 2024 | 1 Main St, Town, NY 10001")["address_line"],
          "1 Main St")

    check("no address", line("just some words here")["address_line"], "")

    # JSON-LD wins over regex when present.
    jsonld = (
        '<script type="application/ld+json">'
        '{"@type":"CollegeOrUniversity","address":{"@type":"PostalAddress",'
        '"streetAddress":"1 Campus Drive","addressLocality":"Allendale",'
        '"addressRegion":"MI","postalCode":"49401"}}'
        "</script> and also 999 Decoy Rd, Nowhere, XX 00000"
    )
    check("jsonld preferred", line(jsonld)["address_line"], "1 Campus Drive")


def test_normalize_record():
    section("record normalization")

    from adapters.base import CoachRecord

    rec = CoachRecord(name="Keri  Becker", title="Head  Coach",
                      category="Women's Volleyball", email="  KB@GVSU.EDU ",
                      phone="616-331-3233")
    out = normalize.normalize(rec)
    check("email cleaned", out.email, "kb@gvsu.edu")
    check("first name", out.first_name, "Keri")
    check("last name", out.last_name, "Becker")
    check("sport folded", out.sport, "volleyball")
    check("sport detail", out.sport_detail, "Women's Volleyball")
    check("phone normalized", out.phone, "(616) 331-3233")

    # Email is the dedupe key in coach_contacts; a row without one is unusable.
    check("no email dropped", normalize.normalize(CoachRecord(name="X", email="")), None)


def test_classification():
    section("classification")

    import classify

    # "women" contains "men" -- the word-boundary anchors must keep these apart,
    # or every women's program is mislabelled "both".
    check("womens", classify.program("Women's Soccer", ""), "womens")
    check("mens", classify.program("Men's Basketball", ""), "mens")
    # Parenthesised markers, used by several directories instead of words.
    check("(M) marker", classify.program("Basketball (M)", ""), "mens")
    check("(W) marker", classify.program("Basketball (W)", ""), "womens")
    # Football has no gendered split; blank is correct, not missing.
    check("football blank", classify.program("Football", "Head Coach"), "")

    check("head", classify.role_tier("Head Coach"), "head")
    check("coordinator", classify.role_tier("Offensive Coordinator"), "coordinator")
    check("assoc head is coord", classify.role_tier("Associate Head Coach"), "coordinator")
    check("assistant", classify.role_tier("Assistant Coach"), "assistant")
    check("other", classify.role_tier("Director of Player Personnel"), "other")

    # Region must match US_REGION in coach-contacts-import.js exactly.
    check("region MI", classify.region_for("MI"), "Midwest")
    check("region GA", classify.region_for("GA"), "Southeast")
    check("region TX", classify.region_for("TX"), "Southwest")
    check("region unknown", classify.region_for(""), "")

    # State precedence: scraped address beats registry beats school map.
    check("state from address",
          classify.state_for({"Address State": "OH", "State": "MI", "School": "X"}), "OH")
    check("state from registry",
          classify.state_for({"Address State": "", "State": "MI", "School": "X"}), "MI")
    check("state from school map",
          classify.state_for({"Address State": "", "State": "", "School": "Clemson"}), "SC")

    check("name corroborates",
          classify.name_corroborates("Cornell Mann", "manncor@gvsu.edu"), "name")
    check("initials corroborate",
          classify.name_corroborates("Ian Borders", "irb0008@auburn.edu"), "initials")
    check("departmental",
          classify.name_corroborates("Rob Ferguson", "cornellsoccer@cornell.edu"),
          "departmental")

    # Phone numbers bleeding into the category heading must not survive.
    check("phone stripped from detail",
          normalize.sport_detail("Basketball (M) 334-844-9760"), "Basketball (M)")
    check("phone label stripped",
          normalize.sport_detail("Volleyball - Phone: 828-262-2844"), "Volleyball")


def test_dedupe_keeps_richest():
    section("dedupe")

    from adapters.base import CoachRecord

    sparse = CoachRecord(email="a@b.edu", name="A Coach")
    rich = CoachRecord(email="a@b.edu", name="A Coach", title="Head Coach",
                       phone="(111) 222-3333", sport="football",
                       address_line="1 Main St")
    out = normalize.dedupe([sparse, rich])
    check("one row per email", len(out), 1)
    check("richest survives", out[0].title, "Head Coach")


def main():
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in tests:
        try:
            fn()
        except Exception:
            FAILURES.append(f"{fn.__name__} raised:\n{traceback.format_exc()}")

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURE(S):\n")
        for f in FAILURES:
            print("  x " + f)
        return 1
    print("ALL TESTS PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
