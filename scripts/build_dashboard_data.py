#!/usr/bin/env python3
"""
Build dashboard data from raw CSV files.

This script reads:
- redfin_sold.csv: Individual sold homes
- redfin_market_city.csv (optional): City-level market trends
- redfin_market_zip.csv (optional): Zip-level market trends
- combined_properties.csv (optional): Joined dataset with county data

And produces: dashboard_data.json for the dashboard to consume.

Usage:
    python3 scripts/build_dashboard_data.py                 # normal run (uses cache)
    python3 scripts/build_dashboard_data.py --force-photos  # re-fetch all photo URLs
"""

import argparse
import json
import csv
import os
import re
import time
import urllib.request
from datetime import datetime
from statistics import median
from pathlib import Path

# Configuration
PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
SCRIPT_DIR = PROJECT_ROOT / "scripts"

INPUT_FILES = {
    "config": PROJECT_ROOT / "config.json",
    "sold": DATA_DIR / "redfin_sold.csv",
    "active": DATA_DIR / "redfin_active.csv",
    "market_city": DATA_DIR / "redfin_market_city.csv",
    "market_zip": DATA_DIR / "redfin_market_zip.csv",
    "active_tracker": DATA_DIR / "active_listings_tracker.json",
}

OUTPUT_FILE = DATA_DIR / "dashboard_data.json"


def load_json(path):
    """Load JSON file."""
    if not path.exists():
        print(f"Warning: {path} not found")
        return None
    with open(path) as f:
        return json.load(f)


def safe_numeric(value):
    """Convert value to numeric, handling NA and empty strings."""
    if value is None or value == "" or value == "NA":
        return None
    try:
        if isinstance(value, (int, float)):
            return value
        # Try int first, then float
        if "." in str(value):
            return float(value)
        return int(value)
    except (ValueError, TypeError):
        return None


def parse_market_csv(path):
    """Parse market trend CSV file."""
    if not path.exists():
        print(f"Info: {path} not found, skipping")
        return {}

    print(f"Reading {path.name}...")
    records_read = 0
    market_data = {}

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                records_read += 1

                # Skip if not "All Residential"
                if row.get("PROPERTY_TYPE", "").strip() != "All Residential":
                    continue

                # Extract region name
                region = row.get("REGION", "").strip()
                if not region:
                    continue

                # Clean up region name: remove quotes and state suffix
                region = region.strip('"')
                if region.startswith("Zip Code:"):
                    # Keep as-is for zip codes
                    area_key = region
                else:
                    # Remove state suffix (e.g., "Greensboro, NC" -> "Greensboro")
                    area_key = region.rsplit(",", 1)[0].strip()

                # Parse period begin as date
                period_begin = row.get("PERIOD_BEGIN", "").strip()
                if not period_begin:
                    continue

                # Create record with numeric fields
                record = {
                    "date": period_begin,
                    "median_sale_price": safe_numeric(row.get("MEDIAN_SALE_PRICE")),
                    "median_list_price": safe_numeric(row.get("MEDIAN_LIST_PRICE")),
                    "median_ppsf": safe_numeric(row.get("MEDIAN_PPSF")),
                    "homes_sold": safe_numeric(row.get("HOMES_SOLD")),
                    "inventory": safe_numeric(row.get("INVENTORY")),
                    "months_of_supply": safe_numeric(row.get("MONTHS_OF_SUPPLY")),
                    "median_dom": safe_numeric(row.get("MEDIAN_DOM")),
                    "avg_sale_to_list": safe_numeric(row.get("AVG_SALE_TO_LIST")),
                    "sold_above_list": safe_numeric(row.get("SOLD_ABOVE_LIST")),
                    "price_drops": safe_numeric(row.get("PRICE_DROPS")),
                }

                if area_key not in market_data:
                    market_data[area_key] = []
                market_data[area_key].append(record)

        print(f"  Processed {records_read} records from {path.name}")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    # Sort by date
    for area in market_data:
        market_data[area].sort(key=lambda x: x["date"])

    return market_data


def parse_sold_csv(path):
    """Parse sold homes CSV file."""
    if not path.exists():
        print(f"Error: {path} not found")
        return []

    print(f"Reading {path.name}...")
    homes = []

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # Parse date
                sold_date = row.get("sold_date", "").strip() or None

                home = {
                    "address": row.get("address", "").strip() or None,
                    "city": row.get("city", "").strip() or None,
                    "zip_code": row.get("zip_code", "").strip() or None,
                    "sale_price": safe_numeric(row.get("sale_price")),
                    "sold_date": sold_date,
                    "beds": safe_numeric(row.get("beds")),
                    "baths": safe_numeric(row.get("baths")),
                    "sqft": safe_numeric(row.get("sqft")),
                    "lot_size_sqft": safe_numeric(row.get("lot_size_sqft")),
                    "year_built": safe_numeric(row.get("year_built")),
                    "days_on_market": safe_numeric(row.get("days_on_market")),
                    "price_per_sqft": safe_numeric(row.get("price_per_sqft")),
                    "hoa_monthly": safe_numeric(row.get("hoa_monthly")),
                    "neighborhood": row.get("neighborhood", "").strip() or None,
                    "property_type": row.get("property_type", "").strip() or None,
                    "latitude": safe_numeric(row.get("latitude")),
                    "longitude": safe_numeric(row.get("longitude")),
                    "redfin_url": row.get("redfin_url", "").strip() or None,
                    "photo_urls": [],
                }

                homes.append(home)

        print(f"  Processed {len(homes)} sold homes")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    return homes


def parse_active_csv(path):
    """Parse active listings CSV file."""
    if not path.exists():
        print(f"Info: {path} not found, skipping active listings")
        return []

    print(f"Reading {path.name}...")
    listings = []

    try:
        with open(path, encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                listing = {
                    "address": row.get("address", "").strip() or None,
                    "city": row.get("city", "").strip() or None,
                    "zip_code": row.get("zip_code", "").strip() or None,
                    "list_price": safe_numeric(row.get("list_price")),
                    "beds": safe_numeric(row.get("beds")),
                    "baths": safe_numeric(row.get("baths")),
                    "sqft": safe_numeric(row.get("sqft")),
                    "lot_size_sqft": safe_numeric(row.get("lot_size_sqft")),
                    "year_built": safe_numeric(row.get("year_built")),
                    "days_on_market": safe_numeric(row.get("days_on_market")),
                    "price_per_sqft": safe_numeric(row.get("price_per_sqft")),
                    "hoa_monthly": safe_numeric(row.get("hoa_monthly")),
                    "neighborhood": row.get("neighborhood", "").strip() or None,
                    "property_type": row.get("property_type", "").strip() or None,
                    "latitude": safe_numeric(row.get("latitude")),
                    "longitude": safe_numeric(row.get("longitude")),
                    "redfin_url": row.get("redfin_url", "").strip() or None,
                    "mls_number": row.get("mls_number", "").strip() or None,
                    "photo_urls": [],
                    # Tracker-derived fields
                    "first_seen": row.get("first_seen", "").strip() or None,
                    "days_tracked": safe_numeric(row.get("days_tracked")),
                    "original_price": safe_numeric(row.get("original_price")),
                    "price_change": safe_numeric(row.get("price_change")),
                    "price_drop_count": safe_numeric(row.get("price_drop_count")),
                }
                listings.append(listing)

        print(f"  Processed {len(listings)} active listings")
    except Exception as e:
        print(f"  Error reading {path.name}: {e}")

    return listings


def point_in_polygon(lat, lng, polygon):
    """Ray-casting point-in-polygon test."""
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        yi, xi = polygon[i]
        yj, xj = polygon[j]
        if ((yi > lat) != (yj > lat)) and (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def compute_area_summary(config, homes):
    """Compute summary statistics for each focus area."""
    summary = {}

    for area_config in config.get("focus_areas", []):
        area_name = area_config["name"]
        area_type = area_config.get("type", "city")

        # Filter homes for this area
        filtered_homes = []

        polygon = area_config.get("polygon")
        if polygon and len(polygon) >= 3:
            # Spatial filtering via polygon
            filtered_homes = [
                h for h in homes
                if h.get("latitude") is not None and h.get("longitude") is not None
                and point_in_polygon(h["latitude"], h["longitude"], polygon)
            ]
        elif area_type == "city":
            # Match by city name
            city_name = area_name
            filtered_homes = [
                h for h in homes
                if h.get("city") and h["city"].lower() == city_name.lower()
            ]
        elif area_type == "neighborhood":
            # Match by neighborhood (case-insensitive substring match)
            neighborhoods = area_config.get("neighborhoods", [])
            filtered_homes = [
                h for h in homes
                if h.get("neighborhood") and any(
                    nb.lower() in h["neighborhood"].lower()
                    for nb in neighborhoods
                )
            ]

        if not filtered_homes:
            continue

        # Extract numeric fields for median calculation
        prices = [h["sale_price"] for h in filtered_homes if h["sale_price"] is not None]
        ppsf = [h["price_per_sqft"] for h in filtered_homes if h["price_per_sqft"] is not None]
        sqfts = [h["sqft"] for h in filtered_homes if h["sqft"] is not None]
        lot_sqfts = [h["lot_size_sqft"] for h in filtered_homes if h["lot_size_sqft"] is not None]
        beds = [h["beds"] for h in filtered_homes if h["beds"] is not None]
        doms = [h["days_on_market"] for h in filtered_homes if h["days_on_market"] is not None]
        years = [h["year_built"] for h in filtered_homes if h["year_built"] is not None]

        summary[area_name] = {
            "count": len(filtered_homes),
            "median_price": median(prices) if prices else None,
            "median_ppsf": median(ppsf) if ppsf else None,
            "median_sqft": median(sqfts) if sqfts else None,
            "median_lot_sqft": median(lot_sqfts) if lot_sqfts else None,
            "median_beds": median(beds) if beds else None,
            "median_dom": median(doms) if doms else None,
            "median_year_built": median(years) if years else None,
            "price_range": [min(prices), max(prices)] if prices else None,
        }

    return summary


def build_zip_city_map(homes):
    """Build a zip code -> city name mapping from sold homes data."""
    from collections import Counter
    zip_counts = {}
    for home in homes:
        z = home.get("zip_code") or ""
        c = home.get("city") or ""
        if z and c:
            zip_counts.setdefault(z, Counter())[c] += 1
    # Pick the most common city for each zip
    return {z: counts.most_common(1)[0][0] for z, counts in zip_counts.items()}


def build_market_trends(config, market_data, homes):
    """Build market_trends object and zip_areas list from parsed data."""
    trends = {}

    # Include ALL zip-level market data
    for key, records in market_data.items():
        if key.startswith("Zip Code:"):
            trends[key] = records

    # Always include the baseline city (city-level)
    baseline_city = config.get("metro", {}).get("baseline_city", "")
    if baseline_city:
        for key in market_data:
            if key.lower() == baseline_city.lower():
                trends[baseline_city] = market_data[key]
                break

    # Build zip_areas list for the multi-select dropdown
    zip_city_map = build_zip_city_map(homes)
    zip_areas = []
    for key in sorted(trends.keys()):
        if not key.startswith("Zip Code:"):
            continue
        zip_code = key.replace("Zip Code: ", "").strip()
        city = zip_city_map.get(zip_code, "")
        zip_areas.append({"zip": zip_code, "city": city, "key": key})

    return trends, zip_areas


def fetch_photo_url(redfin_url):
    """Fetch all photo URLs from a Redfin listing page.

    Reads up to 500 KB of the page to find CDN photo URLs embedded in the
    page source, falling back to og:image if none are found.  Returns a list
    of URL strings, or None on failure / no photos found.
    """
    try:
        req = urllib.request.Request(redfin_url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; housing-data-pipeline/1.0)",
        })
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read(500000).decode("utf-8", errors="ignore")

        # Extract all Redfin CDN photo URLs that appear inside JSON string quotes
        urls = re.findall(
            r'"(https://ssl\.cdn-redfin\.com/photo/[^"]+\.(?:jpg|jpeg|webp|png))"',
            html,
        )

        # Deduplicate while preserving order
        seen = set()
        unique_urls = []
        for u in urls:
            if u not in seen:
                seen.add(u)
                unique_urls.append(u)

        # Prefer full-size images (bigphoto / islphoto) over thumbnails
        full_size = [u for u in unique_urls if "/bigphoto/" in u or "/islphoto/" in u]
        result = full_size if full_size else unique_urls

        if result:
            return result

        # Fallback: og:image from the <head>
        match = re.search(r'og:image["\s]+content="([^"]+)"', html[:32000])
        return [match.group(1)] if match else None
    except Exception:
        return None


def fetch_photo_urls(homes, force=False):
    """Fetch all photo URLs for all homes with Redfin URLs.

    Args:
        homes: List of home dictionaries with redfin_url field
        force: If True, ignore cache and re-fetch all photo URLs
    """
    # Separate cache file (stores lists now, not single strings)
    cache_path = DATA_DIR / "photo_urls_cache.json"
    cache = {}
    if cache_path.exists() and not force:
        with open(cache_path) as f:
            cache = json.load(f)

    to_fetch = [h for h in homes if h.get("redfin_url") and h["redfin_url"] not in cache]
    print(f"  {len(cache)} cached, {len(to_fetch)} to fetch")

    if os.environ.get("SKIP_PHOTO_FETCH"):
        print("  SKIP_PHOTO_FETCH set — skipping photo URL fetches")
        to_fetch = []

    for i, home in enumerate(to_fetch):
        url = home["redfin_url"]
        photos = fetch_photo_url(url)
        cache[url] = photos  # cache None too, to avoid retrying broken pages
        if (i + 1) % 25 == 0:
            print(f"    Fetched {i + 1}/{len(to_fetch)}...")
        time.sleep(0.5)

    # Save updated cache
    with open(cache_path, "w") as f:
        json.dump(cache, f)

    # Assign photo URL lists to homes
    assigned = 0
    for home in homes:
        url = home.get("redfin_url")
        if url and cache.get(url):
            home["photo_urls"] = cache[url]
            assigned += 1

    print(f"  Assigned photo URLs to {assigned}/{len(homes)} homes")
    return homes


def main():
    """Main execution."""
    parser = argparse.ArgumentParser(description="Build dashboard data from raw CSV files")
    parser.add_argument(
        "--force-photos",
        action="store_true",
        help="Re-fetch all photo URLs (ignore cache)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Building dashboard data...")
    if args.force_photos:
        print("  (--force-photos: re-fetching all photo URLs)")
    print("=" * 60)

    # Load config
    print("\nLoading configuration...")
    config = load_json(INPUT_FILES["config"])
    if not config:
        print("Error: config.json not found or invalid")
        return
    print(f"  Loaded config with {len(config.get('focus_areas', []))} focus areas")

    # Parse sold homes (required)
    print("\nParsing sold homes...")
    homes = parse_sold_csv(INPUT_FILES["sold"])
    if not homes:
        print("Warning: No sold homes found")

    # Parse market data (optional)
    print("\nParsing market trends...")
    market_city = parse_market_csv(INPUT_FILES["market_city"])
    market_zip = parse_market_csv(INPUT_FILES["market_zip"])
    market_data = {**market_city, **market_zip}
    print(f"  Total market areas: {len(market_data)}")

    # Parse active listings
    print("\nParsing active listings...")
    active_listings = parse_active_csv(INPUT_FILES["active"])

    # Fetch property photos from Redfin listing pages
    print("\nFetching property photos (sold)...")
    homes = fetch_photo_urls(homes, force=args.force_photos)

    if active_listings:
        print("\nFetching property photos (active)...")
        active_listings = fetch_photo_urls(active_listings, force=args.force_photos)

    # Read sold window metadata written by ingest_redfin_sold.py
    sold_meta_path = DATA_DIR / "redfin_sold_meta.json"
    if sold_meta_path.exists():
        with open(sold_meta_path) as f:
            sold_meta = json.load(f)
        sold_window_days = sold_meta.get("sold_within_days")
    else:
        sold_window_days = None

    # Attach visual quality scores from cache
    vq_cache_path = DATA_DIR / "visual_quality_cache.json"
    if vq_cache_path.exists():
        print("\nAttaching visual quality scores...")
        with open(vq_cache_path) as f:
            vq_cache = json.load(f)
        vq_assigned = 0
        for home_list in [homes, active_listings or []]:
            for home in home_list:
                vq = vq_cache.get(home.get("address"))
                if vq:
                    home["visual_quality"] = vq.get("score")
                    home["vq_condition"] = vq.get("condition")
                    home["vq_finish"] = vq.get("finish")
                    home["vq_aesthetic"] = vq.get("aesthetic")
                    vq_assigned += 1
        print(f"  Assigned visual quality scores to {vq_assigned} homes")
    else:
        print("\nNo visual quality cache found (run assess_visual_quality.py to generate)")

    # Compute area summaries
    print("\nComputing area summaries...")
    area_summary = compute_area_summary(config, homes)
    print(f"  Computed summaries for {len(area_summary)} areas")

    # Build market trends
    print("\nBuilding market trends...")
    market_trends, zip_areas = build_market_trends(config, market_data, homes)
    print(f"  Included {len(market_trends)} market areas, {len(zip_areas)} zip areas")

    # Data freshness from pipeline state
    import pipeline_state
    data_freshness = pipeline_state.get_freshness()

    # Assemble output
    print("\nAssembling output...")
    output = {
        "generated_at": datetime.now().isoformat(),
        "data_freshness": data_freshness,
        "config": config,
        "sold_window_days": sold_window_days,
        "market_trends": market_trends,
        "zip_areas": zip_areas,
        "sold_homes": homes,
        "active_listings": active_listings,
        "area_summary": area_summary,
    }

    # Write output
    print(f"\nWriting {OUTPUT_FILE}...")
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    # Summary stats
    print("\n" + "=" * 60)
    print("Build complete!")
    print("=" * 60)
    print(f"Output file: {OUTPUT_FILE}")
    print(f"Generated at: {output['generated_at']}")
    print(f"Sold homes: {len(homes)}")
    print(f"Active listings: {len(active_listings)}")
    print(f"Market areas: {len(market_trends)}")
    print(f"Focus areas with summaries: {len(area_summary)}")
    print("=" * 60)


if __name__ == "__main__":
    main()
