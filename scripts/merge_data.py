import json
import gzip
import os
import re
from pathlib import Path
from datetime import datetime, timezone

CHUNK_SIZE = 25_000


def get_dedup_key(job):
    url = job.get("url", "")
    ats = job.get("ats")
    if ats == "Workday":
        match = re.search(r'/jobs/(\d+)', url)
        if match:
            company = job.get("company", "")
            return f"workday:{company}:{match.group(1)}"
    if ats == "Paylocity":
        jid = job.get("id")
        if jid:
            return f"paylocity:{jid}"
        # no job_id: key on company+title so they don't collapse to one listing URL
        return f"paylocity:{job.get('company','')}:{job.get('title','')}"
    return url


def load_chunks(directory):
    """Load all jobs from chunked gzip files via manifest."""
    chunks_dir = Path(directory) / "chunks"
    manifest_path = chunks_dir / "jobs_manifest.json"
    if not manifest_path.exists():
        return []
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)
    jobs = []
    for chunk_file in manifest["chunks"]:
        chunk_path = chunks_dir / chunk_file
        if chunk_path.exists():
            with gzip.open(chunk_path, "rt", encoding="utf-8") as f:
                jobs.extend(json.load(f))
    return jobs


def save_chunks(jobs, directory, timestamp):
    """Write chunked gzip files + manifest."""
    chunks_dir = Path(directory) / "chunks"
    chunks_dir.mkdir(parents=True, exist_ok=True)

    # Clean old chunks
    for f in os.listdir(chunks_dir):
        if f.startswith("jobs_chunk_") and f.endswith(".json.gz"):
            os.remove(chunks_dir / f)

    # Sort consistently
    jobs.sort(key=lambda x: (x.get('company', '').lower(), x.get('title', '').lower()))
    chunks = [jobs[i:i + CHUNK_SIZE] for i in range(0, len(jobs), CHUNK_SIZE)]

    chunk_filenames = []
    for idx, chunk in enumerate(chunks):
        chunk_file = f"jobs_chunk_{idx}.json.gz"
        with gzip.open(chunks_dir / chunk_file, "wt", encoding="utf-8") as f:
            json.dump(chunk, f, ensure_ascii=False, indent=0)
        chunk_filenames.append(chunk_file)
        print(f"  Chunk {idx}: {len(chunk):,} jobs")

    manifest = {
        "chunks": chunk_filenames,
        "totalJobs": len(jobs),
        "last_updated": timestamp,
    }
    with open(chunks_dir / "jobs_manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def overlay_new_jobs(merged, new_jobs):
    """Overlay a scrape onto the existing {key: job} map, in place.

    The new scrape always wins on duplicates. Returns the count of genuinely new
    jobs -- keys that weren't present before this overlay. That key diff is the
    exact "new to the dataset" signal behind the "New for me" feed; unlike
    updated_at, which Ashby/BambooHR/Lever never send and Greenhouse uses to mean
    "last edited", it is reliable across all seven platforms.

    Safe for partial scrapes (the hourly fast tier): nothing absent from
    new_jobs is touched.
    """
    known_keys = set(merged)
    new_count = 0

    for job in new_jobs:
        key = get_dedup_key(job)
        if not key:
            continue
        if key in known_keys:
            # Carry the original first_seen forward. If the job predates the
            # field we leave it unset rather than backfilling to the last run's
            # scraped_at -- that would date every legacy job to yesterday and
            # flood the new-jobs feed on the first run after deploy.
            prior = merged[key].get("first_seen")
            if prior:
                job["first_seen"] = prior
            else:
                job.pop("first_seen", None)
        else:
            job["first_seen"] = job.get("scraped_at")
            new_count += 1
        merged[key] = job

    return new_count


def merge_job_data():
    """Merge new scrape with existing data, removing stale jobs."""
    new_jobs = load_chunks("scripts/output")
    print(f"New scrape: {len(new_jobs):,} jobs")

    existing_jobs = load_chunks("data")
    print(f"Existing data: {len(existing_jobs):,} jobs")

    # Merge by dedup key
    merged = {}
    stale_count = 0
    for job in existing_jobs:
        key = get_dedup_key(job)
        if not key:
            continue
        scraped = job.get("scraped_at")
        if scraped:
            try:
                scraped_date = datetime.fromisoformat(scraped.replace("Z", "+00:00"))
                age_days = (datetime.now(timezone.utc) - scraped_date).days
                if age_days <= 30:
                    merged[key] = job
                else:
                    stale_count += 1
            except Exception:
                merged[key] = job
        else:
            merged[key] = job

    if stale_count > 0:
        print(f"Dropped {stale_count:,} stale jobs (>30 days old)")

    new_count = overlay_new_jobs(merged, new_jobs)

    final_jobs = list(merged.values())
    print(f"Merged result: {len(final_jobs):,} jobs ({new_count:,} newly seen)")

    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    save_chunks(final_jobs, "data", timestamp)

    # Update metadata
    with open("scripts/output/metadata.json", encoding="utf-8") as f:
        metadata = json.load(f)
    metadata["total_jobs"] = len(final_jobs)
    metadata["new_jobs"] = new_count
    with open("data/metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    print("Merge complete")
    return len(final_jobs)


if __name__ == "__main__":
    merge_job_data()