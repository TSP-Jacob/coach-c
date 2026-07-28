"""Industry mode — a per-organization setting that drives terminology.

Kept intentionally tiny and dependency-free: the frontend owns the display
labels (see frontend/lib/industry.ts); the backend only needs enough to describe
the professional to the assistant ("home services professional" vs "real estate
agent") and to normalize/validate the stored value.
"""
from __future__ import annotations

INDUSTRY_MODES = ("home_services", "real_estate")
DEFAULT_MODE = "home_services"

# Per-mode language for the assistant's system prompts.
_TERMS = {
    "home_services": {"professional": "home services professional", "domain": "home services"},
    "real_estate":   {"professional": "real estate agent",          "domain": "real estate"},
}


def normalize_mode(mode: str | None) -> str:
    """Coerce any stored/incoming value to a supported mode."""
    return mode if mode in INDUSTRY_MODES else DEFAULT_MODE


def terms(mode: str | None) -> dict:
    return _TERMS[normalize_mode(mode)]


def assistant_descriptor(mode: str | None) -> str:
    """How the assistant should refer to the user, e.g. 'a {descriptor}'."""
    return terms(mode)["professional"]


def domain(mode: str | None) -> str:
    return terms(mode)["domain"]
