#!/usr/bin/env python3
"""
Pipeline state tracker — records when each data tier was last updated
and determines whether a tier is due for refresh based on its cadence.
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path

STATE_FILE = Path(__file__).parent.parent / "data" / "pipeline_state.json"

# Default cadences (hours)
DEFAULT_CADENCES = {
    "market_trends":    336,   # ~2 weeks
    "sold_homes":       24,    # daily
    "active_listings":  12,    # twice daily
}


def _load():
    """Load the state file, or return empty dict if missing."""
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def _save(state):
    """Save the state file."""
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def record_update(tier):
    """Record that a tier was just updated."""
    state = _load()
    state[tier] = {
        "last_run": datetime.now().isoformat(),
        "cadence_hours": DEFAULT_CADENCES.get(tier, 24),
    }
    _save(state)


def is_stale(tier):
    """Check whether a tier is due for an update."""
    state = _load()
    entry = state.get(tier)
    if not entry or not entry.get("last_run"):
        return True  # never run
    try:
        last = datetime.fromisoformat(entry["last_run"])
        cadence = entry.get("cadence_hours", DEFAULT_CADENCES.get(tier, 24))
        return datetime.now() - last > timedelta(hours=cadence)
    except (ValueError, TypeError):
        return True


def get_stale_tiers():
    """Return list of tier names that are due for an update."""
    return [t for t in DEFAULT_CADENCES if is_stale(t)]


def get_freshness():
    """Return a dict of tier -> last_run ISO string, for dashboard display."""
    state = _load()
    return {
        tier: state.get(tier, {}).get("last_run")
        for tier in DEFAULT_CADENCES
    }
