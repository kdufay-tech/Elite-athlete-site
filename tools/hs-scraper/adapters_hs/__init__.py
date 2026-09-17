"""Adapter registry: most specific first, generic last.

Order is the whole contract. Each adapter's detect() is asked in turn and the
first to claim the page wins, so a specific adapter must come BEFORE the generic
one -- the generic answers True for any page carrying three addresses, so placed
first it would claim everything and no specific adapter would ever run.

GenericHS is also the fallback when nobody claims the page. Lowest priority and
last resort are the same position, which is why one list expresses both.
"""

from adapters.base import Adapter, CoachRecord, emails_in  # noqa: F401
from .finalsite import Finalsite
from .generic import GenericHS

ADAPTERS: list = [Finalsite(), GenericHS()]


def adapter_for(html: str) -> Adapter:
    for adapter in ADAPTERS:
        if adapter.detect(html):
            return adapter
    return ADAPTERS[-1]


__all__ = ["Adapter", "CoachRecord", "emails_in",
           "Finalsite", "GenericHS", "ADAPTERS", "adapter_for"]
