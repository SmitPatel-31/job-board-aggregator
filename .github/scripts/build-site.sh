#!/usr/bin/env bash
# Assemble the GitHub Pages bundle in _site/.
#
# Pages deploys from an uploaded artifact rather than a branch, so the 74MB of
# chunk data can ship alongside the site without ever entering git history.
# That matters: committing regenerated chunks is exactly how the upstream repo's
# .git reached 6.0GB.
#
# Only what the browser actually needs is copied. scripts/, deploy/, the raw
# company lists, the salary table and the gazetteer are all build-time inputs
# and would add tens of MB to every deploy for nothing.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

rm -rf _site
mkdir -p _site/data/chunks _site/data/trends

# ── App shell ────────────────────────────────────────────────────────────────
cp index.html status.html styles.css favicon.ico _site/
cp -r js _site/js

# ── Runtime config the frontend fetches ──────────────────────────────────────
cp data/app_config.json _site/data/app_config.json
cp data/role_filter.json _site/data/role_filter.json

# ── The dataset ──────────────────────────────────────────────────────────────
if [ -f data/chunks/jobs_manifest.json ]; then
    cp data/chunks/jobs_manifest.json _site/data/chunks/
    # Copy only the chunks the manifest actually references, so a stale file
    # left over from a previous run never gets published.
    while read -r chunk; do
        cp "data/chunks/$chunk" "_site/data/chunks/$chunk"
    done < <(jq -r '.chunks[]' data/chunks/jobs_manifest.json)
else
    echo "::error::data/chunks/jobs_manifest.json is missing; refusing to publish an empty site."
    exit 1
fi

[ -f data/metadata.json ] && cp data/metadata.json _site/data/metadata.json
[ -f data/trends/daily.jsonl ] && cp data/trends/daily.jsonl _site/data/trends/daily.jsonl

# Jekyll would otherwise skip files and directories beginning with an underscore.
touch _site/.nojekyll

# ── Report ───────────────────────────────────────────────────────────────────
echo "Bundle assembled:"
echo "  chunks:     $(find _site/data/chunks -name 'jobs_chunk_*.json.gz' | wc -l | tr -d ' ')"
echo "  total jobs: $(jq -r '.totalJobs' _site/data/chunks/jobs_manifest.json)"
echo "  size:       $(du -sh _site | cut -f1)"
