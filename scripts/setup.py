#!/usr/bin/env python3
"""
Interactive setup wizard for config.json.

Guides you through configuring the housing data dashboard for any US metro area:
  1. Metro area (Redfin metro code, market slug, map center)
  2. Cities to track (Redfin region IDs — searched via Redfin API)
  3. County parcel data source (ArcGIS endpoint, optional)
  4. Focus areas (specific neighborhoods/cities with optional polygon boundaries)

Usage:
    python3 scripts/setup.py
"""

import json
import os
import sys
import urllib.request
import urllib.parse

# ── Terminal colors ────────────────────────────────────────────────────────────
BOLD  = "\033[1m"
CYAN  = "\033[36m"
GREEN = "\033[32m"
YELLOW= "\033[33m"
RED   = "\033[31m"
DIM   = "\033[2m"
RESET = "\033[0m"

def _supports_color():
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()

if not _supports_color():
    BOLD = CYAN = GREEN = YELLOW = RED = DIM = RESET = ""


# ── Output helpers ─────────────────────────────────────────────────────────────

def print_header(text):
    bar = "=" * 60
    print(f"\n{BOLD}{CYAN}{bar}{RESET}")
    print(f"{BOLD}{CYAN}  {text}{RESET}")
    print(f"{BOLD}{CYAN}{bar}{RESET}\n")

def print_step(n, total, text):
    print(f"\n{BOLD}[{n}/{total}] {text}{RESET}")
    print(f"{DIM}{'─' * 50}{RESET}")

def info(text):
    print(f"{DIM}      {text}{RESET}")

def success(text):
    print(f"{GREEN}  ✓  {text}{RESET}")

def warn(text):
    print(f"{YELLOW}  ⚠  {text}{RESET}")

def note(label, text):
    """Print a highlighted note block."""
    print(f"\n  {BOLD}{label}{RESET}")
    for line in text.strip().splitlines():
        print(f"    {DIM}{line}{RESET}")
    print()


# ── Input helpers ──────────────────────────────────────────────────────────────

def prompt(label, default=None, required=True):
    """Prompt for a string value, with optional default."""
    hint = f" [{default}]" if default is not None else ""
    while True:
        val = input(f"  {label}{hint}: ").strip()
        if not val and default is not None:
            return str(default)
        if not val and required:
            print(f"    {RED}Required — please enter a value.{RESET}")
            continue
        return val

def prompt_optional(label, default=""):
    """Prompt for an optional string; returns empty string if skipped."""
    val = input(f"  {label} (optional, Enter to skip): ").strip()
    return val or default

def prompt_yn(label, default=True):
    """Prompt for yes/no. Returns bool."""
    hint = "Y/n" if default else "y/N"
    val = input(f"  {label} [{hint}]: ").strip().lower()
    if not val:
        return default
    return val in ("y", "yes")

def prompt_float(label, default=None):
    """Prompt for a float, retrying on invalid input."""
    while True:
        raw = prompt(label, default=str(default) if default is not None else None)
        try:
            return float(raw)
        except ValueError:
            print(f"    {RED}Enter a valid decimal number (e.g. 30.267){RESET}")

def prompt_int(label, default=None, min_val=None, max_val=None):
    """Prompt for an integer."""
    while True:
        raw = prompt(label, default=str(default) if default is not None else None)
        try:
            val = int(raw)
            if min_val is not None and val < min_val:
                print(f"    {RED}Must be at least {min_val}.{RESET}")
                continue
            if max_val is not None and val > max_val:
                print(f"    {RED}Must be at most {max_val}.{RESET}")
                continue
            return val
        except ValueError:
            print(f"    {RED}Enter a whole number.{RESET}")


# ── Redfin API helpers ─────────────────────────────────────────────────────────

def redfin_location_search(query):
    """
    Call Redfin's public location autocomplete endpoint.
    Returns a list of dicts: {name, region_id, type, url}
    Returns [] on failure (network error, unexpected format, etc.)
    """
    encoded = urllib.parse.quote(query)
    url = (
        f"https://www.redfin.com/stingray/do/location-autocomplete"
        f"?location={encoded}&v=2"
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.redfin.com/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8")
    except Exception:
        return []

    # Redfin wraps JSON responses in  {}&&{...}  — strip the anti-hijacking prefix
    if raw.startswith("{}&&"):
        raw = raw[4:]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []

    # type codes: 1=neighborhood, 2=zip, 5=county, 6=city, 33=metro
    TYPE_NAMES = {"1": "neighborhood", "2": "zip", "5": "county", "6": "city", "33": "metro"}

    results = []
    for section in data.get("payload", {}).get("sections", []):
        for row in section.get("rows", []):
            row_id    = row.get("id", {})
            region_id = str(row_id.get("regionId", ""))
            type_code = str(row_id.get("type", ""))
            name      = row.get("name", "")
            url_path  = row.get("url", "")

            if region_id and name:
                results.append({
                    "name":      name,
                    "region_id": region_id,
                    "type":      TYPE_NAMES.get(type_code, f"type-{type_code}"),
                    "url":       url_path,
                })

    return results[:12]


def display_search_results(results, filter_types=None):
    """Print a numbered list of search results. Returns the (possibly filtered) list."""
    if filter_types:
        filtered = [r for r in results if r["type"] in filter_types]
        # Fall back to all results if no matches after filtering
        if not filtered:
            filtered = results
    else:
        filtered = results

    for i, r in enumerate(filtered, start=1):
        print(f"    {i}. {r['name']}  {DIM}({r['type']}, region_id: {r['region_id']}){RESET}")
    return filtered


# ── Section: Metro ─────────────────────────────────────────────────────────────

def setup_metro():
    note(
        "About this section:",
        """\
The metro section identifies your target metro area for Redfin market data.
Key values to gather before continuing:
  • Redfin metro code  — a CBSA code (e.g. 12420 for Austin-Round Rock, TX)
  • Redfin market slug — appears in Redfin URLs for your city (e.g. "austin")

Finding the metro code:
  Option A — grep the Redfin market tracker (requires curl + gunzip):
    curl -s 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz' \\
      | gunzip | grep -m3 'YOUR CITY' | cut -f6,31,32
  Option B — look up your metro's CBSA code at:
    https://www.census.gov/programs-surveys/metro-micro/about/delineation-files.html

Finding the market slug:
  Visit redfin.com, search for your city, and look at the URL:
    redfin.com/city/12345/TX/Austin  →  slug is "austin"
    redfin.com/city/7161/NC/Greensboro  →  slug is "greensboro\""""
    )

    metro_name  = prompt("Metro display name (e.g. 'Austin-Round Rock')")
    state_code  = prompt("State code (2-letter)").upper()[:2]
    metro_code  = prompt("Redfin metro code  (e.g. '12420')")
    market_slug = prompt("Redfin market slug (e.g. 'austin')").lower()
    baseline    = prompt("Baseline city name (main city, used for market comparison)")

    note(
        "Map center coordinates:",
        """\
The dashboard map centers on these coordinates.
  • Right-click your city on Google Maps → "What's here?" to copy lat/lng
  • Zoom 10 = county-wide, 11 = metro view, 12-13 = city/neighborhood view"""
    )

    map_lat  = prompt_float("Map center latitude  (e.g. 30.2672)")
    map_lng  = prompt_float("Map center longitude (e.g. -97.7431)")
    map_zoom = prompt_int("Map zoom level", default=11, min_val=8, max_val=16)

    return {
        "name":                metro_name,
        "redfin_metro_code":   metro_code,
        "redfin_market_slug":  market_slug,
        "state_code":          state_code,
        "map_center":          [map_lat, map_lng],
        "map_zoom":            map_zoom,
        "baseline_city":       baseline,
    }


# ── Section: Cities ────────────────────────────────────────────────────────────

def setup_cities(metro):
    state_code = metro.get("state_code", "")
    cities     = []

    note(
        "About this section:",
        """\
Add every city/town you want sold and active listing data for.
The pipeline iterates this list to pull data from Redfin's CSV API.
Tip: include the main city, surrounding suburbs, and any towns you're
considering — you can always add more later in config.json.

City search uses the Redfin location API (best-effort — may not work in all
environments). If search returns no results, select "0" to enter manually:
  • region_id appears in the Redfin URL for a city:
    redfin.com/city/7161/NC/Greensboro  →  region_id is 7161"""
    )

    while True:
        print(f"\n  Cities so far: {', '.join(c['name'] for c in cities) or '(none)'}")
        query = input("  Search for a city to add (or Enter to finish): ").strip()

        if not query:
            if not cities:
                warn("No cities added. The pipeline needs at least one city.")
                if not prompt_yn("Continue without any cities?", default=False):
                    continue
            break

        print(f"\n  Searching Redfin for '{query}, {state_code}'...")
        results = redfin_location_search(f"{query} {state_code}")

        if not results:
            warn("No results (network error or no match). Enter manually.")
            name = prompt("City name")
            rid  = prompt("Redfin region_id")
            cities.append({"region_id": rid, "name": name})
            success(f"Added: {name} (region_id: {rid})")
            continue

        filtered = display_search_results(results, filter_types={"city", "neighborhood"})
        print(f"    0. Enter manually")

        choice_raw = input(
            "\n  Select a number to add (or Enter to skip): "
        ).strip()

        if not choice_raw:
            continue

        try:
            choice = int(choice_raw)
        except ValueError:
            continue

        if choice == 0:
            name = prompt("City name")
            rid  = prompt("Redfin region_id")
            cities.append({"region_id": rid, "name": name})
            success(f"Added: {name} (region_id: {rid})")
        elif 1 <= choice <= len(filtered):
            r = filtered[choice - 1]
            if any(c["region_id"] == r["region_id"] for c in cities):
                warn("Already in the list.")
            else:
                # Use just the place name, not "City, ST"
                short_name = r["name"].split(",")[0].strip()
                cities.append({"region_id": r["region_id"], "name": short_name})
                success(f"Added: {short_name} (region_id: {r['region_id']})")

    return cities


# ── Section: County Parcels ────────────────────────────────────────────────────

def setup_county_parcels():
    note(
        "About this section:",
        """\
County parcel data enriches listings with assessed values, year built, lot size,
and other property characteristics pulled from public tax records via ArcGIS.

This is optional but highly recommended — without it the dashboard still works
but won't show assessed value vs. asking price comparisons.

How to find your county's ArcGIS endpoint:
  1. Search online: "[Your County] GIS parcel data ArcGIS REST"
  2. Look for a FeatureServer URL ending in /0/query, e.g.:
       https://gis.traviscountytx.gov/arcgis/rest/services/.../FeatureServer/0/query
  3. Browse the endpoint URL in your browser — it lists available fields.
  4. You'll need to update out_fields and field_map in config.json once you've
     identified which fields your county exposes."""
    )

    if not prompt_yn("Enable county parcel data?", default=True):
        return {"enabled": False}

    source_name = prompt("County/source name (e.g. 'Travis County')")
    base_url    = prompt("ArcGIS FeatureServer /query endpoint URL")

    note(
        "Field configuration:",
        """\
out_fields  — which attribute fields to request from the API
field_map   — maps API field names → internal CSV column names used by the pipeline

The pipeline expects these internal column names (right-hand side of field_map):
  address, owner, year_built, bedrooms, bathrooms,
  total_assessed, building_value, land_value,
  structure_sqft, lot_acres, latitude, longitude

You'll need to browse your ArcGIS endpoint to find the matching API field names
for your county, then update out_fields and field_map in config.json accordingly.

Example (Guilford County, NC):
  "LOCATION_ADDR" → "address"
  "YEAR_BUILT"    → "year_built"
  "BEDROOMS"      → "bedrooms"
  "CentroidXCoordinate" → "longitude"
  "CentroidYCoordinat"  → "latitude\""""
    )

    warn("out_fields and field_map are left empty — fill them in config.json before running.")

    return {
        "enabled":    True,
        "source_name": source_name,
        "base_url":   base_url,
        "out_fields": [],
        "field_map":  {},
        "page_size":  2000,
    }


# ── Section: Focus Areas ───────────────────────────────────────────────────────

def collect_polygon():
    """Interactively collect polygon [lat, lng] vertices."""
    note(
        "Polygon entry:",
        """\
Enter one coordinate pair per line as:  lat,lng
Example:  30.2672,-97.7431

Tips:
  • geojson.io — draw a polygon on the map, then copy coordinates from the JSON
  • Google Maps — right-click any point to copy coordinates
  • At least 3 points are required; press Enter on a blank line to finish."""
    )

    polygon = []
    while True:
        raw = input("    lat,lng (Enter to finish): ").strip()
        if not raw:
            if len(polygon) < 3:
                if polygon:
                    warn("Need at least 3 points for a valid polygon. Discarding.")
                return []
            return polygon
        try:
            parts   = raw.split(",")
            lat     = float(parts[0].strip())
            lng     = float(parts[1].strip())
            polygon.append([lat, lng])
            print(f"      {DIM}→ [{lat}, {lng}]{RESET}")
        except (ValueError, IndexError):
            print(f"    {RED}Invalid format — use:  30.2672,-97.7431{RESET}")


def setup_focus_areas(metro):
    state_code  = metro.get("state_code", "")
    focus_areas = []

    note(
        "About this section:",
        """\
Focus areas let you highlight specific cities or neighborhoods on the dashboard
map. Each area can have:
  • zip_codes       — used to filter market trend data
  • neighborhoods   — neighborhood names as they appear in Redfin listings
  • polygon         — boundary drawn on the map

This section is optional. You can add or edit focus areas directly in
config.json at any time."""
    )

    if not prompt_yn("Add focus areas?", default=False):
        return []

    while True:
        print()
        area_name = input("  Focus area name (or Enter to finish): ").strip()
        if not area_name:
            break

        area_type = "city" if prompt_yn(
            f"  Is '{area_name}' a city? (No = neighborhood)", default=True
        ) else "neighborhood"

        # ZIP codes
        zip_raw    = prompt_optional("  ZIP code(s), comma-separated (e.g. '78701,78702')")
        zip_codes  = [z.strip() for z in zip_raw.split(",") if z.strip()]

        # Neighborhood names (for neighborhood-type areas)
        neighborhoods = []
        if area_type == "neighborhood":
            nbhd_raw      = prompt_optional(
                "  Neighborhood name(s) as they appear in Redfin data, comma-separated"
            )
            neighborhoods = [n.strip() for n in nbhd_raw.split(",") if n.strip()]

        # Redfin region_id (mainly useful for city-type areas)
        redfin_region_id = None
        if area_type == "city":
            print(f"\n  Searching Redfin for region_id of '{area_name}'...")
            results      = redfin_location_search(f"{area_name} {state_code}")
            city_results = [r for r in results if r["type"] == "city"]
            if city_results:
                display_search_results(city_results)
                rid_choice = input(
                    "\n  Select number to use its region_id (or Enter to skip): "
                ).strip()
                if rid_choice.isdigit():
                    idx = int(rid_choice) - 1
                    if 0 <= idx < len(city_results):
                        redfin_region_id = city_results[idx]["region_id"]
                        success(f"region_id: {redfin_region_id}")
            if not redfin_region_id:
                rid = prompt_optional("  Enter region_id manually")
                if rid:
                    redfin_region_id = rid

        # Polygon
        polygon = []
        if prompt_yn(f"  Add a polygon boundary for '{area_name}'?", default=False):
            polygon = collect_polygon()
            if polygon:
                success(f"Polygon recorded ({len(polygon)} points)")

        focus_areas.append({
            "name":              area_name,
            "type":              area_type,
            "redfin_region_id":  redfin_region_id,
            "zip_codes":         zip_codes,
            "neighborhoods":     neighborhoods,
            "polygon":           polygon,
        })
        success(f"Added focus area: {area_name}")

    return focus_areas


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    script_dir   = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    config_path  = os.path.join(project_root, "config.json")

    print_header("Housing Data Dashboard — Setup Wizard")

    print("This wizard builds config.json for your target metro area.\n")
    print("The pipeline fetches data from:")
    print(f"  • {BOLD}Redfin{RESET}       — market trends, sold homes, active listings")
    print(f"  • {BOLD}County GIS{RESET}   — parcel data (assessed value, year built, etc.) [optional]")
    print()

    if os.path.exists(config_path):
        warn(f"config.json already exists at {config_path}")
        if not prompt_yn("Overwrite it?", default=False):
            print("\nAborted — no changes written.\n")
            sys.exit(0)

    TOTAL = 4

    # ── Step 1: Metro ──────────────────────────────────────────────────────────
    print_step(1, TOTAL, "Metro Area")
    metro = setup_metro()
    success(f"Metro: {metro['name']} (code: {metro['redfin_metro_code']}, slug: {metro['redfin_market_slug']})")

    # ── Step 2: Cities ─────────────────────────────────────────────────────────
    print_step(2, TOTAL, "Cities to Track")
    cities = setup_cities(metro)
    success(f"{len(cities)} cities configured.")

    # ── Step 3: County Parcels ─────────────────────────────────────────────────
    print_step(3, TOTAL, "County Parcel Data (optional)")
    county_parcels = setup_county_parcels()
    if county_parcels.get("enabled"):
        success(f"County parcels enabled: {county_parcels['source_name']}")
    else:
        info("County parcels disabled.")

    # ── Step 4: Focus Areas ────────────────────────────────────────────────────
    print_step(4, TOTAL, "Focus Areas (optional)")
    focus_areas = setup_focus_areas(metro)
    if focus_areas:
        success(f"{len(focus_areas)} focus area(s) configured.")
    else:
        info("No focus areas — you can add them to config.json later.")

    # ── Preview & Save ─────────────────────────────────────────────────────────
    config = {
        "focus_areas":    focus_areas,
        "metro":          metro,
        "cities":         cities,
        "county_parcels": county_parcels,
    }

    print_header("Configuration Preview")
    print(json.dumps(config, indent=2))

    print()
    if not prompt_yn("Save this configuration to config.json?", default=True):
        print("\nAborted — no changes written.\n")
        sys.exit(0)

    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
        f.write("\n")

    print()
    success(f"Saved to {config_path}")

    # ── Next steps ─────────────────────────────────────────────────────────────
    print(f"\n{BOLD}Next steps:{RESET}")
    print()

    step_n = 1

    if county_parcels.get("enabled") and not county_parcels.get("out_fields"):
        print(f"  {step_n}. {YELLOW}Update county_parcels in config.json{RESET}")
        print( "     Browse your ArcGIS endpoint URL to find available field names,")
        print( "     then fill in out_fields and field_map before running the pipeline.")
        step_n += 1

    print(f"  {step_n}. Review config.json and adjust any values if needed.")
    step_n += 1

    print(f"  {step_n}. Run the pipeline to fetch initial data:")
    print( "       python3 scripts/run_pipeline.py")
    step_n += 1

    print(f"  {step_n}. Start the dashboard:")
    print( "       bash start.sh")
    print()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nSetup interrupted — no changes written.\n")
        sys.exit(0)
