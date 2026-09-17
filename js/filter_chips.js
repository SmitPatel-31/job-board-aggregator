// ============================================================
// ACTIVE FILTER CHIPS
// ============================================================
// The filter panel collapses, so previously there was no way to tell what was
// applied without reopening it -- easy to stare at 12 results and not realise a
// stale filter was doing it. Each active filter gets a removable chip.

import { countryName } from './country_filter.js';
import { setValues } from './multi_select.js';

const LEVEL_LABEL = { intern: 'Intern', entry: 'Entry', mid: 'Mid', senior: 'Senior' };

/** Turn the live filter state into [{key, label, clear}] descriptors. */
function describe(app) {
    const f = app.filterState || {};
    const out = [];
    const el = id => document.getElementById(id);

    const add = (key, label, clear) => out.push({ key, label, clear });

    if (f.title) add('Title', f.title, () => (el('filter-title').value = ''));
    if (f.include) add('Includes', f.include, () => (el('filter-include').value = ''));
    if (f.exclude) add('Excludes', f.exclude, () => (el('filter-exclude').value = ''));
    if (f.company) add('Company', f.company, () => (el('filter-company').value = ''));
    if (f.location) add('Location', f.location, () => (el('filter-location').value = ''));

    if (f.rolePreset) {
        add('Preset', document.getElementById('role-preset-label')?.textContent || 'my roles',
            () => (el('filter-role-preset').checked = false));
    }

    if (f.country) {
        const label = f.country === '__remote__' ? 'Remote anywhere'
            : f.country === '__unknown__' ? 'Unknown location'
                : countryName(f.country);
        add('Region', label, () => (el('filter-country').value = ''));
    }
    if (f.includeUnknownCountry) {
        add('Region', '+ unresolved', () => (el('filter-include-unknown-country').checked = false));
    }
    if (f.remoteOnly) add('Remote', 'only', () => (el('filter-remote-only').checked = false));

    if (f.skill_level) {
        const labels = f.skill_level.split(',').filter(Boolean)
            .map(v => LEVEL_LABEL[v] || v).join(', ');
        add('Level', labels, () => setValues('multi-skill-level', []));
    }
    if (f.ats) {
        add('ATS', f.ats.split(',').filter(Boolean).join(', '),
            () => setValues('multi-ats', []));
    }

    if (f.salaryMin) add('Salary', `≥ $${Number(f.salaryMin).toLocaleString()}`,
        () => (el('filter-salary-min').value = ''));
    if (f.salaryMax) add('Salary', `≤ $${Number(f.salaryMax).toLocaleString()}`,
        () => (el('filter-salary-max').value = ''));
    if (f.hasSalary) add('Salary', 'estimate present',
        () => (el('filter-has-salary').checked = false));

    if (f.freshness) {
        const h = Number(f.freshness);
        const label = h < 24 ? `first seen < ${h}h` : `first seen < ${Math.round(h / 24)}d`;
        add('Fresh', label, () => (el('filter-freshness').value = ''));
    }
    if (f.posted) add('Posted', `< ${f.posted}d`, () => (el('filter-posted').value = ''));

    if (f.status) add('Status', f.status, () => (el('filter-status').value = ''));
    if (f.hideApplied) add('Hide', 'applied/ignored', () => (el('filter-hide-applied').checked = false));
    // Recruiters are hidden by default, so only surface the non-default case.
    if (f.hideRecruiters === false) {
        add('Show', 'recruiter posts', () => (el('filter-hide-recruiters').checked = true));
    }

    return out;
}

/**
 * Re-render the chip bar from current state.
 * @param {object} app - JobBoardApp instance
 */
export function renderChips(app) {
    const bar = document.getElementById('chip-bar');
    if (!bar) return;

    const chips = describe(app);
    bar.textContent = '';
    if (!chips.length) return;

    for (const { key, label, clear } of chips) {
        const chip = document.createElement('span');
        chip.className = 'chip';

        const k = document.createElement('span');
        k.className = 'chip-key';
        k.textContent = `${key}:`;

        const v = document.createElement('span');
        v.textContent = label;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-remove';
        btn.setAttribute('aria-label', `Remove ${key} filter`);
        btn.textContent = '×';
        btn.addEventListener('click', () => {
            clear();
            app.applyFilters();
        });

        chip.append(k, v, btn);
        bar.appendChild(chip);
    }

    const clearAll = document.createElement('button');
    clearAll.type = 'button';
    clearAll.className = 'chip-clear';
    clearAll.textContent = `Clear ${chips.length} filter${chips.length > 1 ? 's' : ''}`;
    clearAll.addEventListener('click', () => app.clearFilters());
    bar.appendChild(clearAll);
}
