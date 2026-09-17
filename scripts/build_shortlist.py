"""
Build the fast-tier target list.

Any company that recently posted a matching role goes on the shortlist, grouped
by the platform key scraper.py expects. The hourly/fast scrape then hits only
these companies, which is why it finishes in minutes instead of hours.

Two sources:

  --from-output (default)
      scripts/output/all_jobs.json, i.e. the fat records from a full scrape.
      These still carry company_slug, so all seven platforms are covered.
      This is what CI uses after the daily run.

  --from-chunks
      The merged chunks in data/chunks. Useful locally, where a full scrape
      takes hours -- seed data/chunks from the published data repo and build a
      shortlist straight off it. The slim chunk records drop company_slug, so
      only the five platforms where company == slug can be recovered; Workday
      and Paylocity are skipped (see SLUG_IS_COMPANY).

Usage:
    python scripts/build_shortlist.py
    python scripts/build_shortlist.py --from-chunks
"""

import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, timezone

from merge_data import load_chunks
from role_filter import compile_config, load_config, matches

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
ALL_JOBS_FILE = os.path.join(SCRIPT_DIR, "output", "all_jobs.json")
OUTPUT_FILE = os.path.join(ROOT_DIR, "data", "role_shortlist.json")

# job["ats"] -> the platform key scraper.py uses for --shortlist lookups
ATS_TO_KEY = {
    "Greenhouse": "greenhouse",
    "Ashby": "ashby",
    "BambooHR": "bamboohr",
    "Lever": "lever",
    "Workday": "workday",
    "iCIMS": "icims",
    "Paylocity": "paylocity",
}

# Platforms where the scraper sets company == company_slug, so the slug can be
# read straight off a slim chunk record.
SLUG_IS_COMPANY = {"greenhouse", "ashby", "bamboohr", "lever", "icims"}

# Workday and Paylocity store something else in `company` (a parsed tenant name
# and a display name respectively), so their slugs don't survive into the slim
# chunks. They're recoverable by reversing the tracked company lists, which
# matters a lot: Workday is the single largest source of matching jobs.
WORKDAY_FILE = os.path.join(ROOT_DIR, "data", "workday_companies.json")
PAYLOCITY_FILE = os.path.join(ROOT_DIR, "data", "paylocity_companies_clean.json")


def build_slug_reverse_maps():
    """company-as-it-appears-in-chunks -> [full slugs], for Workday + Paylocity.

    Values are lists because a name can map to more than one tenant (a company
    with several Workday instances); including all of them is the safe choice.
    """
    workday = defaultdict(list)
    try:
        with open(WORKDAY_FILE, encoding="utf-8") as f:
            for slug in json.load(f):
                # "kohls|wd1|kohlscareers" -> scraper stores company="kohls"
                workday[slug.split("|")[0]].append(slug)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    paylocity = defaultdict(list)
    try:
        import html

        with open(PAYLOCITY_FILE, encoding="utf-8") as f:
            for row in json.load(f):
                guid, name = row.get("guid"), row.get("name")
                if guid:
                    # scraper stores company=html.unescape(name), falling back to guid
                    paylocity[html.unescape(name) if name else guid].append(guid)
    except (FileNotFoundError, json.JSONDecodeError):
        pass

    return {"workday": workday, "paylocity": paylocity}


def load_jobs(from_chunks):
    if from_chunks:
        jobs = load_chunks(os.path.join(ROOT_DIR, "data"))
        if not jobs:
            raise SystemExit(
                "No chunks found in data/chunks. Seed them first:\n"
                "  ./scripts/run_local.sh seed"
            )
        return jobs, True
    if not os.path.exists(ALL_JOBS_FILE):
        raise SystemExit(
            f"{ALL_JOBS_FILE} not found. Either run a full scrape first, or build\n"
            "from already-merged chunks instead:\n"
            "  python scripts/build_shortlist.py --from-chunks"
        )
    with open(ALL_JOBS_FILE, encoding="utf-8") as f:
        return json.load(f), False


def main():
    parser = argparse.ArgumentParser(description="Build the fast-tier shortlist")
    parser.add_argument(
        "--from-chunks",
        action="store_true",
        help=(
            "Build from data/chunks instead of a full scrape's output. Covers "
            "only the platforms where company == slug (skips Workday/Paylocity)."
        ),
    )
    args = parser.parse_args()

    cfg = load_config()
    compiled = compile_config(cfg)
    jobs, slim = load_jobs(args.from_chunks)
    print(f"Scanning {len(jobs):,} jobs for '{cfg['name']}' roles")

    by_platform = defaultdict(set)
    matched = 0
    unresolved = defaultdict(int)
    reverse_maps = build_slug_reverse_maps() if slim else {}

    for job in jobs:
        if not matches(job, compiled):
            continue
        matched += 1
        key = ATS_TO_KEY.get(job.get("ats"))
        if not key:
            continue

        slug = job.get("company_slug")
        if slug:
            by_platform[key].add(slug)
            continue

        # Slim chunk record: recover the slug from `company`.
        company = job.get("company")
        if not company:
            unresolved[key] += 1
            continue
        if key in SLUG_IS_COMPANY:
            by_platform[key].add(company)
        elif key in reverse_maps:
            resolved = reverse_maps[key].get(company)
            if resolved:
                by_platform[key].update(resolved)
            else:
                unresolved[key] += 1
        else:
            unresolved[key] += 1

    shortlist = {
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "preset": cfg["name"],
        "levels": sorted(cfg.get("levels") or []),
        "matched_jobs": matched,
        "source": "chunks" if args.from_chunks else "full_scrape",
        "platforms": {k: sorted(v) for k, v in sorted(by_platform.items())},
    }

    total = sum(len(v) for v in by_platform.values())
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(shortlist, f, ensure_ascii=False, indent=2)

    print(f"Matched {matched:,} jobs across {total:,} companies")
    for key, slugs in sorted(by_platform.items()):
        print(f"  {key}: {len(slugs):,} companies")
    for key, count in sorted(unresolved.items()):
        print(f"  {key}: {count:,} matches with no resolvable slug (skipped)")
    print(f"Wrote {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
