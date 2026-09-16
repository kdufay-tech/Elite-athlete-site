"""Adapter chain: first adapter that recognises the page wins.

Order is significant. Specific platforms are tried before the generic
fallback, which claims every page.
"""

from .base import Adapter, CoachRecord, emails_in
from .sidearm import SidearmAdapter
from .wmt import WmtAdapter
from .presto import PrestoAdapter
from .generic import GenericAdapter

ADAPTERS: list[Adapter] = [SidearmAdapter(), WmtAdapter(), PrestoAdapter(), GenericAdapter()]


def detect_platform(html: str) -> str:
    for adapter in ADAPTERS:
        if adapter.detect(html):
            return adapter.name
    return "generic"


def adapter_for(html: str) -> Adapter:
    for adapter in ADAPTERS:
        if adapter.detect(html):
            return adapter
    return ADAPTERS[-1]


__all__ = ["Adapter", "CoachRecord", "emails_in", "SidearmAdapter", "WmtAdapter",
           "PrestoAdapter", "GenericAdapter",
           "ADAPTERS", "detect_platform", "adapter_for"]
