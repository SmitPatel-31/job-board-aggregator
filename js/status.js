// ============================================================
// PIPELINE STATUS PAGE
// ============================================================
// Answers one question: how fresh is the data? Reads the same manifest the app
// loads (so it reports what's actually being served, not what a config claims),
// plus the trend log for per-platform health.

import { resolveDataSource, formatAge } from './jobs_loader.js';
import { initTheme } from './theme.js';

const PLATFORMS = ['greenhouse', 'ashby', 'bamboohr', 'lever', 'workday', 'icims', 'paylocity'];
const LABELS = {
    greenhouse: 'Greenhouse', ashby: 'Ashby', bamboohr: 'BambooHR',
    lever: 'Lever', workday: 'Workday', icims: 'iCIMS', paylocity: 'Paylocity',
};

const num = n => (typeof n === 'number' ? n.toLocaleString() : '—');

/** Replace a tbody's contents with rows built from DOM nodes (never innerHTML). */
function fillRows(tbody, rows) {
    tbody.textContent = '';
    for (const cells of rows) {
        const tr = document.createElement('tr');
        for (const cell of cells) {
            const td = document.createElement('td');
            if (cell && typeof cell === 'object') {
                td.textContent = cell.text ?? '';
                if (cell.className) td.className = cell.className;
            } else {
                td.textContent = cell ?? '';
            }
            tr.appendChild(td);
        }
        tbody.appendChild(tr);
    }
}

async function fetchJson(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
}

/** The trend log is JSONL: one JSON object per line. */
async function fetchTrends(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const text = await res.text();
    const rows = [];
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            rows.push(JSON.parse(trimmed));
        } catch {
            // tolerate a torn final line rather than blanking the page
        }
    }
    // Deduplicate by date, last write wins, then order oldest first.
    const byDate = new Map(rows.map(r => [r.date, r]));
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderFreshness(manifest, source) {
    const banner = document.getElementById('freshness-banner');
    const when = new Date(manifest.last_updated);

    if (isNaN(when.getTime())) {
        banner.className = 'alert alert-secondary mb-3';
        banner.textContent = 'The manifest has no usable timestamp.';
        return;
    }

    const hours = (Date.now() - when) / 3600000;
    // 26h rather than 24h so a slightly late daily run isn't flagged as broken.
    const level = hours > 26 ? 'alert-danger' : hours > 8 ? 'alert-warning' : 'alert-success';
    banner.className = `alert ${level} mb-3`;
    banner.textContent = `Last fetched ${when.toLocaleString()} — ${formatAge(hours)}`;
    banner.title = when.toISOString();

    document.getElementById('stat-chunks').textContent = num(manifest.chunks?.length);
    document.getElementById('stat-total').textContent = num(manifest.totalJobs);
    document.getElementById('source-note').textContent =
        `Serving the ${source.label} dataset from ${source.base}`;
}

function renderPlatforms(trends) {
    const tbody = document.getElementById('platform-rows');
    if (!trends.length) {
        fillRows(tbody, [[{ text: 'No trend history yet.', className: 'text-muted text-center' }, '', '', '']]);
        return;
    }

    const latest = trends[trends.length - 1];
    const baseline = trends.slice(-8, -1);   // the 7 runs before the latest
    document.getElementById('platform-date').textContent = ` — ${latest.date}`;

    const rows = PLATFORMS.map(key => {
        const value = latest.by_platform?.[key];
        const priors = baseline.map(t => t.by_platform?.[key]).filter(n => typeof n === 'number');
        const mean = priors.length ? priors.reduce((a, b) => a + b, 0) / priors.length : null;

        let delta = '—';
        let note = '';
        let className = '';
        if (typeof value === 'number' && mean) {
            const pct = (value / mean) * 100;
            delta = `${pct.toFixed(0)}% of average`;
            if (pct < 50) { note = 'possible block'; className = 'text-danger fw-semibold'; }
            else if (pct < 80) { note = 'below normal'; className = 'text-warning'; }
        }
        return [LABELS[key], { text: num(value), className: 'text-end' },
            { text: delta, className: `text-end ${className}` },
            { text: note, className }];
    });

    fillRows(tbody, rows);
}

function renderHistory(trends) {
    const tbody = document.getElementById('history-rows');
    if (!trends.length) {
        fillRows(tbody, [[{ text: 'No trend history yet.', className: 'text-muted text-center' }, '', '', '']]);
        return;
    }

    const recent = trends.slice(-14).reverse();
    const rows = recent.map((row, i) => {
        const prev = recent[i + 1];
        let change = '—';
        let className = 'text-end';
        if (prev && typeof row.total_jobs === 'number' && typeof prev.total_jobs === 'number') {
            const diff = row.total_jobs - prev.total_jobs;
            change = `${diff >= 0 ? '+' : ''}${diff.toLocaleString()}`;
            className += diff < 0 ? ' text-danger' : ' text-success';
        }
        return [row.date,
            { text: num(row.total_jobs), className: 'text-end' },
            { text: change, className },
            { text: num(row.active_companies), className: 'text-end' }];
    });

    fillRows(tbody, rows);

    const latest = trends[trends.length - 1];
    document.getElementById('stat-companies').textContent = num(latest.active_companies);
}

async function main() {
    initTheme();
    const source = await resolveDataSource();

    try {
        const manifest = await fetchJson(`${source.base}/jobs_manifest.json?t=${Date.now()}`);
        renderFreshness(manifest, source);
    } catch (err) {
        const banner = document.getElementById('freshness-banner');
        banner.className = 'alert alert-danger mb-3';
        banner.textContent = `Could not read the data manifest: ${err.message}`;
    }

    // new_jobs comes from the merge, and is only present once the pipeline has
    // run since that field was added -- so it's optional, not an error.
    try {
        const meta = await fetchJson('data/metadata.json');
        document.getElementById('stat-new').textContent = num(meta.new_jobs);
    } catch {
        document.getElementById('stat-new').textContent = 'n/a';
    }

    try {
        const trends = await fetchTrends('data/trends/daily.jsonl');
        renderPlatforms(trends);
        renderHistory(trends);
    } catch (err) {
        console.error('trend log unavailable:', err);
        const msg = [[{ text: `Trend log unavailable: ${err.message}`, className: 'text-muted text-center' }, '', '', '']];
        fillRows(document.getElementById('platform-rows'), msg);
        fillRows(document.getElementById('history-rows'), msg);
    }
}

main();
