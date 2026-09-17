// ============================================================
// URL STATE MANAGEMENT
// ============================================================

import { setValues } from './multi_select.js';

/**
 * Sync current filter/sort/page state to the URL query string.
 * @param {object} filterState
 * @param {number} currentPage
 * @param {{ key: string|null, direction: string }} sortState
 */
export function updateURL(filterState, currentPage, sortState) {
    const params = new URLSearchParams();

    if (filterState.title) params.set('title', filterState.title);
    if (filterState.company) params.set('company', filterState.company);
    if (filterState.location) params.set('location', filterState.location);
    if (filterState.salaryMin) params.set('salary_min', filterState.salaryMin);
    if (filterState.salaryMax) params.set('salary_max', filterState.salaryMax);
    if (filterState.hasSalary) params.set('has_salary', '1');
    if (filterState.remoteOnly) params.set('remote', '1');
    if (filterState.status) params.set('status', filterState.status);
    if (filterState.ats) params.set('ats', filterState.ats);
    if (filterState.skill_level) params.set('skill_level', filterState.skill_level);
    if (filterState.exclude) params.set('exclude', filterState.exclude)
    if (filterState.include) params.set('include', filterState.include)
    if (filterState.freshness) params.set('fresh', filterState.freshness);
    if (filterState.posted) params.set('posted', filterState.posted);
    if (filterState.rolePreset) params.set('roles', '1');
    if (filterState.country) params.set('country', filterState.country);
    if (filterState.includeUnknownCountry) params.set('unknown_loc', '1');
    if (currentPage > 1) params.set('page', currentPage.toString());

    if (sortState.key) {
        params.set('sort_key', sortState.key);
        params.set('sort_dir', sortState.direction);
    }

    const newURL = params.toString()
        ? `${window.location.pathname}?${params.toString()}`
        : window.location.pathname;

    window.history.replaceState({}, '', newURL);
}

/**
 * Read filter/sort/page state from the URL and populate DOM inputs.
 * @returns {{ hasFilters: boolean, page: number }}
 */
export function loadFromURL() {
    const params = new URLSearchParams(window.location.search);

    const title = params.get('title') || '';
    const company = params.get('company') || '';
    const location = params.get('location') || '';
    const salaryMin = params.get('salary_min') || params.get('salary') || '';
    const salaryMax = params.get('salary_max') || '';
    const hasSalary = params.get('has_salary') === '1';
    const remote = params.get('remote') === '1';
    const page = parseInt(params.get('page')) || 1;
    const status = params.get('status') || '';
    const ats = params.get('ats') || '';
    const skillLevel = params.get('skill_level') || '';
    const exclude = params.get('exclude') || '';
    const include = params.get('include') || '';
    const freshness = params.get('fresh') || '';
    const posted = params.get('posted') || '';
    const rolePreset = params.get('roles') === '1';
    const country = params.get('country') || '';
    const includeUnknownCountry = params.get('unknown_loc') === '1';

    document.getElementById('filter-title').value = title;
    document.getElementById('filter-company').value = company;
    document.getElementById('filter-location').value = location;
    document.getElementById('filter-salary-min').value = salaryMin;
    document.getElementById('filter-salary-max').value = salaryMax;
    document.getElementById('filter-has-salary').checked = hasSalary;
    document.getElementById('filter-remote-only').checked = remote;
    document.getElementById('filter-status').value = status;
    // ATS and level are driven by the multi-selects, which own the hidden
    // <select> values; setting them directly would be overwritten.
    setValues('multi-ats', ats.split(',').filter(Boolean));
    setValues('multi-skill-level', skillLevel.split(',').filter(Boolean));
    document.getElementById('filter-exclude').value = exclude;
    document.getElementById('filter-include').value = include;
    document.getElementById('filter-freshness').value = freshness;
    document.getElementById('filter-posted').value = posted;
    document.getElementById('filter-role-preset').checked = rolePreset;
    document.getElementById('filter-include-unknown-country').checked = includeUnknownCountry;
    // The country <select> is populated from loaded data, so the option may not
    // exist yet; add it so a bookmarked link still applies. Built with DOM APIs
    // rather than innerHTML because `country` comes straight from the query
    // string and would otherwise be an injection point.
    const countrySelect = document.getElementById('filter-country');
    if (country && ![...countrySelect.options].some(o => o.value === country)) {
        const opt = document.createElement('option');
        opt.value = country;
        opt.textContent = country;
        countrySelect.appendChild(opt);
    }
    countrySelect.value = country;

    const hasFilters = !!(title || company || location || salaryMin || salaryMax || hasSalary || remote || status || ats || skillLevel || exclude || include || freshness || posted || rolePreset || country || includeUnknownCountry);

    const sortKey = params.get('sort_key') || null;
    const sortDir = params.get('sort_dir') || 'asc';

    return { hasFilters, page, sortKey, sortDir };
}