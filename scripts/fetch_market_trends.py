#!/usr/bin/env python3
"""
Ingest Redfin market-level data for a configured metro area.

Downloads the city and zip-code level TSV files from Redfin's public S3 bucket,
filters to the configured metro, and saves as CSV.

Supports incremental updates: uses HTTP ETags to skip download if S3 files
haven't changed since the last fetch. Use --full to force re-download.

NOTE: These files are ~1-1.5 GB compressed. We stream via curl | gunzip and
read line-by-line to avoid loading everything into memory. A progress counter
prints every 500K lines so you know it's working.
"""

import argparse
import csv
import io
import json
import os
import subprocess
import sys
import urllib.request

S3_BASE = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker"

DATASETS = {
    "city": f"{S3_BASE}/city_market_tracker.tsv000.gz",
    "zip": f"{S3_BASE}/zip_code_market_tracker.tsv000.gz",
}

# Columns to keep (strip quotes from TSV headers)
KEEP_COLUMNS = [
    "PERIOD_BEGIN", "PERIOD_END", "PERIOD_DURATION", "REGION", "CITY",
    "STATE_CODE", "PROPERTY_TYPE",
    "MEDIAN_SALE_PRICE", "MEDIAN_SALE_PRICE_YOY",
    "MEDIAN_LIST_PRICE", "MEDIAN_LIST_PRICE_YOY",
    "MEDIAN_PPSF", "MEDIAN_PPSF_YOY",
    "HOMES_SOLD", "HOMES_SOLD_YOY",
    "PENDING_SALES", "NEW_LISTINGS",
    "INVENTORY", "MONTHS_OF_SUPPLY",
    "MEDIAN_DOM", "AVG_SALE_TO_LIST",
    "SOLD_ABOVE_LIST", "PRICE_DROPS",
    "OFF_MARKET_IN_TWO_WEEKS",
    "PARENT_METRO_REGION", "PARENT_METRO_REGION_METRO_CODE",
    "LAST_UPDATED",
]

# How often to print a progress update (every N lines scanned)
PROGRESS_INTERVAL = 500_000


def load_etag_cache(cache_path):
    """Load cached ETags from previous runs."""
    if os.path.exists(cache_path):
        with open(cache_path, "r") as f:
            return json.load(f)
    return {}


def save_etag_cache(cache, cache_path):
    """Save ETags for future runs."""
    with open(cache_path, "w") as f:
        json.dump(cache, f, indent=2)


def check_etag(url):
    """Fetch the ETag for a URL via HEAD request."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.headers.get("ETag", "").strip('"')
    except Exception:
        return None


def stream_and_filter(url, level, metro_code, metro_name):
    """Stream gzipped TSV from S3, filter line-by-line for the configured metro."""
    print(f"  Streaming {level}-level data (this may take a few minutes)...")

    # Pipe: curl streams the gzipped file, gunzip decompresses on the fly
    proc = subprocess.Popen(
        f'curl -s --compressed "{url}" | gunzip',
        shell=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,  # line-buffered
    )

    # Read the header line to get field names
    header_line = proc.stdout.readline().strip()
    if not header_line:
        print("  ERROR: Could not read header from stream.")
        proc.kill()
        return []

    fieldnames = [f.strip('"') for f in header_line.split('\t')]

    # Find the index of the metro code column for fast filtering
    try:
        metro_col_idx = fieldnames.index("PARENT_METRO_REGION_METRO_CODE")
    except ValueError:
        print("  ERROR: PARENT_METRO_REGION_METRO_CODE column not found in header.")
        proc.kill()
        return []

    print(f"  Scanning for {metro_name} metro (code {metro_code})...")

    rows = []
    lines_scanned = 0
    matches = 0

    for line in proc.stdout:
        lines_scanned += 1
        if lines_scanned % PROGRESS_INTERVAL == 0:
            print(f"    ...scanned {lines_scanned:,} lines, {matches:,} matches so far",
                  flush=True)

        # Quick check: does this line contain the metro code at all?
        # This is faster than splitting every line
        if metro_code not in line:
            continue

        values = line.strip().split('\t')
        if len(values) != len(fieldnames):
            continue

        # Verify the metro code is in the right column (not a false positive)
        metro_val = values[metro_col_idx].strip('"')
        if metro_val != metro_code:
            continue

        matches += 1
        raw = dict(zip(fieldnames, values))
        cleaned = {k: v.strip('"') for k, v in raw.items()}
        filtered = {k: cleaned.get(k, "") for k in KEEP_COLUMNS if k in cleaned}
        rows.append(filtered)

    proc.wait()
    print(f"  Scanned {lines_scanned:,} total lines, found {matches:,} matching records.")

    return rows


def main():
    parser = argparse.ArgumentParser(description="Ingest Redfin market data")
    parser.add_argument("--full", action="store_true",
                        help="Force full re-download even if data hasn't changed")
    args = parser.parse_args()

    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    data_dir = os.path.join(project_root, "data")
    os.makedirs(data_dir, exist_ok=True)

    etag_cache_path = os.path.join(data_dir, "redfin_market_etags.json")
    etag_cache = load_etag_cache(etag_cache_path)

    with open(os.path.join(project_root, "config.json")) as f:
        config = json.load(f)
    metro_code = config["metro"]["redfin_metro_code"]
    metro_name = config["metro"]["name"]

    any_updated = False

    for level, url in DATASETS.items():
        print(f"\nProcessing {level}-level Redfin data...")
        output_path = os.path.join(data_dir, f"redfin_market_{level}.csv")

        # Check ETag to see if data has changed
        if not args.full:
            current_etag = check_etag(url)
            cached_etag = etag_cache.get(level, {}).get("etag")

            if current_etag and current_etag == cached_etag and os.path.exists(output_path):
                print(f"  Data unchanged (ETag match). Skipping download.")
                continue

            if current_etag:
                etag_cache[level] = {"etag": current_etag, "url": url}

        rows = stream_and_filter(url, level, metro_code, metro_name)
        print(f"  Found {len(rows):,} {metro_name} metro records.")

        if not rows:
            print(f"  WARNING: No data found for {level}. Skipping.")
            continue

        fieldnames = [k for k in KEEP_COLUMNS if k in rows[0]]

        with open(output_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        print(f"  Saved to {output_path}")
        any_updated = True

    # Save ETag cache
    save_etag_cache(etag_cache, etag_cache_path)

    if any_updated:
        print("\nDone - data updated.")
    else:
        print("\nDone - no updates needed (all data current).")


if __name__ == "__main__":
    main()
