// ============================================================
// RENDERER
// ============================================================

import { updateSortIndicators } from './ui_utils.js';
import { updatePagination } from './pagination.js';

/**
 * Empty state. A bare "No jobs found" row gave no clue whether the dataset was
 * still streaming or a filter was too narrow, so it now says which and offers
 * the fix.
 */
function renderEmptyState(app, tbody) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = app.columns.length;

    const block = document.createElement('div');
    block.className = 'state-block';

    const icon = document.createElement('div');
    icon.className = 'state-icon';
    icon.textContent = app.hasActiveFilters() ? '\u2298' : '\u2014';

    const title = document.createElement('div');
    title.className = 'state-title';

    const body = document.createElement('div');
    body.className = 'state-body';

    block.append(icon, title, body);

    if (app.hasActiveFilters()) {
        title.textContent = 'No jobs match these filters';
        body.textContent = app.isFullyLoaded
            ? 'Try widening the region, clearing a keyword, or loosening the freshness window.'
            : 'Still loading the rest of the dataset \u2014 more matches may appear.';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-outline-danger btn-sm';
        btn.textContent = 'Clear all filters';
        btn.addEventListener('click', () => app.clearFilters());
        block.appendChild(btn);
    } else {
        title.textContent = app.isFullyLoaded ? 'No jobs loaded' : 'Loading jobs\u2026';
        body.textContent = app.isFullyLoaded
            ? 'The dataset came back empty. Check the pipeline status page.'
            : 'Fetching chunks from the data source.';
    }

    cell.appendChild(block);
}

/**
 * Render the job table for the current page.
 * @param {object} app - The JobBoardApp instance (state holder)
 */
export function render(app) {
    const tbody = document.getElementById('jobs-body');
    if (!tbody) return;

    let pageJobs = [];
    const totalJobsCount = app.getTotalJobsCount();
    const totalPages = Math.max(1, Math.ceil(totalJobsCount / app.perPage));

    // Bounds check
    if (app.currentPage > totalPages) app.currentPage = totalPages;
    if (app.currentPage < 1) app.currentPage = 1;

    // Pick the source: sorted snapshot if a sort is active, else the filtered set
    const sourceJobs = (app.sortState && app.sortState.key && app.sortedJobs)
        ? app.sortedJobs
        : app.filteredJobs;

    const start = (app.currentPage - 1) * app.perPage;
    pageJobs = sourceJobs.slice(start, start + app.perPage);

    tbody.textContent = '';
    if (pageJobs.length === 0) {
        renderEmptyState(app, tbody);
        updatePagination(app.currentPage, totalPages, totalJobsCount);
        return;
    }

    pageJobs.forEach(job => {
        const row = tbody.insertRow();
        app.columns.forEach(col => {
            const cell = row.insertCell();
            cell.setAttribute('data-label', col.label);
            if (col.render) {
                cell.innerHTML = col.render(job);
            } else {
                let value = job[col.key];
                if (col.key === 'location') value = value && typeof value === 'object' ? (value.name || 'Not specified') : (value || 'Not specified');
                if (col.key === 'company') value = value || job.company_slug || 'Unknown';
                cell.textContent = value || 'Not specified';
            }
        });
    });

    updatePagination(app.currentPage, totalPages, totalJobsCount);
}