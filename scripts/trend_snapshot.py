"""
Append today's per-platform and per-tier counts to data/trends/daily.jsonl.

This is the portable equivalent of the jq block in scrape-jobs.yml, so the trend
log (and therefore check_anomalies.py) works anywhere the pipeline runs, not just
on GitHub Actions. Anomaly detection matters more off GitHub: a single static IP
getting rate-limited shows up here as a platform's volume falling off a cliff.

One JSON object per line, keyed by date. Re-running on the same day replaces that
day's entry rather than appending a duplicate, since check_anomalies.py dedupes
by date anyway and a duplicate would silently skew the baseline.

Usage:
    python scripts/trend_snapshot.py
"""

import json
import os
from collections import Counter
from datetime import datetime, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
ALL_JOBS = os.path.join(SCRIPT_DIR, "output", "all_jobs.json")
ACTIVE_COMPANIES = os.path.join(SCRIPT_DIR, "output", "active_companies.json")
SCRAPE_METADATA = os.path.join(SCRIPT_DIR, "output", "metadata.json")
MERGED_METADATA = os.path.join(ROOT_DIR, "data", "metadata.json")
TRENDS_FILE = os.path.join(ROOT_DIR, "data", "trends", "daily.jsonl")

PLATFORMS = ["Greenhouse", "Ashby", "BambooHR", "Lever", "Workday", "iCIMS", "Paylocity"]
TIERS = ["intern", "entry", "mid", "senior"]


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        if default is None:
            raise SystemExit(f"error: required file missing or invalid: {path}")
        return default


def main():
    jobs = load_json(ALL_JOBS)
    by_ats = Counter(j.get("ats") for j in jobs)
    by_tier = Counter(j.get("skill_level") for j in jobs)

    snapshot = {
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        # total_jobs is the merged dataset size, not just this scrape
        "total_jobs": load_json(MERGED_METADATA, {}).get("total_jobs", len(jobs)),
        "active_companies": len(load_json(ACTIVE_COMPANIES, {})),
        "recruiter_jobs": load_json(SCRAPE_METADATA, {}).get("recruiter_jobs", 0),
        "by_platform": {p.lower(): by_ats.get(p, 0) for p in PLATFORMS},
        "by_tier": {t: by_tier.get(t, 0) for t in TIERS},
    }

    os.makedirs(os.path.dirname(TRENDS_FILE), exist_ok=True)

    rows = []
    if os.path.exists(TRENDS_FILE):
        with open(TRENDS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    row = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if row.get("date") != snapshot["date"]:
                    rows.append(row)

    rows.append(snapshot)
    rows.sort(key=lambda r: r.get("date", ""))

    tmp = TRENDS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    os.replace(tmp, TRENDS_FILE)

    print(f"Trend snapshot for {snapshot['date']}:")
    print(f"  total jobs (merged): {snapshot['total_jobs']:,}")
    print(f"  active companies:    {snapshot['active_companies']:,}")
    for platform, count in snapshot["by_platform"].items():
        print(f"    {platform:<12} {count:,}")
    print(f"  {len(rows)} day(s) of history in {TRENDS_FILE}")


if __name__ == "__main__":
    main()
