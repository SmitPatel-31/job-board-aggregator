# Server deployment

Runs the whole pipeline on one Linux server: nginx serves the site, two systemd
timers do the scraping. No GitHub involvement, no tokens, no data repo.

**Cloud-agnostic.** It needs only systemd, nginx and python3, so the same steps
work on an Azure VM, AWS EC2, GCP Compute Engine, Hetzner or bare metal.
Nothing calls a provider API. Only two things differ per provider:

| | Azure | AWS | GCP |
| --- | --- | --- | --- |
| VM size (8 GB RAM) | `Standard_B2ms` or `Standard_D2s_v5` | `t3.large` | `e2-standard-2` |
| Firewall | Network Security Group | Security Group | VPC firewall rule |

Pick Ubuntu 22.04/24.04 LTS on any of them and the `apt` path is used.

## How it runs "continuously"

The scrape is a **batch job, not a daemon**. Two separate things live on the box:

| | Type | Behaviour |
| --- | --- | --- |
| `nginx` | long-running daemon | always up, serves the site and the data |
| `jobboard-fast.service` | `oneshot` | fires every 6h, runs 1.5-2h, exits |
| `jobboard-full.service` | `oneshot` | fires daily 07:33 UTC, runs hours, exits |

systemd timers are used rather than cron because they log to journald, survive
reboots (`Persistent=true` catches a missed run), and won't start a second copy
of a service that's still running.

The two modes additionally share a `flock`, because the full scrape runs for
hours and a fast run firing mid-way would corrupt the shared working copy. A
skipped run says so in the journal rather than queueing up.

## Instance sizing

Measured against the real 1.46M-job dataset:

| | Peak RSS |
| --- | --- |
| holding the existing dataset | 2.28 GB |
| fast-tier run | ~2.5 GB |
| full scrape (holds existing + new) | ~5 GB |

- **2 GB will be OOM-killed.** Don't (`Standard_B1ms` / `t3.small`).
- **4 GB** is fine for the fast tier, tight for a full scrape (`Standard_B2s` / `t3.medium`).
- **8 GB** is what this config assumes, since you run both
  (`Standard_B2ms` / `t3.large` / `e2-standard-2`).

Disk: **30 GB**. The served data is only 72 MB, but a full scrape writes
`scripts/output/all_jobs.json` uncompressed at roughly 1.5 GB, plus a `.gz`.

The unit files set `MemoryHigh`/`MemoryMax` so the kernel applies reclaim
pressure before the OOM killer picks a victim — which might otherwise be nginx.

## Install

```bash
sudo bash deploy/server-setup.sh       # idempotent; re-run after a git pull
```

Then, manually:

1. **Edit `server_name`** in the nginx config (`/etc/nginx/sites-available/jobboard`).
2. **TLS** — point your domain's A record at the instance, then:
   ```bash
   sudo certbot --nginx -d your.domain.com
   ```
   certbot rewrites the config to add the TLS block and the HTTP→HTTPS redirect.
   The shipped config is HTTP-only on purpose: naming certificate paths that
   don't exist yet stops nginx from starting.
3. **Firewall** — 80 and 443 open, 22 restricted to your own IP.
   Azure: Network Security Group. AWS: Security Group. GCP: VPC firewall rule.

## Bootstrapping the data

Chicken-and-egg: the fast tier needs `data/role_shortlist.json`, which only a
full scrape produces. Either wait for one, or seed:

```bash
# Option A: run the full scrape now, wait hours
sudo systemctl start jobboard-full.service

# Option B: seed from the published dataset in seconds
sudo -u jobboard /srv/jobboard/app/scripts/run_local.sh seed
sudo -u jobboard /srv/jobboard/app/scripts/run_local.sh shortlist
sudo -u jobboard env JOBBOARD_DEST=/srv/jobboard \
     /srv/jobboard/app/.venv/bin/python3 /srv/jobboard/app/scripts/publish.py --dest /srv/jobboard
```

## Why data is published, not served in place

`merge_data.save_chunks()` deletes the old chunk files before writing the new
ones. Under GitHub Actions that was invisible (the swap happened in a git push),
but with nginx serving that directory live it would expose a window where chunks
are missing and the site is broken.

So the merge writes a working copy in `data/chunks`, and `scripts/publish.py`
publishes it:

```
/srv/jobboard/releases/2026-09-17T15-04-05Z/chunks/...
/srv/jobboard/current -> releases/2026-09-17T15-04-05Z
```

The symlink is flipped with `rename(2)`, which is atomic — a reader sees the old
release or the new one, never a half-written mix. Files are hardlinked, so
retaining 3 releases costs almost nothing. `publish.py` also refuses to publish
if the manifest references a missing or zero-byte chunk, so a failed merge can't
take the site down.

## Operating it

```bash
systemctl list-timers 'jobboard-*'              # when each next fires
journalctl -u jobboard-fast.service -f          # follow a run
journalctl -u jobboard-full.service --since today
sudo systemctl start jobboard-fast.service      # run now, ignore the schedule
ls -l /srv/jobboard/current                     # which release is live
```

## The thing most likely to break: rate limiting

On GitHub Actions the scrape came from Azure's rotating runner pool — thousands
of shared IPs. On your own server it is **one fixed address**.

This is measured, not theoretical: a real fast-tier run logged **340+ HTTP 429s,
every one from Ashby**. Six of seven platforms finished in minutes; Ashby took
over 1.5 hours because each 429 triggers exponential backoff. It does not break
the run -- it just costs ~90% of the runtime.

If you want the fast tier back under 10 minutes, drop Ashby from the shortlist
and let the daily full scrape cover it:

```python
# scripts/build_shortlist.py -- skip Ashby when building for the fast tier
if key == 'ashby':
    continue
```

This is why the full run records a trend snapshot and then runs
`check_anomalies.py`: a platform collapsing against its own 7-day baseline is
what a block looks like from the inside. It exits non-zero off GitHub, and
`run_pipeline.sh` turns that into a loud `WARNING` in the journal.

Check for it with:

```bash
journalctl -u jobboard-full.service --since '2 days ago' | grep -i warning
```

If a platform does get blocked outright (not just throttled), widen the timer
interval further rather than pushing harder.

## Security notes

- The CSP in the nginx config omits `script-src 'unsafe-inline'`, which is
  possible because the app has no inline `<script>` blocks or `onclick`
  handlers. This blocks the stored-XSS path in `js/map_view.js`, where a hostile
  job title injects `<img onerror=...>` via `innerHTML`. It is a mitigation, not
  a fix — the underlying escaping bug is still there.
- Be careful editing the nginx config: **a location block with its own
  `add_header` discards every `add_header` inherited from the server block.**
  Caching is therefore set with `expires`, which doesn't reset inheritance. Add
  an `add_header Cache-Control` to a location and you silently drop the CSP.
- The chunk location sets `gzip off` and no `Content-Encoding`. The files are
  already gzip and the client decompresses them itself via
  `DecompressionStream`; advertising the encoding would make the browser
  decompress first and the JS would then fail on plain JSON.
- Services run as the unprivileged `jobboard` user with `ProtectSystem=full`,
  `ProtectHome=true` and `NoNewPrivileges=true`.
