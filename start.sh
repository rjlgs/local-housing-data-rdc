#!/bin/bash
cd "$(dirname "$0")"

# Refresh any stale data tiers before serving
echo "Checking data freshness..."
python3 scripts/run_pipeline.py --if-stale

echo ""
echo "Starting dashboard at http://localhost:8080"
python3 -m http.server 8080 --directory .
