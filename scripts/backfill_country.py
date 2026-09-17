"""
Backfill the `country` field on an existing merged dataset.

New scrapes set `country` themselves, but chunks written before that change have
no such field, and chunks are the only durable store -- so the region filter
would be blind to every pre-existing job until the whole 30-day window rolled
over. This resolves the country from each record's stored location string using
the same gazetteer the scraper uses, so accuracy matches a fresh scrape.

One-off, idempotent, and safe to re-run: records that already have a country are
left alone unless --force is passed.

Usage:
    python scripts/backfill_country.py              # data/chunks, in place
    python scripts/backfill_country.py --dry-run    # report coverage, write nothing
"""

import argparse
import gzip
import json
import os
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from geolocation import build_lookup, lookup_location

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCATIONS_FILE = os.path.join(ROOT_DIR, "data", "locations.json")


def main():
    parser = argparse.ArgumentParser(description="Backfill country on merged chunks")
    parser.add_argument("--dir", default="data", help="dataset dir (default: data)")
    parser.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    parser.add_argument("--force", action="store_true", help="recompute even if set")
    args = parser.parse_args()

    chunks_dir = Path(args.dir) / "chunks"
    manifest_path = chunks_dir / "jobs_manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"error: no manifest at {manifest_path}")

    print("Loading location gazetteer...")
    maps = build_lookup(LOCATIONS_FILE)

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    # Cache by location string: the dataset has ~1.5M jobs but far fewer
    # distinct locations, so this turns most lookups into a dict hit.
    cache = {}
    counts = Counter()
    resolved = skipped = total = 0

    for name in manifest["chunks"]:
        path = chunks_dir / name
        if not path.exists():
            print(f"  warning: {name} listed in manifest but missing, skipping")
            continue

        with gzip.open(path, "rt", encoding="utf-8") as f:
            jobs = json.load(f)

        changed = False
        for job in jobs:
            total += 1
            if job.get("country") and not args.force:
                counts[job["country"]] += 1
                skipped += 1
                continue

            loc = job.get("location") or ""
            if loc not in cache:
                cache[loc] = lookup_location(loc, maps)["country"]
            country = cache[loc]

            if country:
                job["country"] = country
                counts[country] += 1
                resolved += 1
                changed = True
            else:
                counts["(unresolved)"] += 1

        if changed and not args.dry_run:
            tmp = path.with_suffix(path.suffix + ".tmp")
            with gzip.open(tmp, "wt", encoding="utf-8") as f:
                json.dump(jobs, f, ensure_ascii=False, indent=0)
            os.replace(tmp, path)

        print(f"  {name}: {len(jobs):,} jobs")

    print()
    print(f"Scanned {total:,} jobs across {len(cache):,} distinct location strings")
    print(f"  resolved:   {resolved:,}")
    print(f"  already set: {skipped:,}")
    unresolved = counts.pop("(unresolved)", 0)
    print(f"  unresolved: {unresolved:,} ({unresolved / max(total, 1) * 100:.1f}%)")
    print()
    print("Top countries:")
    for code, n in counts.most_common(12):
        print(f"  {code:<6} {n:>9,}  ({n / max(total, 1) * 100:.1f}%)")

    if args.dry_run:
        print("\n(dry run - nothing written)")


if __name__ == "__main__":
    main()
