#!/usr/bin/env python3
"""
Clean photo cache by removing entries that have no photos or match specific criteria.

Usage:
    python3 scripts/clean_photo_cache.py               # remove None/empty entries
    python3 scripts/clean_photo_cache.py --address "123 Main St"  # remove specific address
"""

import argparse
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
CACHE_FILE = PROJECT_ROOT / "data" / "photo_urls_cache.json"
DASHBOARD_DATA = PROJECT_ROOT / "data" / "dashboard_data.json"


def clean_cache(address_pattern=None, remove_empty=True):
    """Remove entries from photo cache based on criteria."""

    if not CACHE_FILE.exists():
        print("No photo cache found.")
        return

    with open(CACHE_FILE) as f:
        cache = json.load(f)

    original_count = len(cache)
    removed = []

    # Build set of redfin URLs to check
    to_remove = set()

    if remove_empty:
        # Remove None or empty photo lists
        for url, photos in cache.items():
            if photos is None or (isinstance(photos, list) and len(photos) == 0):
                to_remove.add(url)
                removed.append(f"{url} (empty)")

    if address_pattern:
        # Remove entries matching address pattern
        # Need to check dashboard_data to map addresses to URLs
        if DASHBOARD_DATA.exists():
            with open(DASHBOARD_DATA) as f:
                data = json.load(f)

            for home in data.get('sold_homes', []) + data.get('active_listings', []):
                addr = home.get('address', '')
                url = home.get('redfin_url', '')
                if address_pattern.lower() in addr.lower() and url in cache:
                    to_remove.add(url)
                    removed.append(f"{url} ({addr})")

    # Remove identified entries
    for url in to_remove:
        del cache[url]

    # Save cleaned cache
    with open(CACHE_FILE, 'w') as f:
        json.dump(cache, f, indent=2)

    print(f"Removed {len(removed)} entries from photo cache:")
    for entry in removed[:20]:
        print(f"  - {entry}")
    if len(removed) > 20:
        print(f"  ... and {len(removed) - 20} more")
    print(f"\nCache before: {original_count} entries")
    print(f"Cache after:  {len(cache)} entries")
    print(f"\nNext: Run 'python3 scripts/build_dashboard_data.py' to refetch")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Clean photo cache')
    parser.add_argument('--address', help='Remove entries matching this address pattern')
    parser.add_argument('--no-empty', action='store_true', help='Do not remove None/empty entries')
    args = parser.parse_args()

    clean_cache(
        address_pattern=args.address,
        remove_empty=not args.no_empty
    )
