// ============================================================
// COUNTRY / REGION FILTER
// ============================================================
// Jobs carry an ISO country code resolved from their location string (by the
// scraper for new jobs, by scripts/backfill_country.py for older ones).
//
// Roughly 40% of jobs have no resolvable country, because a lot of ATS
// locations are placeholders -- "Not specified" (iCIMS never sends one),
// "3 Locations" (Workday multi-site), "Remote", "Hybrid". That's why the
// dropdown shows counts and offers an explicit "Unknown location" option:
// silently hiding 40% of the dataset behind a filter would be worse than
// showing the user exactly what's being excluded.

const COUNTRY_NAMES = {
    US: 'United States', CA: 'Canada', GB: 'United Kingdom', IN: 'India',
    AU: 'Australia', DE: 'Germany', FR: 'France', BR: 'Brazil',
    MX: 'Mexico', SG: 'Singapore', NL: 'Netherlands', AR: 'Argentina',
    ES: 'Spain', IT: 'Italy', JP: 'Japan', CN: 'China', IE: 'Ireland',
    PL: 'Poland', SE: 'Sweden', CH: 'Switzerland', IL: 'Israel',
    PH: 'Philippines', ZA: 'South Africa', AE: 'UAE', NZ: 'New Zealand',
    PT: 'Portugal', BE: 'Belgium', DK: 'Denmark', NO: 'Norway',
    FI: 'Finland', AT: 'Austria', CZ: 'Czechia', RO: 'Romania',
    HU: 'Hungary', GR: 'Greece', TR: 'Turkey', KR: 'South Korea',
    HK: 'Hong Kong', MY: 'Malaysia', ID: 'Indonesia', TH: 'Thailand',
    VN: 'Vietnam', CO: 'Colombia', CL: 'Chile', PE: 'Peru',
    CR: 'Costa Rica', UA: 'Ukraine', RU: 'Russia', EG: 'Egypt',
    NG: 'Nigeria', KE: 'Kenya', PK: 'Pakistan', BD: 'Bangladesh',
};

export const ANY = '';
export const REMOTE = '__remote__';
export const UNKNOWN = '__unknown__';

/** Display label for an ISO code. */
export function countryName(code) {
    return COUNTRY_NAMES[code] || code;
}

/**
 * Rebuild the country dropdown from the jobs currently loaded, ordered by job
 * count. Preserves the user's current selection across refreshes, since this
 * is called again as chunks stream in.
 * @param {Array} jobs
 */
export function populateCountryFilter(jobs) {
    const select = document.getElementById('filter-country');
    if (!select) return;

    const previous = select.value;
    const counts = new Map();
    let unknown = 0;
    let remote = 0;

    for (const job of jobs) {
        if (job.remote) remote++;
        const code = job.country;
        if (!code) { unknown++; continue; }
        counts.set(code, (counts.get(code) || 0) + 1);
    }

    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const fmt = n => n.toLocaleString();

    const options = [
        `<option value="${ANY}">Any location</option>`,
        `<option value="${REMOTE}">Remote — anywhere (${fmt(remote)})</option>`,
        ...ranked.map(([code, n]) =>
            `<option value="${code}">${countryName(code)} (${fmt(n)})</option>`),
    ];
    if (unknown) {
        options.push(`<option value="${UNKNOWN}">Unknown location (${fmt(unknown)})</option>`);
    }

    select.innerHTML = options.join('');
    // Restore the selection if it still exists in the rebuilt list.
    if (previous && [...select.options].some(o => o.value === previous)) {
        select.value = previous;
    }
}

/**
 * Does this job pass the selected region filter?
 * @param {object} job
 * @param {string} selected - '', '__remote__', '__unknown__', or an ISO code
 * @param {boolean} includeUnknown - also keep country-less jobs when a specific
 *   country is selected
 */
export function matchesCountry(job, selected, includeUnknown) {
    if (!selected) return true;
    if (selected === REMOTE) return job.remote === true;
    if (selected === UNKNOWN) return !job.country;
    if (job.country === selected) return true;
    return includeUnknown === true && !job.country;
}
