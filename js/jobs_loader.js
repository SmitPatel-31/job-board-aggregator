// ============================================================
// JOBS LOADER
// ============================================================

import { enableMap } from "./map_view.js";
import { populateCountryFilter } from "./country_filter.js";

// Where chunk data comes from. A local scrape writes to ./data/chunks; an
// optional published mirror is declared in data/app_config.json so no account
// or host is hardcoded here.
const LOCAL_BASE = 'data/chunks';
let remoteBase = null;

async function getRemoteBase() {
    if (remoteBase !== null) return remoteBase;
    try {
        const res = await fetch('data/app_config.json', { cache: 'no-store' });
        remoteBase = res.ok ? ((await res.json()).remoteDataBase || '') : '';
    } catch {
        remoteBase = '';
    }
    return remoteBase;
}

/**
 * Decide which chunk source to load.
 *
 * Local data wins whenever a manifest is actually present, which is the normal
 * case for a self-hosted deployment. A remote mirror is only used if one is
 * configured in data/app_config.json. ?data=local / ?data=remote forces it.
 *
 * The result is always an absolute URL: chunk_worker.js resolves relative URLs
 * against its own location (/js/), so a bare 'data/chunks' would 404 there.
 * @returns {Promise<{base: string, label: 'local'|'remote'}>}
 */
export async function resolveDataSource() {
    const absolute = path => new URL(path, window.location.href).href;
    const forced = new URLSearchParams(window.location.search).get('data');
    const remote = await getRemoteBase();

    if (forced === 'local') return { base: absolute(LOCAL_BASE), label: 'local' };
    if (forced === 'remote' && remote) return { base: remote, label: 'remote' };

    try {
        const res = await fetch(`${LOCAL_BASE}/jobs_manifest.json`, { cache: 'no-store' });
        if (res.ok) return { base: absolute(LOCAL_BASE), label: 'local' };
    } catch {
        // no local dataset; fall through to the configured mirror if any
    }

    if (remote) return { base: remote, label: 'remote' };
    // Nothing configured: still return the local path so the caller surfaces a
    // clear "could not load" state rather than fetching an empty string.
    return { base: absolute(LOCAL_BASE), label: 'local' };
}

/**
 * Fetch and decompress a single gzipped JSON file.
 * @param {string} url - Path to the .json.gz file
 * @returns {Promise<Array>} Parsed JSON array
 */
export async function fetchAndDecompress(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to load ${url}`);

    const blob = await response.blob();
    const ds = new DecompressionStream('gzip');

    const text = await new Response(blob.stream().pipeThrough(ds))
        .blob()
        .then(b => b.text());

    return JSON.parse(text);
}

/**
 * Fetch and decompress a single gzipped JSON file.
 * @param {string} url - Path to the .json.gz file
 * @returns {Promise<Array>} Parsed JSON array
 */
export async function loadJobsProgressive(app, basePath = null) {
    document.querySelector('.job-table thead')?.classList.add('sorting-locked');

    const source = basePath
        ? { base: basePath, label: 'custom' }
        : await resolveDataSource();
    const base_url = source.base;
    console.log(`Loading job data from ${source.label} source: ${base_url}`);
    showDataSource(source.label);

    const manifest = await fetch(`${base_url}/jobs_manifest.json?t=${Date.now()}`).then(res => {
        if (!res.ok) throw new Error('Failed to load jobs manifest');
        return res.json();
    });

    const v = encodeURIComponent(manifest.last_updated);

    const firstChunk = await fetchAndDecompress(`${base_url}/${manifest.chunks[0]}?v=${v}`);
    app.allJobs = firstChunk;
    app.filteredJobs = firstChunk;
    updateStats(app.allJobs, manifest.last_updated);
    populateCountryFilter(app.allJobs);
    app.render();

    if (manifest.chunks.length <= 1) {
        app.isFullyLoaded = true;
        document.querySelector('.job-table thead')?.classList.remove('sorting-locked');
        enableMap();
        return;
    }

    const worker = new Worker('./js/chunk_worker.js', { type: 'module' });
    app.sortWorker = worker;
    let pending = manifest.chunks.length - 1;

    worker.onmessage = ({ data }) => {
        if (data.type === 'CHUNK_LOADED') {
            app.allJobs.push(...data.jobsChunk);
            app.refilter();
            updateStats(app.allJobs, manifest.last_updated);
            if (--pending === 0) {
                // Country counts are only final once every chunk is in.
                populateCountryFilter(app.allJobs);
                app.isFullyLoaded = true;
                document.querySelector('.job-table thead')?.classList.remove('sorting-locked');
                enableMap();
                console.log("All chunks successfully loaded.");
            }
        }
        if (data.type === 'SORTED') {
            app.sortedJobs = data.sortedJobs;
            app.virtualFilteredCount = data.sortedJobs.length;
            if (app.sortLoader?.hide) app.sortLoader.hide();
            app.isSorting = false;
            app.render();
        }
        if (data.type === 'SORT_ERROR') {
            console.error('Worker sort failed:', data.message);
            if (app.sortLoader?.hide) app.sortLoader.hide();
            app.isSorting = false;
        }
    };

    manifest.chunks.slice(1).forEach(chunk => {
        worker.postMessage({ type: 'FETCH_CHUNK', url: `${base_url}/${chunk}?v=${v}` });
    });
}

/**
 * Flag the active data source in the stats bar, so a local scrape is never
 * mistaken for the published dataset (or vice versa).
 * @param {'local'|'remote'|'custom'} label
 */
function showDataSource(label) {
    const el = document.getElementById('data-source');
    if (!el) return;
    if (label === 'remote') {
        el.textContent = '';
        el.className = '';
        return;
    }
    el.textContent = label === 'local' ? 'local data' : 'custom data';
    el.className = 'badge bg-warning text-dark ms-2';
    el.title = label === 'local'
        ? 'Reading ./data/chunks from your local scrape, not the published dataset'
        : 'Reading an explicitly supplied data source';
}

/**
 * Update the stats bar in the DOM.
 * @param {Array} jobs - The full jobs array
 * @param {string} [lastUpdated] - ISO timestamp from manifest
 */
export function updateStats(jobs, lastUpdated) {
    const companies = new Set(jobs.map(j => j.company_slug || j.company)).size;
    document.getElementById('total-jobs').textContent = jobs.length.toLocaleString();
    document.getElementById('total-companies').textContent = companies.toLocaleString();

    const el = document.getElementById('last-updated');
    if (!lastUpdated) {
        el.textContent = 'unknown';
        return;
    }
    const d = new Date(lastUpdated);
    if (isNaN(d.getTime())) {
        el.textContent = 'unknown';
        return;
    }

    // Date alone isn't enough to judge freshness when the pipeline runs several
    // times a day, so show the age too and flag a stale dataset.
    const hours = (Date.now() - d) / 3600000;
    el.textContent = `${d.toLocaleString()} (${formatAge(hours)})`;
    el.title = d.toISOString();
    el.className = hours > 26 ? 'text-danger fw-semibold' : '';
}

/** "just now" / "3h ago" / "2d ago" */
export function formatAge(hours) {
    if (hours < 1) return 'just now';
    if (hours < 24) return `${Math.floor(hours)}h ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? 'yesterday' : `${days}d ago`;
}