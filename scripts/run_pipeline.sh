#!/usr/bin/env bash
# Pipeline body invoked by the systemd timers on the server.
#
#   run_pipeline.sh fast    scrape shortlisted companies only  (~6k companies)
#   run_pipeline.sh full    scrape every company               (~60k, hours)
#
# Both modes end by atomically publishing to $JOBBOARD_DEST, so nginx never
# serves a half-written dataset.
#
# Config via environment (see deploy/jobboard.env):
#   JOBBOARD_DEST   served root containing releases/ and current  (default /srv/jobboard)
#   JOBBOARD_KEEP   how many releases to retain                   (default 3)
#   PYTHON          interpreter to use                             (default .venv/bin/python3)
#
# A single lock is shared by both modes: the full scrape runs for hours, and
# without this a fast run firing mid-way would corrupt the shared working copy
# in data/chunks and scripts/output.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
DEST="${JOBBOARD_DEST:-/srv/jobboard}"
KEEP="${JOBBOARD_KEEP:-3}"
PY="${PYTHON:-$ROOT/.venv/bin/python3}"
# Not /var/lock: that's root-owned and not group-writable on most distros, so a
# non-root service user cannot create a lock file there.
LOCK="${JOBBOARD_LOCK:-$DEST/pipeline.lock}"

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[ -x "$PY" ] || die "python not found at $PY (set PYTHON=)"
case "$MODE" in
    fast|full) ;;
    *) die "usage: run_pipeline.sh {fast|full}" ;;
esac

# Must be checked before use: a missing flock makes `flock -n 9` exit non-zero,
# which is indistinguishable from "lock is held" and would silently skip every
# run forever while looking healthy in the journal. Present on any Linux with
# util-linux; absent on macOS, where this script is not meant to run (use
# run_local.sh there).
command -v flock >/dev/null || die "flock not found (util-linux). This script targets Linux; on macOS use scripts/run_local.sh"

# ── Serialize against the other mode ─────────────────────────────────────────
# flock -n fails immediately rather than queueing, so a skipped run is visible
# in the journal instead of piling up behind a long full scrape.
exec 9>"$LOCK"
if ! flock -n 9; then
    log "another pipeline run holds $LOCK - skipping this $MODE run"
    exit 0
fi

started=$(date +%s)
log "starting $MODE run"

# ── Scrape ───────────────────────────────────────────────────────────────────
if [ "$MODE" = fast ]; then
    [ -f data/role_shortlist.json ] || die "no data/role_shortlist.json - run a full scrape first"
    log "scraping shortlisted companies"
    ( cd scripts && "$PY" scraper.py --source automated --shortlist ../data/role_shortlist.json )
else
    log "scraping all companies (this takes hours)"
    ( cd scripts && "$PY" scraper.py --source automated )
fi

# ── Merge ────────────────────────────────────────────────────────────────────
log "merging into the working copy"
"$PY" scripts/merge_data.py

new_jobs=$("$PY" -c "import json;print(json.load(open('data/metadata.json')).get('new_jobs',0))")
total_jobs=$("$PY" -c "import json;print(json.load(open('data/metadata.json')).get('total_jobs',0))")
log "merge complete: $new_jobs new, $total_jobs total"

# ── Full-run-only bookkeeping ────────────────────────────────────────────────
# The shortlist is rebuilt only from a full scrape: those records still carry
# company_slug, so all seven platforms resolve without the reverse-map fallback.
if [ "$MODE" = full ]; then
    log "rebuilding role shortlist"
    "$PY" scripts/build_shortlist.py

    log "recording trend snapshot"
    "$PY" scripts/trend_snapshot.py
fi

# ── Publish ──────────────────────────────────────────────────────────────────
log "publishing to $DEST"
"$PY" scripts/publish.py --source data --dest "$DEST" --keep "$KEEP"

# ── Health check ─────────────────────────────────────────────────────────────
# Non-zero means a platform's volume moved sharply against its own baseline --
# on a single static IP that usually means rate-limited or blocked, so make it
# loud in the journal rather than failing the unit.
if ! "$PY" scripts/check_anomalies.py; then
    log "WARNING: anomaly detected above. A platform dropping to near-zero on a"
    log "WARNING: fixed IP usually means that ATS started blocking this host."
fi

log "$MODE run finished in $(( ($(date +%s) - started) / 60 ))m"
