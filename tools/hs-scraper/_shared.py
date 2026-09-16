"""Put tools/coach-scraper on sys.path so its proven modules import directly.

APPENDED, never inserted at position 0. The college package has config.py and
registry.py; this package has config_hs.py and registry_hs.py precisely so the
names cannot collide, but appending is the second belt: if a same-named module
is ever added here, the local one wins.

Importing this module is a side effect by design. Import it first, before any
`import net` / `import archive` / `import normalize`.
"""

from __future__ import annotations

import sys
from pathlib import Path

COLLEGE = Path(__file__).resolve().parent.parent / "coach-scraper"

if not COLLEGE.is_dir():
    raise RuntimeError(
        f"Expected the college scraper at {COLLEGE}. This package reuses its "
        "net/archive/normalize/address/classify modules and cannot run without it."
    )

if str(COLLEGE) not in sys.path:
    sys.path.append(str(COLLEGE))
