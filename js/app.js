// ============================================================
// JOB HUNT PIPELINE — APP 
// ============================================================

import { showToast, showLoadingToast, setUIBusy, updateFABVisibility, updateSortIndicators } from './ui_utils.js';
import { saveApplicationStatus } from './storage.js';
import { createColumns } from './columns.js';
import { loadJobsProgressive } from './jobs_loader.js';
import { filterJobs, clearFilterInputs } from './filters.js';
import { render } from './renderer.js';
import { updateURL, loadFromURL } from './url_state.js';
import { setupEventListeners } from './events.js';
import { sortJobs } from './sort_logic.js';
import { toggleView, updateHeatmapIfVisible } from './map_view.js';
import { loadRolePreset } from './role_filter.js';
import { createMultiSelect, setOptionCounts } from './multi_select.js';
import { renderChips } from './filter_chips.js';
import { setupPresets, setupSavedSearches, markActive } from './presets.js';
import { initTheme } from './theme.js';

class JobBoardApp {
    constructor() {
        this.allJobs = [];
        this.filteredJobs = [];
        this.currentPage = 1;
        this.virtualFilteredCount = 0;
        this.perPage = window.innerWidth <= 900 ? 25 : 50;
        this.sortState = { key: null, direction: 'asc' };

        this.isSorting = false;
        this.isFullyLoaded = false;

        this.filterState = this.blankFilterState();

        this.debounceTimer = null;
        this.columns = createColumns();
        this.sortWorker = null;
    }

    blankFilterState() {
        return {
            title: '', company: '', location: '', status: '',
            ats: '', skill_level: '', remoteOnly: false,
            freshness: '', posted: '', rolePreset: false,
            country: '', includeUnknownCountry: false,
            salaryMin: '', salaryMax: '', hasSalary: false,
            exclude: '', include: '', hideRecruiters: true, hideApplied: false
        };
    }

    // ── Initialization ───────────────────────────────────────────
    async init() {
        initTheme();
        this.buildMultiSelects();

        // Preset loads alongside the first chunk; it must be compiled before
        // loadFromURL() so a bookmarked ?roles=1 link filters correctly.
        const presetReady = loadRolePreset().then(preset => {
            if (preset) document.getElementById('role-preset-label').textContent = preset.name;
        });

        await this.loadJobs();
        await presetReady;

        setupEventListeners(this);
        setupPresets(this);
        setupSavedSearches(this);
        this.loadFromURL();
        this.setupViewToggle();
        this.render();
        this.refreshCounts();
    }

    /** ATS and level are multi-select; the native <select>s stay as the value carrier. */
    buildMultiSelects() {
        const rerun = () => this.applyFilters();
        createMultiSelect('multi-ats', [
            { value: 'greenhouse', label: 'Greenhouse' },
            { value: 'lever', label: 'Lever' },
            { value: 'ashby', label: 'Ashby' },
            { value: 'workday', label: 'Workday' },
            { value: 'icims', label: 'iCIMS' },
            { value: 'bamboohr', label: 'BambooHR' },
            { value: 'paylocity', label: 'Paylocity' },
        ], 'All platforms', rerun);

        createMultiSelect('multi-skill-level', [
            { value: 'intern', label: 'Intern' },
            { value: 'entry', label: 'Entry' },
            { value: 'mid', label: 'Mid' },
            { value: 'senior', label: 'Senior' },
        ], 'Any level', rerun);
    }

    /** Stat strip, filter count badge and per-option counts. */
    refreshCounts() {
        const total = this.getTotalJobsCount();
        const el = id => document.getElementById(id);

        const matching = el('stat-matching');
        if (matching) matching.textContent = total.toLocaleString();

        const badge = el('filter-count');
        if (badge) {
            badge.textContent = `${total.toLocaleString()} match`;
            badge.classList.toggle('is-updating', this.hasActiveFilters());
        }

        const cutoff = Date.now() - 24 * 3600 * 1000;
        const fresh = el('stat-fresh');
        if (fresh) {
            let n = 0;
            for (const j of this.allJobs) {
                if (j.first_seen && Date.parse(j.first_seen) >= cutoff) n++;
            }
            fresh.textContent = n.toLocaleString();
        }

        const atsCounts = {};
        const levelCounts = {};
        for (const j of this.allJobs) {
            const a = (j.ats || '').toLowerCase();
            if (a) atsCounts[a] = (atsCounts[a] || 0) + 1;
            const l = (j.skill_level || '').toLowerCase();
            if (l) levelCounts[l] = (levelCounts[l] || 0) + 1;
        }
        setOptionCounts('multi-ats', atsCounts);
        setOptionCounts('multi-skill-level', levelCounts);
    }

    // ── Data Loading ───────────────────────────────────────────
    async loadJobs() {
        const loadingEl = document.getElementById('loading');
        const resultsEl = document.getElementById('results');

        try {
            await loadJobsProgressive(this);
            this.sortState = { key: null, direction: 'asc' };

            loadingEl.style.display = 'none';
            resultsEl.style.display = 'block';

            console.log(`Loaded ${this.allJobs.length} jobs (more loading...)`);

        } catch (error) {
            console.error('Error loading jobs:', error);
            showToast('Error loading job data.', 'danger');
            this.renderLoadError(loadingEl, error);
        }
    }

    /** Replace the skeleton with an actionable error rather than bare text. */
    renderLoadError(container, error) {
        container.textContent = '';
        const block = document.createElement('div');
        block.className = 'state-block is-error';

        const icon = document.createElement('div');
        icon.className = 'state-icon';
        icon.textContent = '!';

        const title = document.createElement('div');
        title.className = 'state-title';
        title.textContent = 'Could not load job data';

        const body = document.createElement('div');
        body.className = 'state-body';
        body.textContent = error?.message
            ? `${error.message}. The data source may be mid-publish \u2014 retrying usually works.`
            : 'The data source did not respond.';

        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'btn btn-primary btn-sm';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => window.location.reload());

        const status = document.createElement('a');
        status.href = 'status.html';
        status.className = 'btn btn-outline-secondary btn-sm ms-2';
        status.textContent = 'Pipeline status';

        block.append(icon, title, body, retry, status);
        container.appendChild(block);
    }

    // ── Rendering ────────────────────────────────────────────
    render() {
        render(this);
        this.refreshCounts();
    }

    debounceRender() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.render(), 300);
    }

    // ── Filtering ────────────────────────────────────────────
    applyFilters() {
        const { filteredJobs, filterState } = filterJobs(this.allJobs);
        this.filteredJobs = filteredJobs;
        this.filterState = filterState;
        this.currentPage = 1;
        this.sortedJobs = null;
        updateURL(this.filterState, this.currentPage, this.sortState);
        updateHeatmapIfVisible();
        renderChips(this);

        // Only re-sort if a sort is active AND it's a sortable column
        const sortableKeys = ['company', 'salary', 'posted', 'first_seen'];
        if (this.sortState.key && sortableKeys.includes(this.sortState.key)) {
            this.sortAndRender();
        } else {
            this.sortState.key = null;   // clear a stale non-sortable key
            this.render();
        }
    }

    clearFilters() {
        clearFilterInputs();
        this.filterState = this.blankFilterState();
        this.filteredJobs = [...this.allJobs];
        this.currentPage = 1;
        this.sortedJobs = null;
        updateURL(this.filterState, this.currentPage, this.sortState);
        updateHeatmapIfVisible();
        renderChips(this);
        markActive(null);

        const sortableKeys = ['company', 'salary', 'posted', 'first_seen'];
        if (this.sortState.key && sortableKeys.includes(this.sortState.key)) {
            this.sortAndRender();
        } else {
            this.render();
        }
    }

    refilter() {
        const { filteredJobs } = filterJobs(this.allJobs);
        this.filteredJobs = filteredJobs;
        updateHeatmapIfVisible();
        this.render();   // always render so the page count reflects newly loaded jobs
    }

    hasActiveFilters() {
        const f = this.filterState;
        return f.title || f.company || f.location || f.status ||
            f.ats || f.skill_level || f.remoteOnly || f.exclude || f.include ||
            f.freshness || f.rolePreset || f.country || f.includeUnknownCountry;
    }

    // ── Sorting ──────────────────────────────────────────────
    handleSort(key) {
        if (!this.isFullyLoaded) {
            showToast('Please wait until dataset processing finishes...', 'warning');
            return;
        }
        if (this.isSorting) return;

        if (this.sortState.key === key) {
            this.sortState.direction = this.sortState.direction === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortState.key = key;
            this.sortState.direction = 'asc';
        }

        this.currentPage = 1;
        updateURL(this.filterState, this.currentPage, this.sortState);

        // Run the heavy sort processing on demand
        this.sortAndRender();
    }

    sortAndRender() {
        if (!this.sortWorker) {
            this.sortOnMainThread();
            return;
        }
        this.isSorting = true;
        this.sortLoader = showLoadingToast('Sorting records...');
        this.sortWorker.postMessage({
            type: 'SORT',
            jobsToSort: this.filteredJobs,
            sortState: this.sortState,
        });
    }

    sortOnMainThread() {
        this.sortedJobs = sortJobs([...this.filteredJobs], this.sortState);
        this.virtualFilteredCount = this.sortedJobs.length;
        this.currentPage = 1;
        this.render();
    }

    // ── Pagination ───────────────────────────────────────────
    previousPage() {
        if (this.currentPage > 1) {
            this.currentPage--;
            this.triggerPageUpdate();
        }
    }

    getTotalJobsCount() {
        // While still streaming, always report the live filtered total so the count grows
        if (!this.isFullyLoaded) return this.filteredJobs.length;
        if (this.sortState?.key && this.sortedJobs) return this.sortedJobs.length;
        return this.filteredJobs.length;
    }

    nextPage() {
        const totalJobsCount = this.getTotalJobsCount();
        const totalPages = Math.max(1, Math.ceil(totalJobsCount / this.perPage));

        if (this.currentPage < totalPages) {
            this.currentPage++;
            this.triggerPageUpdate();
        }
    }

    triggerPageUpdate() {
        window.scrollTo(0, 0);
        this.render();
    }

    // ── URL State ────────────────────────────────────────────
    loadFromURL() {
        const { hasFilters, page, sortKey, sortDir } = loadFromURL();
        this.currentPage = page;
        if (sortKey) this.sortState = { key: sortKey, direction: sortDir };
        if (hasFilters) this.applyFilters();
    }

    // ── Batch Processing ─────────────────────────────────────
    handleBatch() {
        const selected = document.querySelectorAll('.save-checkbox:checked, .apply-checkbox:checked, .ignored-checkbox:checked');
        if (selected.length === 0) {
            showToast('Please select at least one job first.', 'warning');
            return;
        }

        setUIBusy(true);

        try {
            document.querySelectorAll('.save-checkbox:checked').forEach(box => {
                if (box.dataset.jobUrl) saveApplicationStatus(box.dataset.jobUrl, 'saved');
            });
            document.querySelectorAll('.apply-checkbox:checked').forEach(box => {
                if (box.dataset.jobUrl) saveApplicationStatus(box.dataset.jobUrl, 'applied');
            });
            document.querySelectorAll('.ignored-checkbox:checked').forEach(box => {
                if (box.dataset.jobUrl) saveApplicationStatus(box.dataset.jobUrl, 'ignored');
            });

            showToast(`Updated ${selected.length} job(s) successfully!`, 'success');
            updateFABVisibility();
            this.render();

        } catch (err) {
            showToast('Error updating job status.', 'danger');
            console.error(err);
        } finally {
            setUIBusy(false);
        }
    }

    // ── View Toggle ──────────────────────────────────────────
    setupViewToggle() {
        document.querySelectorAll('.view-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.view-toggle').forEach(b => {
                    b.classList.remove('active', 'btn-primary');
                    b.classList.add('btn-outline-primary');
                });
                btn.classList.add('active', 'btn-primary');
                btn.classList.remove('btn-outline-primary');
                toggleView(btn.dataset.view, this);
            });
        });
    }
}

// ============================================================
// INITIALIZE APP
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    const app = new JobBoardApp();
    window.app = app;   // <-- add this, lets you poke it from console
    app.init();
});