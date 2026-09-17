#!/usr/bin/env bash
# Run the pipeline on this machine, on demand.
#
# There is no automation here -- the GitHub Actions workflows only run on
# GitHub's servers. This is the manual equivalent.
#
#   ./scripts/run_local.sh seed        one-time: pull the published dataset as a baseline
#   ./scripts/run_local.sh shortlist   derive your role shortlist from that baseline
#   ./scripts/run_local.sh fast        scrape only shortlisted companies, then merge  (minutes)
#   ./scripts/run_local.sh full        scrape every company, then merge               (HOURS)
#   ./scripts/run_local.sh serve       serve the site against your local data
#   ./scripts/run_local.sh new         list the jobs first seen in the last 24h
#   ./scripts/run_local.sh country     backfill the country field on existing data
#
# Typical first run:  seed -> country -> shortlist -> fast -> serve
# After that, just:   fast   (then refresh the browser)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Seed source for `run_local.sh seed`. No default account is baked in: set it
# to your own published chunk repo, or to any dataset you have rights to use.
DATA_REPO="${DATA_REPO:-}"
PORT="${PORT:-8000}"
# Prefer the project venv so no activation step is needed; fall back to
# whatever python3 is on PATH.
if [ -n "${PYTHON:-}" ]; then
    PY="$PYTHON"
elif [ -x "$ROOT/.venv/bin/python3" ]; then
    PY="$ROOT/.venv/bin/python3"
else
    PY="python3"
fi

die() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }
step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

check_deps() {
    command -v "$PY" >/dev/null || die "$PY not found"
    "$PY" - <<'EOF' || die "missing dependency. Install with: pip install -r requirements.txt
(or use a venv: python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt)"
import sys
try:
    import requests  # noqa: F401
except ImportError:
    sys.exit(1)
EOF
}

cmd_seed() {
    step "Seeding data/chunks from a published dataset"
    if [ -f data/chunks/jobs_manifest.json ]; then
        printf 'data/chunks already populated. Delete it first to re-seed.\n'
        return 0
    fi
    [ -n "$DATA_REPO" ] || die "set DATA_REPO to a chunk repo first, e.g.
  DATA_REPO=https://github.com/you/job-board-data.git ./scripts/run_local.sh seed
Or skip seeding entirely and build the dataset yourself:
  ./scripts/run_local.sh full   (scrapes every company; takes hours)"
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' RETURN
    git clone --depth 1 "$DATA_REPO" "$tmp/data-repo"
    mkdir -p data/chunks
    cp -r "$tmp/data-repo/data/chunks/." data/chunks/
    cp "$tmp/data-repo/data/metadata.json" data/metadata.json 2>/dev/null || true
    printf 'Seeded %s chunk files.\n' "$(find data/chunks -name 'jobs_chunk_*.json.gz' | wc -l | tr -d ' ')"
}

cmd_shortlist() {
    step "Building role shortlist from data/chunks"
    [ -f data/chunks/jobs_manifest.json ] || die "no local data yet. Run: ./scripts/run_local.sh seed"
    "$PY" scripts/build_shortlist.py --from-chunks
}

cmd_fast() {
    check_deps
    [ -f data/role_shortlist.json ] || die "no shortlist yet. Run: ./scripts/run_local.sh shortlist"
    step "Scraping shortlisted companies"
    ( cd scripts && "$PY" scraper.py --source manual --shortlist ../data/role_shortlist.json )
    step "Merging into data/chunks"
    "$PY" scripts/merge_data.py
    cmd_new
}

cmd_full() {
    check_deps
    step "Full scrape of every company -- this takes hours"
    ( cd scripts && "$PY" scraper.py --source manual )
    step "Merging into data/chunks"
    "$PY" scripts/merge_data.py
    step "Refreshing shortlist from the full scrape (all 7 platforms)"
    "$PY" scripts/build_shortlist.py
    cmd_new
}

cmd_new() {
    step "Jobs matching your preset, first seen in the last 24h"
    "$PY" - <<'EOF'
import os, sys
sys.path.insert(0, "scripts")
from datetime import datetime, timezone
from merge_data import load_chunks
from role_filter import load_config, compile_config, matches

jobs = load_chunks("data")
if not jobs:
    print("No local data. Run: ./scripts/run_local.sh seed")
    raise SystemExit(0)

compiled = compile_config(load_config())
now = datetime.now(timezone.utc)
fresh = []
for j in jobs:
    if not matches(j, compiled):
        continue
    fs = j.get("first_seen")
    if not fs:
        continue
    try:
        seen = datetime.fromisoformat(fs.replace("Z", "+00:00"))
    except ValueError:
        continue
    if (now - seen).total_seconds() <= 86400:
        fresh.append((seen, j))

fresh.sort(key=lambda x: x[0], reverse=True)
print(f"{len(fresh)} new matching job(s) out of {len(jobs):,} total\n")
for seen, j in fresh[:60]:
    hrs = (now - seen).total_seconds() / 3600
    print(f"  [{j.get('skill_level','?'):<5}] {(j.get('title') or '')[:68]}")
    print(f"          {j.get('company')} · {j.get('location') or 'n/a'} · {hrs:.0f}h ago")
    print(f"          {j.get('url')}")
if len(fresh) > 60:
    print(f"\n  ... and {len(fresh) - 60} more (see the web UI)")
EOF
}

cmd_country() {
    step "Backfilling country on data/chunks"
    [ -f data/chunks/jobs_manifest.json ] || die "no local data yet. Run: ./scripts/run_local.sh seed"
    "$PY" scripts/backfill_country.py
}

cmd_serve() {
    [ -f data/chunks/jobs_manifest.json ] || die "no local data yet. Run: ./scripts/run_local.sh seed"
    step "Serving on http://localhost:$PORT"
    printf 'Local data is used automatically on localhost.\n'
    printf 'Force either source with ?data=local or ?data=remote\n\n'
    printf '  http://localhost:%s/?roles=1&fresh=24&sort_key=first_seen&sort_dir=desc\n\n' "$PORT"
    exec "$PY" -m http.server "$PORT"
}

case "${1:-}" in
    seed)      cmd_seed ;;
    shortlist) cmd_shortlist ;;
    fast)      cmd_fast ;;
    full)      cmd_full ;;
    new)       cmd_new ;;
    country)   cmd_country ;;
    serve)     cmd_serve ;;
    *)
        awk 'NR>1 && /^#/ { sub(/^# ?/, ""); print; next } NR>1 { exit }' "${BASH_SOURCE[0]}"
        exit 1
        ;;
esac
