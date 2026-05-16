#!/usr/bin/env python3
"""
Single entry point for the housing data pipeline.

Supports tiered updates so different data sources can refresh independently:
  - market_trends:    Redfin S3 bulk data (~3 min, every ~2 weeks, ETag-cached)
  - sold_homes:       Redfin sold CSV (~1 min, daily, incremental merge)
  - active_listings:  Redfin active CSV (~1 min, twice daily)

Incremental optimizations:
  - sold_homes: Merges new sales with existing data (dedup by MLS#)
  - market_trends: Skips download if S3 ETag unchanged

Usage:
    python3 scripts/run_pipeline.py                      # run all tiers (incremental)
    python3 scripts/run_pipeline.py --tier active         # just active listings
    python3 scripts/run_pipeline.py --tier sold           # just sold homes
    python3 scripts/run_pipeline.py --tier trends         # just market trends
    python3 scripts/run_pipeline.py --if-stale            # only run tiers that are due
    python3 scripts/run_pipeline.py --full                # force full refresh (no incremental)
    python3 scripts/run_pipeline.py --sold-days 30        # override sold-homes window
    python3 scripts/run_pipeline.py --force-photos        # re-fetch all photo URLs
    python3 scripts/run_pipeline.py --force-visual-quality # re-score all properties
"""

import argparse
import json
import os
import subprocess
import sys
import time

import pipeline_state

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Tier name -> pipeline steps (in order)
TIER_STEPS = {
    "market_trends": [
        {
            "name": "Market Trends",
            "script": "fetch_market_trends.py",
            "description": "City + zip-level market trends (Redfin S3, ETag-cached)",
        },
    ],
    "sold_homes": [
        {
            "name": "Sold Listings",
            "script": "fetch_sold_listings.py",
            "description": "Individual sold-home transactions (incremental merge)",
            "args_builder": "sold_args",
        },
    ],
    "active_listings": [
        {
            "name": "Active Listings",
            "script": "fetch_active_listings.py",
            "description": "Currently active for-sale listings across metro cities",
        },
    ],
}

# Post-ingest steps that always run after any tier updates
POST_STEPS = [
    {
        "name": "Build Dashboard Data",
        "script": "build_dashboard_data.py",
        "description": "Assemble dashboard_data.json from all data sources",
    },
]

# Optional step that requires extra dependencies (CLIP + torch)
VISUAL_QUALITY_STEP = {
    "name": "Visual Quality Assessment",
    "script": "assess_visual_quality.py",
    "description": "Score property photos using CLIP embeddings",
}

# Shorthand aliases for --tier
TIER_ALIASES = {
    "active":  "active_listings",
    "sold":    "sold_homes",
    "trends":  "market_trends",
}


def build_sold_args(args):
    """Build arguments for ingest_redfin_sold.py."""
    cmd_args = []
    if args.sold_days is not None:
        cmd_args.append(str(args.sold_days))
    if args.full:
        cmd_args.append("--full")
    return cmd_args


def run_step(step, args):
    """Run a single pipeline step. Returns True on success."""
    script = os.path.join(SCRIPT_DIR, step["script"])

    if not os.path.exists(script):
        print(f"  WARNING: {step['script']} not found, skipping")
        return True

    cmd = [sys.executable, script]

    # Build script-specific arguments
    args_builder = step.get("args_builder")
    if args_builder == "sold_args":
        cmd.extend(build_sold_args(args))
    elif args.full:
        # Pass --full to scripts that support it
        cmd.append("--full")

    # Pass --force-photos to build_dashboard_data.py
    if step["script"] == "build_dashboard_data.py" and args.force_photos:
        cmd.append("--force-photos")

    # Pass --force to assess_visual_quality.py if force_visual_quality is set
    if step["script"] == "assess_visual_quality.py" and args.force_visual_quality:
        cmd.append("--force")

    start = time.time()
    result = subprocess.run(cmd, cwd=os.path.dirname(SCRIPT_DIR))
    elapsed = time.time() - start

    if result.returncode != 0:
        print(f"  FAILED (exit code {result.returncode}, {elapsed:.0f}s)\n")
        return False

    print(f"  Completed in {elapsed:.0f}s\n")
    return True


def resolve_tiers(args):
    """Determine which tiers to run based on arguments."""
    if args.if_stale:
        stale = pipeline_state.get_stale_tiers()
        if not stale:
            print("All tiers are fresh. Nothing to do.\n")
            return []
        print(f"Stale tiers: {', '.join(stale)}\n")
        return stale

    if args.tier:
        tier = TIER_ALIASES.get(args.tier, args.tier)
        if tier not in TIER_STEPS:
            print(f"Unknown tier: {args.tier}")
            print(f"Available: {', '.join(list(TIER_ALIASES.keys()) + list(TIER_STEPS.keys()))}")
            sys.exit(1)
        return [tier]

    # Default: all tiers
    return list(TIER_STEPS.keys())


def main():
    parser = argparse.ArgumentParser(
        description="Run the housing data pipeline."
    )
    parser.add_argument(
        "--tier", type=str, default=None,
        help="Run only a specific tier: active, sold, trends"
    )
    parser.add_argument(
        "--if-stale", action="store_true",
        help="Only run tiers whose data is older than their cadence"
    )
    parser.add_argument(
        "--skip-visual-quality", action="store_true",
        help="Skip visual quality assessment (requires CLIP dependencies)"
    )
    parser.add_argument(
        "--force-photos", action="store_true",
        help="Re-fetch all photo URLs from Redfin (ignore cache)"
    )
    parser.add_argument(
        "--force-visual-quality", action="store_true",
        help="Re-score all properties with visual quality assessment (ignore cache)"
    )
    parser.add_argument(
        "--sold-days", type=int, default=None,
        help="Override sold-within-days for Redfin sold homes (default: 90)"
    )
    parser.add_argument(
        "--full", action="store_true",
        help="Force full refresh (skip incremental optimizations)"
    )
    args = parser.parse_args()

    # Load config for metro name in banner
    config_path = os.path.join(os.path.dirname(SCRIPT_DIR), "config.json")
    with open(config_path) as f:
        config = json.load(f)
    metro_name = config.get("metro", {}).get("name", "Housing Data")

    print("=" * 60)
    print(f"  {metro_name} Housing Data Pipeline")
    print("=" * 60)
    print()

    tiers_to_run = resolve_tiers(args)
    if not tiers_to_run:
        sys.exit(0)

    total_start = time.time()
    failures = []
    step_num = 0

    # Collect all ingest steps for selected tiers
    ingest_steps = []
    for tier in tiers_to_run:
        ingest_steps.extend([(tier, s) for s in TIER_STEPS[tier]])

    vq_steps = 0 if args.skip_visual_quality else 1
    total_steps = len(ingest_steps) + len(POST_STEPS) + vq_steps

    # Run ingest steps
    for tier, step in ingest_steps:
        step_num += 1
        print(f"[{step_num}/{total_steps}] {step['name']}")
        print(f"     {step['description']}")
        if run_step(step, args):
            pipeline_state.record_update(tier)
        else:
            failures.append(step["name"])

    # Always run post-ingest steps (combine + build) if any ingest succeeded
    if len(failures) < len(ingest_steps):
        for step in POST_STEPS:
            step_num += 1
            print(f"[{step_num}/{total_steps}] {step['name']}")
            print(f"     {step['description']}")
            if not run_step(step, args):
                failures.append(step["name"])

        # Visual quality assessment (optional, requires CLIP dependencies)
        if not args.skip_visual_quality:
            step_num += 1
            step = VISUAL_QUALITY_STEP
            print(f"[{step_num}/{total_steps}] {step['name']}")
            print(f"     {step['description']}")
            if run_step(step, args):
                # Re-run build to attach visual quality scores to dashboard_data.json
                print(f"[{step_num}/{total_steps}] Rebuilding dashboard data with visual quality scores...")
                rebuild_step = POST_STEPS[-1]  # Build Dashboard Data
                if not run_step(rebuild_step, args):
                    failures.append("Rebuild Dashboard Data")
            else:
                print("  Visual quality assessment failed (missing dependencies?). Continuing.\n")
    else:
        print("All ingest steps failed. Skipping combine and build.\n")

    total_elapsed = time.time() - total_start
    print("=" * 60)

    if failures:
        print(f"  Pipeline finished with errors ({total_elapsed:.0f}s)")
        print(f"  Failed steps: {', '.join(failures)}")
        sys.exit(1)
    else:
        print(f"  Pipeline complete ({total_elapsed:.0f}s)")
        print(f"  Tiers updated: {', '.join(tiers_to_run)}")
        sys.exit(0)


if __name__ == "__main__":
    main()
