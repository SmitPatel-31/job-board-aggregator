// ============================================================
// FILTERING
// ============================================================

import { escapeRegex } from './ui_utils.js';
import { loadApplicationStatus } from './storage.js';
import { matchesRolePreset } from './role_filter.js';
import { matchesCountry } from './country_filter.js';

/**
 * Read current filter values from the DOM.
 * @returns {object} Filter state object
 */
export function readFilterInputs() {
    return {
        hideRecruiters: document.getElementById('filter-hide-recruiters').checked,
        remoteOnly: document.getElementById('filter-remote-only').checked,
        hideApplied: document.getElementById('filter-hide-applied').checked,
        title: document.getElementById('filter-title').value.toLowerCase().trim(),
        company: document.getElementById('filter-company').value.toLowerCase().trim(),
        location: document.getElementById('filter-location').value.toLowerCase().trim(),
        salaryMin: document.getElementById('filter-salary-min').value,
        salaryMax: document.getElementById('filter-salary-max').value,
        hasSalary: document.getElementById('filter-has-salary').checked,
        status: document.getElementById('filter-status').value,
        ats: document.getElementById('filter-ats').value,
        skill_level: document.getElementById('filter-skill-level').value,
        posted: document.getElementById('filter-posted').value,
        freshness: document.getElementById('filter-freshness').value,
        rolePreset: document.getElementById('filter-role-preset').checked,
        country: document.getElementById('filter-country').value,
        includeUnknownCountry: document.getElementById('filter-include-unknown-country').checked,
        exclude: document.getElementById('filter-exclude').value.toLowerCase().trim(),
        include: document.getElementById('filter-include').value.toLowerCase().trim(),
    };
}

function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
        }
    }
    return dp[a.length][b.length];
}

function fuzzyMatch(search, text, threshold = 0.75) {
    if (!search) return true;
    search = search.toLowerCase();
    text = text.toLowerCase();

    if (text.includes(search)) return true;

    const words = text.split(/\W+/).filter(Boolean);
    return words.some(word => {
        const maxLen = Math.max(word.length, search.length);
        if (maxLen === 0) return false;
        const similarity = 1 - levenshtein(search, word) / maxLen;
        return similarity >= threshold;
    });
}

/**
 * Filter the full jobs array based on the current filter inputs.
 * @param {Array} allJobs - The complete jobs array
 * @returns {{ filteredJobs: Array, filterState: object }}
 */
export function filterJobs(allJobs) {
    const f = readFilterInputs();
    const apps = loadApplicationStatus();

    const titleRegex = f.title ? new RegExp(`\\b${escapeRegex(f.title)}\\b`, 'i') : null;
    const companyRegex = f.company ? new RegExp(`\\b${escapeRegex(f.company)}\\b`, 'i') : null;
    const locationRegex = f.location ? new RegExp(`\\b${escapeRegex(f.location)}\\b`, 'i') : null;

    const filterState = {
        title: f.title,
        company: f.company,
        location: f.location,
        salaryMin: f.salaryMin,
        salaryMax: f.salaryMax,
        hasSalary: f.hasSalary,
        remoteOnly: f.remoteOnly,
        status: f.status,
        ats: f.ats,
        skill_level: f.skill_level,
        posted: f.posted,
        freshness: f.freshness,
        rolePreset: f.rolePreset,
        country: f.country,
        includeUnknownCountry: f.includeUnknownCountry,
        exclude: f.exclude,
        include: f.include
    };

    const minSalary = parseInt(f.salaryMin, 10) || 0;
    const maxSalary = parseInt(f.salaryMax, 10) || 0;
    const toSet = v => {
        const parts = (v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
        return parts.length ? new Set(parts) : null;
    };
    const atsSet = toSet(f.ats);
    const levelSet = toSet(f.skill_level);
    // Splitting keyword lists once rather than per job matters at ~1.5M rows.
    const excludeTerms = f.exclude ? f.exclude.split(',').map(t => t.trim()).filter(Boolean) : null;
    const includeTerms = f.include ? f.include.split(',').map(t => t.trim()).filter(Boolean) : null;

    const filteredJobs = allJobs.filter(job => {
        // Recruiter filter
        if (f.hideRecruiters && job.is_recruiter === true) return false;

        // Application status
        const url = job.url;
        const jobStatus = apps[url]?.status || '';

        if (f.hideApplied && (jobStatus === 'applied' || jobStatus === 'ignored')) return false;
        if (f.status && jobStatus !== f.status) return false;

        // Text fields
        const title = (job.title || '').toLowerCase();
        const company = ((job.company || job.company_slug) || '').toLowerCase();
        let location = '';
        if (job.location) {
            location = typeof job.location === 'object'
                ? (job.location.name || '').toLowerCase()
                : (job.location || '').toLowerCase();
        }

        // Salary: a range now, plus an "estimate exists" switch. Estimates are
        // joined from a static table, so most jobs have none -- requiring one is
        // a meaningfully different question from bounding it.
        if (f.hasSalary && typeof job.salary?.median !== 'number') return false;
        if (minSalary > 0 || maxSalary > 0) {
            const median = job.salary?.median;
            if (typeof median !== 'number') return false;
            if (minSalary > 0 && median < minSalary) return false;
            if (maxSalary > 0 && median > maxSalary) return false;
        }

        // Remote only
        if (f.remoteOnly) {
            const isRemote = location.includes('remote')
                || (job.workplaceType && job.workplaceType.toLowerCase() === 'remote');
            if (!isRemote) return false;
        }

        // ATS and level accept comma-separated sets so "Greenhouse OR Lever"
        // and "entry AND mid" are expressible. Pre-split above the loop.
        if (atsSet && !atsSet.has((job.ats || '').toLowerCase())) return false;
        if (levelSet && !levelSet.has((job.skill_level || '').toLowerCase())) return false;

        // Region / country
        if (!matchesCountry(job, f.country, f.includeUnknownCountry)) return false;

        // Role preset (software / cloud / devops at the configured levels)
        if (f.rolePreset && !matchesRolePreset(job)) return false;

        // Freshness: first_seen is the exact "new to the dataset" signal produced
        // by the merge key-diff, so it's what "new jobs" means here. A job with no
        // first_seen predates the field and is definitionally not new.
        if (f.freshness) {
            const hours = parseFloat(f.freshness);
            if (!job.first_seen) return false;
            const t = Date.parse(job.first_seen);
            if (isNaN(t)) return false;
            if ((Date.now() - t) / 3600000 > hours) return false;
        }

        // Date posted (within N days)
        if (f.posted) {
            const days = parseInt(f.posted, 10);
            const raw = job.updated_at || job.first_seen;
            const t = raw ? Date.parse(raw) : NaN;
            if (isNaN(t)) return false;   // no date = excluded when a date filter is active
            const ageDays = (Date.now() - t) / 86400000;
            if (ageDays > days) return false;
        }

        // Title keyword lists
        if (excludeTerms && excludeTerms.some(term => title.includes(term))) return false;
        if (includeTerms && !includeTerms.some(term => title.includes(term))) return false;

        return (
            (!titleRegex || titleRegex.test(title)) &&
            (!companyRegex || companyRegex.test(company)) &&
            (!f.location || fuzzyMatch(f.location, location))
        );
    });

    return { filteredJobs, filterState };
}

/** Reset all filter DOM inputs to defaults */
export function clearFilterInputs() {
    document.getElementById('filter-title').value = '';
    document.getElementById('filter-company').value = '';
    document.getElementById('filter-location').value = '';
    document.getElementById('filter-salary-min').value = '';
    document.getElementById('filter-salary-max').value = '';
    document.getElementById('filter-has-salary').checked = false;
    document.getElementById('filter-exclude').value = '';
    document.getElementById('filter-include').value = '';
    document.getElementById('filter-status').value = '';
    document.getElementById('filter-ats').value = '';
    document.getElementById('filter-skill-level').value = '';
    document.getElementById('filter-posted').value = '';
    document.getElementById('filter-freshness').value = '';
    document.getElementById('filter-role-preset').checked = false;
    document.getElementById('filter-country').value = '';
    document.getElementById('filter-include-unknown-country').checked = false;
    document.getElementById('filter-hide-recruiters').checked = true;
    document.getElementById('filter-remote-only').checked = false;
    document.getElementById('filter-hide-applied').checked = false;
}