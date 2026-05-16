#!/usr/bin/env python3
"""
Ingest recently sold homes from Redfin for the configured metro area.

Uses Redfin's public CSV download endpoint (same as the website's "Download All"
button). Iterates over each city in the metro, splitting by property type where
needed to stay under the 350-row-per-request limit.

Supports incremental updates: on subsequent runs, only fetches recent sales
and merges with existing data (deduplicating by MLS#). Use --full to force
a complete refresh.

Pagination via page_number does NOT work (returns duplicate data), so we
use city + property-type splitting and short time windows instead.
"""

import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, date, timedelta

BASE_URL = "https://www.redfin.com/stingray/api/gis-csv"

REGION_TYPE = "6"  # city/place

# How far back to pull sold homes (in days)
DEFAULT_SOLD_WITHIN_DAYS = 90

# Property types to iterate over to avoid the 350-row cap:
#   1=House, 2=Condo, 3=Townhouse, 4=Multi-family, 5=Land, 6=Other
# We split houses into their own request (highest volume) and group the rest.
PROPERTY_TYPE_GROUPS = [
    ("Single Family", "1"),
    ("Condo/Townhouse/Multi/Other", "2,3,4,5,6,7,8"),
]

# Redfin CSV columns we want to keep, mapped to cleaner names
COLUMN_MAP = {
    "SALE TYPE": "sale_type",
    "SOLD DATE": "sold_date",
    "PROPERTY TYPE": "property_type",
    "ADDRESS": "address",
    "CITY": "city",
    "STATE OR PROVINCE": "state",
    "ZIP OR POSTAL CODE": "zip_code",
    "PRICE": "sale_price",
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


def fetch_sold(region_id, uipt, sold_within_days, market_slug):
    """Fetch sold homes CSV for a city + property type group."""
    params = {
        "al": "1",
        "market": market_slug,
        "num_homes": "350",
        "ord": "redfin-recommended-asc",
        "page_number": "1",
        "region_id": region_id,
        "region_type": REGION_TYPE,
        "sold_within_days": str(sold_within_days),
        "status": "9",  # sold
        "uipt": uipt,
        "v": "8",
    }
    url = f"{BASE_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; housing-data-pipeline/1.0)",
    })

    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode("utf-8")

    # Redfin includes a disclaimer line — skip lines that aren't data
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        # Skip disclaimer/empty rows
        if not row.get("ADDRESS"):
            continue
        # Remap columns
        mapped = {}
        for orig_col, new_col in COLUMN_MAP.items():
            mapped[new_col] = row.get(orig_col, "")
        rows.append(mapped)

    return rows


def fetch_city(region_id, city_name, sold_within_days, seen, market_slug):
    """Fetch all sold homes for a city, splitting by property type if needed."""
    city_rows = []

    for label, uipt in PROPERTY_TYPE_GROUPS:
        try:
            rows = fetch_sold(region_id, uipt, sold_within_days, market_slug)
        except Exception as e:
            print(f"    ERROR ({label}): {e}")
            continue

        if len(rows) >= 347:
            # Likely truncated — fall back to 30-day window
            try:
                rows = fetch_sold(region_id, uipt, 30, market_slug)
            except Exception as e:
                print(f"    ERROR ({label}, 30-day fallback): {e}")
                continue

        for row in rows:
            key = (row["address"], row["sold_date"])
            if key not in seen:
                seen.add(key)
                city_rows.append(row)

        time.sleep(0.5)

    return city_rows


def load_existing_sales(output_path):
    """Load existing sales CSV and return (rows_by_mls, most_recent_date)."""
    if not os.path.exists(output_path):
        return {}, None

    rows_by_mls = {}
    most_recent_date = None

    with open(output_path, "r", newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            mls = row.get("mls_number", "").strip()
            if mls:
                rows_by_mls[mls] = row

            sold_date = row.get("sold_date", "")
            if sold_date:
                try:
                    d = datetime.strptime(sold_date, "%B-%d-%Y").date()
                    if most_recent_date is None or d > most_recent_date:
                        most_recent_date = d
                except ValueError:
                    pass

    return rows_by_mls, most_recent_date


def main():
    parser = argparse.ArgumentParser(description="Ingest Redfin sold homes data")
    parser.add_argument("sold_days", nargs="?", type=int, default=None,
                        help="Days of sales to fetch (default: auto for incremental, 90 for full)")
    parser.add_argument("--full", action="store_true",
                        help="Force full refresh instead of incremental update")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)
    output_path = os.path.join(data_dir, "redfin_sold.csv")

    with open(os.path.join(project_root, "config.json")) as f:
        config = json.load(f)
    metro_cities = [(c["region_id"], c["name"]) for c in config["cities"]]
    market_slug = config["metro"]["redfin_market_slug"]

    # Determine fetch window
    existing_by_mls, most_recent_date = {}, None
    if not args.full:
        existing_by_mls, most_recent_date = load_existing_sales(output_path)

    if args.sold_days is not None:
        sold_within_days = args.sold_days
        mode = "full" if args.full else "manual"
    elif args.full or not existing_by_mls:
        sold_within_days = DEFAULT_SOLD_WITHIN_DAYS
        mode = "full"
    else:
        # Incremental: fetch from 3 days before most recent sale (overlap for safety)
        if most_recent_date:
            days_since = (date.today() - most_recent_date).days + 3
            sold_within_days = max(7, min(days_since, 30))  # clamp to 7-30 days
        else:
            sold_within_days = 14
        mode = "incremental"

    if mode == "incremental":
        print(f"Incremental update: fetching last {sold_within_days} days, "
              f"merging with {len(existing_by_mls):,} existing sales\n")
    else:
        print(f"Full refresh: fetching last {sold_within_days} days "
              f"across {len(metro_cities)} metro cities...\n")

    new_rows = []
    seen = set()  # deduplicate across cities

    for region_id, city_name in metro_cities:
        print(f"  {city_name}...", end=" ", flush=True)
        city_rows = fetch_city(region_id, city_name, sold_within_days, seen, market_slug)
        print(f"{len(city_rows)} sales")
        new_rows.extend(city_rows)
        time.sleep(0.5)

    print(f"\nFetched {len(new_rows):,} sales from API")

    # Merge with existing data
    if mode == "incremental" and existing_by_mls:
        new_count = 0
        for row in new_rows:
            mls = row.get("mls_number", "").strip()
            if mls and mls not in existing_by_mls:
                new_count += 1
            if mls:
                existing_by_mls[mls] = row  # update/add
        all_rows = list(existing_by_mls.values())
        print(f"Merged: {new_count} new sales, {len(all_rows):,} total")
    else:
        all_rows = new_rows

    if not all_rows:
        print("No data collected. Exiting.")
        sys.exit(1)

    # Sort by sold_date descending (most recent first)
    def parse_date(row):
        try:
            return datetime.strptime(row.get("sold_date", ""), "%B-%d-%Y")
        except ValueError:
            return datetime.min
    all_rows.sort(key=parse_date, reverse=True)

    fieldnames = list(COLUMN_MAP.values())
    with open(output_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)

    meta_path = os.path.join(data_dir, "redfin_sold_meta.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump({
            "sold_within_days": sold_within_days,
            "mode": mode,
            "total_records": len(all_rows),
            "last_updated": datetime.now().isoformat(),
        }, f, indent=2)

    print(f"Saved {len(all_rows):,} records to {output_path}")
    print("Done.")


if __name__ == "__main__":
    main()
