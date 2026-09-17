"""
Atomically publish a merged dataset to the directory nginx serves.

Why this exists: merge_data.save_chunks() deletes the old chunk files before
writing the new ones. That was harmless on GitHub Actions (the swap happened in
a git push) but with nginx serving the directory live, every merge would expose
a window where chunks are missing and the site is broken.

So merge writes to the working copy (data/chunks), and this publishes it by
building a fresh release directory and flipping a symlink with rename(2), which
is atomic. In-flight requests keep reading the old release until they finish.

Layout it maintains:

    <dest>/releases/2026-09-17T15-04-05Z/   chunks/... + metadata.json
    <dest>/current -> releases/2026-09-17T15-04-05Z

Usage:
    python scripts/publish.py --dest /srv/jobboard
    python scripts/publish.py --dest /srv/jobboard --keep 5
"""

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path


def validate(source):
    """Refuse to publish a partial dataset.

    A failed or interrupted merge can leave the manifest pointing at chunks that
    were never written. Publishing that would break the site just as surely as
    the race we're trying to avoid, so check before we touch the symlink.
    """
    chunks_dir = source / "chunks"
    manifest_path = chunks_dir / "jobs_manifest.json"
    if not manifest_path.exists():
        raise SystemExit(f"error: no manifest at {manifest_path}")

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    listed = manifest.get("chunks") or []
    if not listed:
        raise SystemExit("error: manifest lists no chunks")

    missing = [c for c in listed if not (chunks_dir / c).exists()]
    if missing:
        raise SystemExit(
            f"error: manifest lists {len(missing)} chunk(s) that do not exist "
            f"(first: {missing[0]}). Refusing to publish a partial dataset."
        )

    empty = [c for c in listed if (chunks_dir / c).stat().st_size == 0]
    if empty:
        raise SystemExit(f"error: {len(empty)} chunk(s) are zero bytes (first: {empty[0]})")

    return manifest, listed


def link_or_copy(src, dst):
    """Hardlink when possible (instant, no extra disk), else copy."""
    try:
        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)


def prune(releases_dir, keep, protect):
    """Drop old releases, keeping the newest `keep` and never the live one."""
    entries = sorted(
        (p for p in releases_dir.iterdir() if p.is_dir()),
        key=lambda p: p.name,
        reverse=True,
    )
    for old in entries[keep:]:
        if old.resolve() == protect.resolve():
            continue
        shutil.rmtree(old, ignore_errors=True)
        print(f"  pruned old release {old.name}")


def main():
    parser = argparse.ArgumentParser(description="Atomically publish merged data")
    parser.add_argument("--source", default="data", help="merged working copy (default: data)")
    parser.add_argument("--dest", required=True, help="served root, e.g. /srv/jobboard")
    parser.add_argument("--keep", type=int, default=3, help="releases to retain (default: 3)")
    args = parser.parse_args()

    source = Path(args.source)
    dest = Path(args.dest)
    manifest, listed = validate(source)

    releases = dest / "releases"
    releases.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%SZ")
    release = releases / stamp
    if release.exists():
        shutil.rmtree(release)
    (release / "chunks").mkdir(parents=True)

    for name in listed + ["jobs_manifest.json"]:
        link_or_copy(source / "chunks" / name, release / "chunks" / name)

    meta = source / "metadata.json"
    if meta.exists():
        link_or_copy(meta, release / "metadata.json")

    # Flip the symlink atomically: create it under a temp name in the same
    # directory, then rename over the existing one. rename(2) is atomic, so a
    # reader sees either the old release or the new one, never neither.
    current = dest / "current"
    tmp_link = dest / ".current.new"
    if tmp_link.exists() or tmp_link.is_symlink():
        tmp_link.unlink()
    os.symlink(release.resolve(), tmp_link)
    os.replace(tmp_link, current)

    total = manifest.get("totalJobs", "?")
    print(f"Published {len(listed)} chunks ({total:,} jobs) as {stamp}" if isinstance(total, int)
          else f"Published {len(listed)} chunks as {stamp}")
    print(f"  {current} -> releases/{stamp}")

    prune(releases, args.keep, current)


if __name__ == "__main__":
    sys.exit(main())
