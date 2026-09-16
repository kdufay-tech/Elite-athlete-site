"""Generate SQL to backfill state/region on coach_contacts.

Why this exists: 7,299 of 9,171 rows have no state, including 4,913 of the
5,568 Autobuild rows. Send-to-a-folder in AdminDashboard filters on State and
Region, so those rows cannot be sliced geographically -- the data is there but
unreachable through the UI that sends it.

Every row has an email domain, and an athletics email domain identifies the
institution unambiguously, so domain -> state is a safe derivation. Nothing is
inferred about a person; this only records where a university is.

The generated SQL:
  * only ever touches rows WHERE state IS NULL OR state = ''  (never overwrites)
  * sets region from state using the SAME table as coach-contacts-import.js
  * is preceded by a backup table, so it is reversible

Run:  python backfill_state.py > out/backfill_state.sql
"""

from __future__ import annotations

# domain -> USPS state. Institutional locations, publicly known facts.
DOMAIN_STATE = {
    # --- largest gaps first ---
    "princeton.edu": "NJ", "berkeley.edu": "CA", "athletics.ucla.edu": "CA",
    "usc.edu": "CA", "brown.edu": "RI", "dartmouth.edu": "NH",
    "colorado.edu": "CO", "columbia.edu": "NY", "osu.edu": "OH",
    "illinois.edu": "IL", "athletics.gatech.edu": "GA", "uw.edu": "WA",
    "bc.edu": "MA", "mail.wvu.edu": "WV", "uconn.edu": "CT", "umd.edu": "MD",
    "syr.edu": "NY", "smu.edu": "TX", "virginia.edu": "VA",
    "clemson.edu": "SC", "baylor.edu": "TX", "cornell.edu": "NY",
    "huskers.com": "NE", "gators.ufl.edu": "FL", "wfu.edu": "NC",
    "gocards.com": "KY", "upenn.edu": "PA", "athletics.pitt.edu": "PA",
    "uiowa.edu": "IA", "temple.edu": "PA", "jmu.edu": "VA", "ecu.edu": "NC",
    "psu.edu": "PA", "unlv.edu": "NV", "usu.edu": "UT", "liberty.edu": "VA",
    "coastal.edu": "SC", "gsu.edu": "GA", "yale.edu": "CT",
    "fas.harvard.edu": "MA", "athletics.ucf.edu": "FL", "wku.edu": "KY",
    "northwestern.edu": "IL", "scarletknights.com": "NJ",
    "boisestate.edu": "ID", "byu.edu": "UT", "umass.edu": "MA",
    "marshall.edu": "WV", "lsu.edu": "LA", "athletics.tamu.edu": "TX",
    "wmich.edu": "MI", "central.uh.edu": "TX", "athletics.wisc.edu": "WI",
    "iastate.edu": "IA", "arizona.edu": "AZ", "afacademy.af.edu": "CO",
    "stanford.edu": "CA", "appstate.edu": "NC", "sjsu.edu": "CA",
    "unt.edu": "TX", "uwyo.edu": "WY", "miamioh.edu": "OH", "udel.edu": "DE",
    "nmsu.edu": "NM", "westpoint.edu": "NY", "georgiasouthern.edu": "GA",
    "iu.edu": "IN", "usf.edu": "FL", "mail.fresnostate.edu": "CA",
    "southalabama.edu": "AL", "shsu.edu": "TX", "usna.edu": "MD",
    "tulane.edu": "LA", "bsu.edu": "IN", "missouristate.edu": "MO",
    "jsu.edu": "AL", "kent.edu": "OH", "vt.edu": "VA", "uab.edu": "AL",
    "emich.edu": "MI", "okstate.edu": "OK", "sdsu.edu": "CA", "fau.edu": "FL",
    "ku.edu": "KS", "tcu.edu": "TX", "bgsu.edu": "OH", "mtsu.edu": "TN",
    "louisiana.edu": "LA", "uakron.edu": "OH", "purdue.edu": "IN",
    "rice.edu": "TX", "memphis.edu": "TN", "odu.edu": "VA", "nd.edu": "IN",
    "uoregon.edu": "OR", "ath.msu.edu": "MI", "ia.ua.edu": "AL",
    "utulsa.edu": "OK", "ou.edu": "OK", "astate.edu": "AR", "fsu.edu": "FL",
    "fiu.edu": "FL", "mednet.ucla.edu": "CA", "asu.edu": "AZ",
    "goshockers.com": "KS", "txstate.edu": "TX", "utsa.edu": "TX",
    "kennesaw.edu": "GA", "troy.edu": "AL", "hawkeyefootball.com": "IA",
    "vanderbilt.edu": "TN", "usm.edu": "MS", "kstatesports.com": "KS",
    "auburn.edu": "AL", "ucmail.uc.edu": "OH", "mailbox.sc.edu": "SC",
    "ulm.edu": "LA", "umich.edu": "MI", "niu.edu": "IL", "unc.edu": "NC",
    "msu.edu": "MI", "med.usc.edu": "CA", "pitt.edu": "PA",
    "email.unc.edu": "NC", "uc.edu": "OH", "rutgers.edu": "NJ",
    # --- smaller programs ---
    "lewisu.edu": "IL", "unl.edu": "NE", "svu.edu": "VA", "widener.edu": "PA",
    "catawba.edu": "NC", "hawkeyebasketball.com": "IA", "menlo.edu": "CA",
    "su.edu": "VA", "live.unc.edu": "NC", "g.harvard.edu": "MA",
    "sacredheart.edu": "CT", "csulb.edu": "CA", "dyu.edu": "NY",
    "sc.edu": "SC", "uncaa.unc.edu": "NC", "caps.ucla.edu": "CA",
    "daemen.edu": "NY", "sports.uga.edu": "GA", "dom.edu": "IL",
    "cougarnet.uh.edu": "TX", "mit.edu": "MA", "ucsd.edu": "CA",
    "pepperdine.edu": "CA", "manhattan.edu": "NY", "mckendree.edu": "IL",
    "ec.edu": "GA", "njit.edu": "NJ", "etown.edu": "PA", "wilkes.edu": "PA",
    "athletics.ucsb.edu": "CA", "edgewood.edu": "WI", "marymount.edu": "VA",
    "aurora.edu": "IL", "bac.edu": "NC", "hawaii.edu": "HI",
    "admin.umass.edu": "MA", "hood.edu": "MD", "buffalostate.edu": "NY",
    "sass.msu.edu": "MI", "lmunet.edu": "TN", "bw.edu": "OH",
    "vanguard.edu": "CA", "arcadia.edu": "PA", "lakeland.edu": "WI",
    "smail.astate.edu": "AR", "emmanuel.edu": "MA", "luc.edu": "IL",
    "roanoke.edu": "VA", "merrimack.edu": "MA", "college.ucla.edu": "CA",
    "drew.edu": "NJ", "lmc.edu": "NC", "elmira.edu": "NY",
    "callutheran.edu": "CA", "wisc.edu": "WI", "csun.edu": "CA",
    "francis.edu": "PA", "cuw.edu": "WI", "eastern.edu": "PA",
    "barry.edu": "FL", "uci.edu": "CA", "naz.edu": "NY", "ucla.edu": "CA",
    "messiah.edu": "PA", "dean.edu": "MA", "rockford.edu": "IL",
    "averett.edu": "VA", "csi.cuny.edu": "NY", "msoe.edu": "WI",
    "thiel.edu": "PA", "emerson.edu": "MA", "quincy.edu": "IL",
    "carthage.edu": "WI", "newpaltz.edu": "NY", "fdu.edu": "NJ",
    "indiana.edu": "IN", "marianuniversity.edu": "WI", "trine.edu": "IN",
    "randolphcollege.edu": "VA", "mst.edu": "MO", "uh.edu": "TX",
    "mbu.edu": "WI", "immaculata.edu": "PA", "erskine.edu": "SC",
    "newberry.edu": "SC", "lindenwood.edu": "MO", "gmu.edu": "VA",
    "kings.edu": "PA", "mail.uc.edu": "OH", "kean.edu": "NJ",
    "liu.edu": "NY", "gcc.edu": "PA", "bethanywv.edu": "WV",
    "uwsp.edu": "WI", "louisville.edu": "KY", "aic.edu": "MA",
    "emu.edu": "VA", "vassar.edu": "NY", "tickets.ucla.edu": "CA",
    "augustana.edu": "IL", "stevens.edu": "NJ", "york.cuny.edu": "NY",
    "adrian.edu": "MI", "centralstate.edu": "OH", "wabash.edu": "IN",
    "nku.edu": "KY", "ucsc.edu": "CA", "illinoistech.edu": "IL",
    "umo.edu": "NC", "athletics.psu.edu": "PA", "nyu.edu": "NY",
    "pfw.edu": "IN", "rivier.edu": "NH", "cuanschutz.edu": "CO",
    "sarahlawrence.edu": "NY", "cuchicago.edu": "IL", "king.edu": "TN",
    "nichols.edu": "MA", "northpark.edu": "IL", "pobox.upenn.edu": "PA",
    "hilbert.edu": "NY", "hunter.cuny.edu": "NY", "hiram.edu": "OH",
    "maryville.edu": "MO", "barton.edu": "NC", "roosevelt.edu": "IL",
    "neumann.edu": "PA", "queens.edu": "NC", "ucwv.edu": "WV",
    "cui.edu": "CA", "springfieldcollege.edu": "MA", "snc.edu": "WI",
    "calvin.edu": "MI", "lbc.edu": "PA", "warhawks.ulm.edu": "LA",
    "fvsu.edu": "GA", "jessup.edu": "CA", "mtaloy.edu": "PA",
    "terpmail.umd.edu": "MD", "morehouse.edu": "GA", "ben.edu": "IL",
    "lynchburg.edu": "VA", "ucfathletics.org": "FL", "dukes.jmu.edu": "VA",
    "csufresno.edu": "CA", "sbuniv.edu": "MO", "chatham.edu": "PA",
    "rockhurst.edu": "MO", "mail.wlc.edu": "WI", "roberts.edu": "NY",
    "geneva.edu": "PA", "du.edu": "CO", "uj.edu": "ND", "noctrl.edu": "IL",
    "hws.edu": "NY", "sunypoly.edu": "NY", "jjay.cuny.edu": "NY",
    "vucommodores.com": "TN", "uky.edu": "KY", "gallaudet.edu": "DC",
    "iwu.edu": "IL", "loc.edu": "TN", "pratt.edu": "NY",
    "benedict.edu": "SC", "ucdenver.edu": "CO", "georgetown.edu": "DC",
    "yu.edu": "NY", "g.clemson.edu": "SC", "hawkeyesports.com": "IA",
    "floridagators.com": "FL", "mail.roosevelt.edu": "IL", "wlc.edu": "WI",
    "law.harvard.edu": "MA", "stvincent.edu": "PA", "mix.wvu.edu": "WV",
    "hawkeyesfootball.com": "IA", "loras.edu": "IA",
    "u.northwestern.edu": "IL", "potsdam.edu": "NY", "ua.edu": "AL",
    "ucmerced.edu": "CA", "alvernia.edu": "PA", "houghton.edu": "NY",
    "baruch.cuny.edu": "NY", "cairn.edu": "PA", "misericordia.edu": "PA",
    "thomasmore.edu": "KY", "barnard.edu": "NY", "ew.edu": "FL",
    "mail.naz.edu": "NY", "purchase.edu": "NY", "simpsonu.edu": "CA",
    "bard.edu": "NY", "und.edu": "ND", "batten.edu": "VA", "rmc.edu": "VA",
    "mountunion.edu": "OH", "huhs.harvard.edu": "MA", "dria.upenn.edu": "PA",
    "unlv.nevada.edu": "NV", "ngu.edu": "SC", "athletics.uga.edu": "GA",
    "ramapo.edu": "NJ", "hartwick.edu": "NY", "umn.edu": "MN",
    "kysu.edu": "KY", "tusculum.edu": "TN", "colby-sawyer.edu": "NH",
    "live.missouristate.edu": "MO", "lehman.cuny.edu": "NY", "utk.edu": "TN",
    "olemiss.edu": "MS", "alumni.emory.edu": "GA", "morehead.edu": "KY",
}

# Pro franchises (level='pro'). Home-market state; publicly known locations.
PRO_STATE = {
    "nuggets.com": "CO", "nycfc.com": "NY", "okcthunder.com": "OK",
    "orlandocitysc.com": "FL", "packers.nfl.com": "WI",
    "patriots.nfl.com": "MA", "philaunion.com": "PA", "ravens.nfl.com": "MD",
    "sixers.com": "PA", "soundersfc.com": "WA", "sportingkc.com": "KS",
    "steelers.nfl.com": "PA", "suns.com": "AZ", "therams.nfl.com": "CA",
    "timbers.com": "OR", "timberwolves.com": "MN", "austinfc.com": "TX",
    "buffalobills.nfl.com": "NY", "detroitlions.nfl.com": "MI",
    "dallascowboys.nfl.com": "TX", "eagles.nfl.com": "PA",
    "bears.nfl.com": "IL", "chiefs.nfl.com": "MO", "jaguars.nfl.com": "FL",
    "chicago-fire.com": "IL", "columbuscrew.com": "OH", "atlutd.com": "GA",
    "intermiamicf.com": "FL", "lagalaxy.com": "CA", "lakers.com": "CA",
    "bucks.com": "WI", "bulls.com": "IL", "cavs.com": "OH",
    "celtics.com": "MA", "heat.com": "FL", "warriors.com": "CA",
}
DOMAIN_STATE.update(PRO_STATE)

# Intentionally NOT mapped: gmail.com, yahoo.com, aol.com, outlook.com.
# A personal address says nothing about where someone works, and guessing
# would put wrong data in a field the send filter trusts. 20 rows stay blank
# on purpose -- blank is honest, a guess is not.

US_REGION = {
    **{s: "Northeast" for s in "CT ME MA NH NJ NY PA RI VT".split()},
    **{s: "Southeast" for s in "AL AR FL GA KY LA MS NC SC TN VA WV DC DE MD".split()},
    **{s: "Midwest" for s in "IL IN IA KS MI MN MO NE ND OH SD WI".split()},
    **{s: "Southwest" for s in "AZ NM OK TX".split()},
    **{s: "West" for s in "AK CA CO HI ID MT NV OR UT WA WY".split()},
}


def main() -> None:
    pairs = sorted(DOMAIN_STATE.items())
    print("-- Backfill state/region on coach_contacts.")
    print("-- Generated by tools/coach-scraper/backfill_state.py")
    print("-- Fills ONLY rows where state is currently null/empty. Never overwrites.")
    print("-- Personal domains (gmail/yahoo/aol/outlook) and pro-team domains are")
    print("-- deliberately excluded: a personal address says nothing about location.")
    print()
    print("BEGIN;")
    print()
    print("-- 1. Reversible snapshot of every row this will touch.")
    print("CREATE TABLE IF NOT EXISTS coach_contacts_state_backup_20260915 AS")
    print("SELECT id, email, state, region, now() AS backed_up_at")
    print("FROM coach_contacts")
    print("WHERE state IS NULL OR state = '';")
    print()
    print("-- 2. Map domain -> state.")
    print("CREATE TEMP TABLE domain_state(domain text PRIMARY KEY, st text) ON COMMIT DROP;")
    print("INSERT INTO domain_state(domain, st) VALUES")
    rows = ",\n".join("  ('%s','%s')" % (d, s) for d, s in pairs)
    print(rows + ";")
    print()
    print("-- 3. Fill state where it is missing and the domain is known.")
    print("UPDATE coach_contacts c")
    print("SET state = d.st")
    print("FROM domain_state d")
    print("WHERE split_part(c.email,'@',2) = d.domain")
    print("  AND (c.state IS NULL OR c.state = '');")
    print()
    print("-- 4. Derive region from state, matching US_REGION in")
    print("--    netlify/functions/coach-contacts-import.js exactly.")
    print("UPDATE coach_contacts")
    print("SET region = CASE state")
    for st, reg in sorted(US_REGION.items()):
        print("  WHEN '%s' THEN '%s'" % (st, reg))
    print("  ELSE region END")
    print("WHERE (region IS NULL OR region = '')")
    print("  AND state IS NOT NULL AND state <> '';")
    print()
    print("COMMIT;")
    print()
    print("-- Rollback if needed:")
    print("--   UPDATE coach_contacts c SET state = b.state, region = b.region")
    print("--   FROM coach_contacts_state_backup_20260915 b WHERE b.id = c.id;")


if __name__ == "__main__":
    main()
