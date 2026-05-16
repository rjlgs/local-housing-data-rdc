#!/usr/bin/env python3
"""
Generate a status page showing data freshness for each pipeline tier.
"""

import json
from datetime import datetime
from pathlib import Path

STATE_FILE = Path(__file__).parent.parent / "data" / "pipeline_state.json"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "status.html"

TIER_INFO = {
    "active_listings": {"label": "Active Listings", "cadence": "12h"},
    "sold_homes": {"label": "Sold Homes", "cadence": "24h"},
    "market_trends": {"label": "Market Trends", "cadence": "2 weeks"},
    "county_parcels": {"label": "County Parcels", "cadence": "2 weeks"},
}

CADENCE_HOURS = {
    "active_listings": 12,
    "sold_homes": 24,
    "market_trends": 336,
    "county_parcels": 336,
}


def load_state():
    if STATE_FILE.exists():
        with open(STATE_FILE) as f:
            return json.load(f)
    return {}


def format_age(last_run_iso):
    """Return human-readable age string."""
    if not last_run_iso:
        return "Never"
    try:
        last = datetime.fromisoformat(last_run_iso)
        delta = datetime.now() - last
        hours = delta.total_seconds() / 3600
        if hours < 1:
            return f"{int(delta.total_seconds() / 60)}m ago"
        elif hours < 24:
            return f"{int(hours)}h ago"
        else:
            days = int(hours / 24)
            return f"{days}d ago"
    except (ValueError, TypeError):
        return "Unknown"


def get_status_class(tier, last_run_iso):
    """Return CSS class based on freshness."""
    if not last_run_iso:
        return "stale"
    try:
        last = datetime.fromisoformat(last_run_iso)
        hours = (datetime.now() - last).total_seconds() / 3600
        cadence = CADENCE_HOURS.get(tier, 24)
        if hours <= cadence:
            return "fresh"
        elif hours <= cadence * 1.5:
            return "warning"
        else:
            return "stale"
    except (ValueError, TypeError):
        return "stale"


def generate_html(state):
    now = datetime.now().strftime("%Y-%m-%d %H:%M UTC")

    rows = []
    for tier, info in TIER_INFO.items():
        entry = state.get(tier, {})
        last_run = entry.get("last_run")
        age = format_age(last_run)
        status_class = get_status_class(tier, last_run)
        last_run_display = last_run[:19].replace("T", " ") if last_run else "—"

        rows.append(f"""
      <tr class="{status_class}">
        <td class="tier-name">{info['label']}</td>
        <td class="cadence">{info['cadence']}</td>
        <td class="last-run">{last_run_display}</td>
        <td class="age">{age}</td>
        <td class="status-indicator"><span class="dot"></span></td>
      </tr>""")

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pipeline Status</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{
      --bg: #f9fafb;
      --surface: #ffffff;
      --border: #e5e7eb;
      --text: #111827;
      --text-muted: #6b7280;
      --green: #16a34a;
      --yellow: #ca8a04;
      --red: #dc2626;
      --radius: 8px;
    }}
    body {{
      font-family: Inter, system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      font-size: 14px;
      padding: 2rem;
    }}
    .container {{
      max-width: 800px;
      margin: 0 auto;
    }}
    header {{
      margin-bottom: 2rem;
    }}
    h1 {{
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }}
    .subtitle {{
      color: var(--text-muted);
      font-size: 0.875rem;
    }}
    .card {{
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
    }}
    th, td {{
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }}
    th {{
      background: var(--bg);
      font-weight: 500;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }}
    tr:last-child td {{
      border-bottom: none;
    }}
    .tier-name {{
      font-weight: 500;
    }}
    .cadence, .last-run, .age {{
      color: var(--text-muted);
    }}
    .status-indicator {{
      text-align: center;
      width: 60px;
    }}
    .dot {{
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }}
    .fresh .dot {{
      background: var(--green);
      box-shadow: 0 0 6px var(--green);
    }}
    .warning .dot {{
      background: var(--yellow);
      box-shadow: 0 0 6px var(--yellow);
    }}
    .stale .dot {{
      background: var(--red);
      box-shadow: 0 0 6px var(--red);
    }}
    .footer {{
      margin-top: 1.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.75rem;
    }}
    .footer a {{
      color: var(--text-muted);
      text-decoration: underline;
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Pipeline Status</h1>
      <p class="subtitle">Data freshness for each pipeline tier</p>
    </header>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th>Tier</th>
            <th>Cadence</th>
            <th>Last Updated</th>
            <th>Age</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>{"".join(rows)}
        </tbody>
      </table>
    </div>

    <p class="footer">
      Generated: {now} &middot; <a href="dashboard/">View Dashboard</a>
    </p>
  </div>
</body>
</html>
"""


def main():
    state = load_state()
    html = generate_html(state)
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(html)
    print(f"Generated {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
