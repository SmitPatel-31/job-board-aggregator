// ============================================================
// QUICK PRESETS + SAVED SEARCHES
// ============================================================

import { clearFilterInputs } from './filters.js';
import { preferredCountry } from './role_filter.js';
import { setValues } from './multi_select.js';
import { showToast } from './ui_utils.js';

const SAVED_KEY = 'job-saved-searches';
const el = id => document.getElementById(id);

/** Apply the preferred country only if that option exists in the loaded data. */
function applyPreferredCountry() {
    const wanted = preferredCountry();
    const select = el('filter-country');
    if (wanted && select && [...select.options].some(o => o.value === wanted)) {
        select.value = wanted;
    }
}

const PRESETS = {
    'new-for-me': app => {
        clearFilterInputs();
        el('filter-role-preset').checked = true;
        el('filter-freshness').value = '24';
        el('filter-hide-applied').checked = true;
        applyPreferredCountry();
        app.sortState = { key: 'first_seen', direction: 'desc' };
    },
    'my-roles': () => {
        clearFilterInputs();
        el('filter-role-preset').checked = true;
        applyPreferredCountry();
    },
    remote: () => {
        clearFilterInputs();
        el('filter-remote-only').checked = true;
    },
    entry: () => {
        clearFilterInputs();
        setValues('multi-skill-level', ['entry']);
    },
    'has-salary': app => {
        clearFilterInputs();
        el('filter-has-salary').checked = true;
        app.sortState = { key: 'salary', direction: 'desc' };
    },
    saved: () => {
        clearFilterInputs();
        el('filter-status').value = 'saved';
        el('filter-hide-applied').checked = false;
    },
    applied: () => {
        clearFilterInputs();
        el('filter-status').value = 'applied';
        el('filter-hide-applied').checked = false;
    },
};

/** Wire the quick-preset row. */
export function setupPresets(app) {
    for (const btn of document.querySelectorAll('.preset-btn')) {
        btn.addEventListener('click', () => {
            const fn = PRESETS[btn.dataset.preset];
            if (!fn) return;

            // Clicking an active preset clears it, so the row toggles rather
            // than only ever adding filters.
            if (btn.getAttribute('aria-pressed') === 'true') {
                app.clearFilters();
                markActive(null);
                return;
            }

            fn(app);
            markActive(btn.dataset.preset);
            app.applyFilters();

            const results = el('results');
            if (results) results.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }
}

export function markActive(name) {
    for (const btn of document.querySelectorAll('.preset-btn')) {
        btn.setAttribute('aria-pressed', String(btn.dataset.preset === name));
    }
}

// ── Saved searches ──────────────────────────────────────────

function loadSaved() {
    try {
        return JSON.parse(localStorage.getItem(SAVED_KEY)) || {};
    } catch {
        return {};
    }
}

function persist(all) {
    localStorage.setItem(SAVED_KEY, JSON.stringify(all));
}

function refreshSelect() {
    const select = el('saved-search-select');
    if (!select) return;
    const all = loadSaved();
    const names = Object.keys(all).sort();
    select.textContent = '';

    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = names.length ? 'Select a saved search…' : 'None saved yet';
    select.appendChild(blank);

    for (const name of names) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    }
}

/**
 * Saved searches are stored as the query string, so loading one is just
 * replaying the URL state the app already knows how to parse.
 */
export function setupSavedSearches(app) {
    refreshSelect();

    el('save-search')?.addEventListener('click', () => {
        const name = prompt('Name this search:');
        if (!name) return;
        const all = loadSaved();
        all[name.trim()] = window.location.search || '?';
        persist(all);
        refreshSelect();
        el('saved-search-select').value = name.trim();
        showToast(`Saved "${name.trim()}"`, 'success');
    });

    el('delete-search')?.addEventListener('click', () => {
        const select = el('saved-search-select');
        const name = select?.value;
        if (!name) {
            showToast('Pick a saved search to delete first.', 'warning');
            return;
        }
        const all = loadSaved();
        delete all[name];
        persist(all);
        refreshSelect();
        showToast(`Deleted "${name}"`, 'secondary');
    });

    el('saved-search-select')?.addEventListener('change', e => {
        const name = e.target.value;
        if (!name) return;
        const query = loadSaved()[name];
        if (!query) return;
        window.history.replaceState({}, '', window.location.pathname + query);
        app.loadFromURL();
        app.applyFilters();
        markActive(null);
        showToast(`Loaded "${name}"`, 'primary');
    });

    el('copy-link')?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(window.location.href);
            showToast('Link copied to clipboard', 'success');
        } catch {
            showToast('Could not access the clipboard.', 'danger');
        }
    });
}
