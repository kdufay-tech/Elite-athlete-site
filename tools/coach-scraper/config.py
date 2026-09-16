"""Static configuration: sports, divisions, and crawl policy.

Kept deliberately declarative so the interesting decisions live in one
readable place rather than scattered through the adapters.
"""

# The five sports this collector targets. Values match normSport() in
# netlify/functions/coach-contacts-import.js so rows import without translation.
SPORTS = ("football", "basketball", "soccer", "volleyball", "hockey")

# Category headings on a staff directory -> canonical sport.
# Ordered longest-first at match time so "beach volleyball" cannot be swallowed
# by "volleyball" and men's/women's variants stay distinguishable.
SPORT_PATTERNS = {
    "football": [r"\bfootball\b"],
    "basketball": [r"\bbasketball\b", r"\bmbb\b", r"\bwbb\b"],
    "soccer": [r"\bsoccer\b", r"\bfutbol\b"],
    "volleyball": [r"\bvolleyball\b", r"\bvball\b", r"\bbeach volleyball\b"],
    "hockey": [r"\bice hockey\b", r"\bhockey\b"],
}

# Sports we explicitly do NOT want, listed so that a category like
# "Field Hockey" is rejected rather than folded into "hockey" by accident.
SPORT_EXCLUSIONS = [
    r"\bfield hockey\b",     # a different sport from ice hockey
    r"\bflag football\b",
]

DIVISIONS = ("D1", "D2", "D3", "NAIA", "JUCO")

# level column in coach_contacts; normLevel() collapses all college tiers to
# "college", so the specific tier travels in `classification`.
LEVEL = "college"

# ---- crawl policy -------------------------------------------------------
# Honest identification: a real contact address so any sysadmin who wonders
# what is hitting them can ask, rather than just blocking.
USER_AGENT = (
    "EliteAthleteCoachDirectory/1.0 "
    "(+https://eliteathlete.app; contact: support@taratechent.com)"
)
REQUEST_TIMEOUT = 30          # seconds
DELAY_PER_DOMAIN = 1.0        # seconds between requests to the SAME host
# Concurrency across DIFFERENT hosts. The 1 req/sec limit is per host, so
# workers never speed up requests to any single school -- they stop 1,900
# unrelated schools from queueing behind each other. Sequentially a full
# five-tier crawl runs ~8 hours; at 12 workers it is well under an hour.
MAX_WORKERS = 12
MAX_RETRIES = 3
BACKOFF_BASE = 2.0            # seconds; doubled each retry
RESPECT_ROBOTS = True

# Staff-directory paths to try, in order. Sidearm uses the first; the rest
# cover Presto/WMT/older builds. One HTTP request each until one returns a
# page that actually parses.
STAFF_PATHS = (
    "/staff-directory",
    "/staff.aspx",
    "/staff",
    "/information/directory",
    "/sports/2023/6/15/directory",
    "/directory",
)

# Pages likely to carry the athletics department mailing address.
CONTACT_PATHS = ("/contact-us", "/contact", "/information/contact")
