"""High-school crawl constants.

Separate from the college package's config.py on purpose -- see _shared.py.
"""

from __future__ import annotations

# Link text that indicates a staff or athletics page on a school/district site.
# Ordered by how strongly each implies "this page lists people with emails".
STAFF_LINK_WORDS = [
    ("staff directory", 10), ("coaching staff", 10), ("coaches", 8),
    ("athletics staff", 8), ("directory", 6), ("athletics", 5),
    ("sports", 4), ("teams", 4), ("activities", 3), ("staff", 3),
]

# Path suffixes worth trying directly when link scoring finds nothing.
STAFF_PATHS = [
    "/staff-directory", "/athletics/staff-directory", "/athletics/coaches",
    "/coaches", "/directory", "/athletics", "/our-staff", "/staff",
]

# A page must contain at least this many addresses to be treated as a directory.
MIN_EMAILS_FOR_DIRECTORY = 3

# Entropy gate: if one local-part appears at more than this many distinct
# domains in an output file, the file is rejected. performance@ appeared at 24.
MAX_DOMAINS_PER_LOCAL_PART = 3

# Politeness. The college crawl ran at this and drew no complaints.
DELAY_PER_DOMAIN = 1.5
