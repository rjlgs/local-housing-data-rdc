#!/usr/bin/env python3
"""
Ingest currently active for-sale listings from Redfin for the configured metro.

Uses the same Redfin gis-csv endpoint as ingest_redfin_sold.py but with
status=1 (active for sale). Splits requests by city, property type, and
price band to stay under the 350-row-per-request limit.

Also maintains a tracker sidecar (active_listings_tracker.json) that records
when each listing was first seen, tracks price changes, and detects delistings.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, date

BASE_URL = "https://www.redfin.com/stingray/api/gis-csv"

REGION_TYPE = "6"  # city/place

# Property type groups to iterate (same as sold script)
PROPERTY_TYPE_GROUPS = [
    ("Single Family", "1"),
    ("Condo/Townhouse/Multi/Other", "2,3,4,5,6,7,8"),
]

# Price bands for further splitting if we hit the 350-row cap
PRICE_BANDS = [
    (None, 200000),
    (200000, 350000),
    (350000, 500000),
    (500000, None),
]

# Redfin CSV columns we want to keep
COLUMN_MAP = {
    "SALE TYPE": "sale_type",
    "PROPERTY TYPE": "property_type",
    "ADDRESS": "address",
    "CITY": "city",
    "STATE OR PROVINCE": "state",
    "ZIP OR POSTAL CODE": "zip_code",
    "PRICE": "list_price",
    "BEDS": "beds",
    "BATHS": "baths",
    "LOCATION": "neighborhood",
    "SQUARE FEET": "sqft",
    "LOT SIZE": "lot_size_sqft",
    "YEAR BUILT": "year_built",
    "DAYS ON MARKET": "days_on_market",
    "$/SQUARE FEET": "price_per_sqft",
    "HOA/MONTH": "hoa_monthly",
    "STATUS": "status",
    "URL (SEE https://www.redfin.com/buy-a-home/comparative-market-analysis FOR INFO ON PRICING)": "redfin_url",
    "SOURCE": "mls_source",
    "MLS#": "mls_number",
    "LATITUDE": "latitude",
    "LONGITUDE": "longitude",
}


def fetch_active(region_id, uipt, market_slug, min_price=None, max_price=None):
    """Fetch active listings CSV for a city + property type group + price band."""
    params = {
        "al": "1",
        "market": market_slug,
        "num_homes": "350",
        "ord": "redfin-recommended-asc",
        "page_number": "1",
        "region_id": region_id,
        "region_type": REGION_TYPE,
        "status": "1",  # active for sale
        "uipt": uipt,
        "v": "8",
    }
    if min_price is not None:
        params["min_price"] = str(min_price)
    if max_price is not None:
        params["max_price"] = str(max_price)

    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; housing-data-pipeline/1.0)",
    })

    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")

    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        if not row.get("ADDRESS"):
            continue
        mapped = {}
        for orig_col, new_col in COLUMN_MAP.items():
            mapped[new_col] = row.get(orig_col, "")
        rows.append(mapped)

    return rows


def fetch_city(region_id, city_name, seen, market_slug):
    """Fetch all active listings for a city, splitting by property type and price band."""
    city_rows = []

    for label, uipt in PROPERTY_TYPE_GROUPS:
        try:
            rows = fetch_active(region_id, uipt, market_slug)
        except Exception as e:
            print(f"    ERROR ({label}): {e}")
            continue

        if len(rows) >= 347:
            # Likely truncated — split by price bands
            rows = []
            for min_p, max_p in PRICE_BANDS:
                band_label = f"${min_p or 0}-${max_p or '+'}"
                try:
                    band_rows = fetch_active(region_id, uipt, market_slug, min_p, max_p)
                except Exception as e:
                    print(f"    ERROR ({label}, {band_label}): {e}")
                    continue
                rows.extend(band_rows)
                time.sleep(0.5)

        for row in rows:
            key = (row["address"], row["mls_number"])
            if key not in seen:
                seen.add(key)
                city_rows.append(row)

        time.sleep(0.5)

    return city_rows


def load_tracker(tracker_path):
    """Load the listings tracker sidecar."""
    if os.path.exists(tracker_path):
        with open(tracker_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_tracker(tracker, tracker_path):
    """Save the listings tracker sidecar."""
    with open(tracker_path, "w", encoding="utf-8") as f:
        json.dump(tracker, f, indent=2)


def update_tracker(tracker, active_rows, today_str):
    """
    Update the tracker with current active listings.
    Detects new listings, price changes, and delistings.
    Returns (new_count, price_change_count, delisted_count).
    """
    new_count = 0
    price_change_count = 0
    delisted_count = 0

    # Build set of currently active MLS numbers
    current_mls = set()

    for row in active_rows:
        mls = row.get("mls_number", "").strip()
        if not mls:
            continue
        current_mls.add(mls)

        try:
            price = int(float(row.get("list_price", "0") or "0"))
        except (ValueError, TypeError):
            price = 0

        if mls not in tracker:
            # New listing
            tracker[mls] = {
                "first_seen": today_str,
                "last_seen": today_str,
                "address": row.get("address", ""),
                "price_history": [{"date": today_str, "price": price}],
                "removed": None,
            }
            new_count += 1
        else:
            entry = tracker[mls]
            entry["last_seen"] = today_str
            entry["removed"] = None  # re-appeared if previously removed

            # Check for price change
            last_price = entry["price_history"][-1]["price"] if entry["price_history"] else None
            if price and last_price and price != last_price:
                entry["price_history"].append({"date": today_str, "price": price})
                price_change_count += 1

    # Detect delistings: entries in tracker that are no longer in current listings
    for mls, entry in tracker.items():
        if mls not in current_mls and entry.get("removed") is None:
            # Only mark as removed if it was seen recently (within last 30 days)
            # to avoid marking very old stale entries
            last_seen = entry.get("last_seen", "")
            if last_seen >= (datetime.now().replace(day=1)).strftime("%Y-%m-%d"):
                entry["removed"] = today_str
                delisted_count += 1

    return new_count, price_change_count, delisted_count


def enrich_from_tracker(rows, tracker, today_str):
    """Add tracker-derived fields to each row."""
    for row in rows:
        mls = row.get("mls_number", "").strip()
        entry = tracker.get(mls, {})

        row["first_seen"] = entry.get("first_seen", today_str)
        first = entry.get("first_seen", today_str)
        try:
            delta = (date.fromisoformat(today_str) - date.fromisoformat(first)).days
        except (ValueError, TypeError):
            delta = 0
        row["days_tracked"] = str(delta)

        # Price drop info
        history = entry.get("price_history", [])
        if len(history) >= 2:
            original = history[0]["price"]
            current = history[-1]["price"]
            row["original_price"] = str(original)
            row["price_change"] = str(current - original)
            row["price_drop_count"] = str(len(history) - 1)
        else:
            row["original_price"] = row.get("list_price", "")
            row["price_change"] = "0"
            row["price_drop_count"] = "0"


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "redfin_active.csv")
    tracker_path = os.path.join(data_dir, "active_listings_tracker.json")

    with open(os.path.join(project_root, "config.json")) as f:
        config = json.load(f)
    metro_cities = [(c["region_id"], c["name"]) for c in config["cities"]]
    market_slug = config["metro"]["redfin_market_slug"]

    today_str = date.today().isoformat()

    print(f"Fetching active listings across {len(metro_cities)} metro cities...\n")

    all_rows = []
    seen = set()

    for region_id, city_name in metro_cities:
        print(f"  {city_name}...", end=" ", flush=True)
        city_rows = fetch_city(region_id, city_name, seen, market_slug)
        print(f"{len(city_rows)} active")
        all_rows.extend(city_rows)
        time.sleep(0.5)

    print(f"\nTotal unique active listings: {len(all_rows):,}")

    if not all_rows:
        print("No data collected. Exiting.")
        sys.exit(1)

    # Update tracker
    print("\nUpdating listings tracker...")
    tracker = load_tracker(tracker_path)
    new_count, price_changes, delisted = update_tracker(tracker, all_rows, today_str)
    print(f"  New: {new_count} | Price changes: {price_changes} | Delisted: {delisted}")

    # Enrich rows with tracker data
    enrich_from_tracker(all_rows, tracker, today_str)

    # Save tracker
    save_tracker(tracker, tracker_path)

    # Write CSV
    fieldnames = list(COLUMN_MAP.values()) + [
        "first_seen", "days_tracked", "original_price", "price_change", "price_drop_count",
    ]
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    print(f"\nSaved to {output_path}")
    print("Done.")


if __name__ == "__main__":
    main()
