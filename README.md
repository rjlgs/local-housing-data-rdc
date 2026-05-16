# Local Housing Data Pipeline

A data pipeline for collecting, analyzing, and visualizing housing market data for the Raleigh-Cary, NC metro area.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         DATA PIPELINE & PHOTO LIFECYCLE                          │
└─────────────────────────────────────────────────────────────────────────────────┘

╔═══════════════════════════════════════════════════════════════════════════════════╗
║  TRIGGER: Daily 8am UTC cron │ Push to main │ Manual dispatch                     ║
╚═══════════════════════════════════════════════════════════════════════════════════╝
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           TIER 1: DATA FETCH                                     │
│  run_pipeline.py --if-stale                                                      │
├────────────────────────┬────────────────────────┬───────────────────────────────┤
│    active_listings     │      sold_homes        │       market_trends           │
│    (12h cadence)       │      (24h cadence)     │       (336h cadence)          │
│          │             │            │           │             │                 │
│          ▼             │            ▼           │             ▼                 │
│  fetch_active_         │  fetch_sold_           │   fetch_market_               │
│  listings.py           │  listings.py           │   trends.py                   │
│          │             │            │           │             │                 │
│          ▼             │            ▼           │             ▼                 │
│  redfin_active.csv     │  redfin_sold.csv       │  redfin_market_city.csv       │
│                        │                        │  redfin_market_zip.csv        │
│  ┌────────────┐        │                        │                               │
│  │ redfin_url │◄───────┼── Captured here,       │                               │
│  │ (per home) │        │   NOT photos yet       │                               │
│  └────────────┘        │                        │                               │
└────────────────────────┴────────────────────────┴───────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                      TIER 2: BUILD DASHBOARD DATA                                │
│  build_dashboard_data.py [--force-photos]                                        │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   For each home with redfin_url:                                                │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        PHOTO FETCHING FLOW                               │   │
│   │                                                                          │   │
│   │    redfin_url ──────► Cache lookup ──────► photo_urls_cache.json        │   │
│   │                            │                                             │   │
│   │               ┌────────────┴────────────┐                                │   │
│   │               │                         │                                │   │
│   │          [MISS or                  [HIT & not                            │   │
│   │          --force-photos]            --force-photos]                      │   │
│   │               │                         │                                │   │
│   │               ▼                         │                                │   │
│   │    HTTP GET redfin.com/home/123         │                                │   │
│   │               │                         │                                │   │
│   │               ▼                         │                                │   │
│   │    Parse HTML for CDN URLs              │                                │   │
│   │    ssl.cdn-redfin.com/photo/*           │                                │   │
│   │               │                         │                                │   │
│   │               ▼                         ▼                                │   │
│   │           Save to cache ──────────► Return photo_urls[]                  │   │
│   │                                                                          │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│                            Attach cached VQ scores                               │
│                            (if visual_quality_cache.json exists)                 │
│                                        │                                         │
│                                        ▼                                         │
│                             dashboard_data.json                                  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    TIER 3: VISUAL QUALITY ASSESSMENT (Optional)                  │
│  assess_visual_quality.py [--force] [--limit N]                                  │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   For each property with photo_urls:                                            │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                      VQ SCORING FLOW                                     │   │
│   │                                                                          │   │
│   │    photo_urls[] ──► MD5 hash ──► Cache lookup                           │   │
│   │                                       │                                  │   │
│   │                          ┌────────────┴────────────┐                     │   │
│   │                          │                         │                     │   │
│   │                    [MISS or hash                [HIT & hash              │   │
│   │                     changed or                   matches &               │   │
│   │                     --force]                     not --force]            │   │
│   │                          │                         │                     │   │
│   │                          ▼                         │                     │   │
│   │               Select 3-5 photos                    │                     │   │
│   │               (hero + sampled)                     │                     │   │
│   │                          │                         │                     │   │
│   │                          ▼                         │                     │   │
│   │               ┌──────────────────┐                 │                     │   │
│   │               │   CLIP Model     │                 │                     │   │
│   │               │   (ViT-B-32)     │                 │                     │   │
│   │               └────────┬─────────┘                 │                     │   │
│   │                        │                           │                     │   │
│   │         ┌──────────────┼──────────────┐            │                     │   │
│   │         ▼              ▼              ▼            │                     │   │
│   │    Condition       Finish        Aesthetic         │                     │   │
│   │    (1-10)          (1-10)        (1-10)            │                     │   │
│   │         │              │              │            │                     │   │
│   │         └──────────────┼──────────────┘            │                     │   │
│   │                        ▼                           │                     │   │
│   │               Average per property                 │                     │   │
│   │                        │                           │                     │   │
│   │                        ▼                           ▼                     │   │
│   │               Save to cache ──────────► Return scores                    │   │
│   │                                                                          │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                        │                                         │
│                                        ▼                                         │
│                          visual_quality_cache.json                               │
│                                        │                                         │
│                                        ▼                                         │
│                    Rebuild dashboard_data.json with VQ scores                    │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          TIER 4: DEPLOY TO GITHUB PAGES                          │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│    dashboard_data.json ─────► _site/ ─────► GitHub Pages                        │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Cache Files

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CACHE FILES SUMMARY                                 │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│   data/photo_urls_cache.json          data/visual_quality_cache.json            │
│   ┌────────────────────────────┐      ┌──────────────────────────────────┐      │
│   │ {                          │      │ {                                │      │
│   │   "redfin.com/home/123": [ │      │   "123 Main St": {               │      │
│   │     "cdn.../photo1.jpg",   │      │     "score": 7.2,                │      │
│   │     "cdn.../photo2.jpg"    │      │     "condition": 7.5,            │      │
│   │   ],                       │      │     "finish": 6.8,               │      │
│   │   "redfin.com/home/456": [ │      │     "aesthetic": 7.3,            │      │
│   │     "cdn.../photo3.jpg"    │      │     "photo_hash": "a1b2c3d4",    │      │
│   │   ]                        │      │     "assessed_at": "2024-..."    │      │
│   │ }                          │      │   }                              │      │
│   └────────────────────────────┘      │ }                                │      │
│                                       └──────────────────────────────────┘      │
│   Key: redfin_url                      Key: address                             │
│   Invalidate: --force-photos           Invalidate: --force OR photo_hash change │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Usage

### Run the full pipeline

```bash
python3 scripts/run_pipeline.py              # run all tiers
python3 scripts/run_pipeline.py --if-stale   # only run stale tiers
python3 scripts/run_pipeline.py --tier sold  # just sold homes
```

### Force re-verification

```bash
# Re-fetch all photo URLs (bypass cache)
python3 scripts/build_dashboard_data.py --force-photos

# Re-score all visual quality (bypass cache)
python3 scripts/assess_visual_quality.py --force

# Full re-verification (both photos and VQ)
python3 scripts/build_dashboard_data.py --force-photos && \
python3 scripts/assess_visual_quality.py --force && \
python3 scripts/build_dashboard_data.py
```

### Start local dev server

```bash
bash start.sh
# Dashboard available at http://localhost:8080/dashboard
```

## Data Sources

| Source | Cadence | Script |
|--------|---------|--------|
| Redfin Active Listings | 12h | `fetch_active_listings.py` |
| Redfin Sold Homes | 24h | `fetch_sold_listings.py` |
| Redfin Market Trends | 2 weeks | `fetch_market_trends.py` |
