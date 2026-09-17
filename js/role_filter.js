// ============================================================
// ROLE PRESET
// ============================================================
// Loads data/role_filter.json -- the same file scripts/role_filter.py reads --
// so the "My roles" filter here and the hourly shortlist scrape always agree on
// what counts as a target role.

let preset = null;

/**
 * Fetch and compile the role preset. Safe to call once at startup; failures are
 * non-fatal (the preset filter just stays unavailable).
 * @returns {Promise<{name: string, levels: Set<string>}|null>}
 */
export async function loadRolePreset(path = 'data/role_filter.json') {
    try {
        const res = await fetch(path);
        if (!res.ok) throw new Error(`Failed to load ${path}`);
        const cfg = await res.json();

        preset = {
            name: cfg.name,
            levels: new Set(cfg.levels || []),
            preferredCountry: cfg.preferred_country || '',
            include: new RegExp(cfg.include.join('|'), 'i'),
            exclude: cfg.exclude?.length ? new RegExp(cfg.exclude.join('|'), 'i') : null,
        };
        return { name: preset.name, levels: preset.levels, preferredCountry: preset.preferredCountry };
    } catch (err) {
        console.error('Role preset unavailable:', err);
        preset = null;
        return null;
    }
}

/** True once the preset has been loaded and compiled. */
export function rolePresetReady() {
    return preset !== null;
}

/**
 * ISO country code the "New for me" button should preselect, or '' for any.
 * Config-driven so the region preference lives next to the role definition
 * rather than hardcoded in the button handler.
 */
export function preferredCountry() {
    return preset?.preferredCountry || '';
}

/** Human-readable preset name, for labelling the UI control. */
export function rolePresetName() {
    return preset?.name || 'My roles';
}

/**
 * True if a job is one of the target roles at one of the target levels.
 * Mirrors matches() in scripts/role_filter.py.
 * @param {object} job
 */
export function matchesRolePreset(job) {
    if (!preset) return true;           // preset unavailable: don't filter anything out
    const title = job.title || '';
    if (!title) return false;
    if (preset.levels.size && !preset.levels.has(job.skill_level || '')) return false;
    if (!preset.include.test(title)) return false;
    if (preset.exclude && preset.exclude.test(title)) return false;
    return true;
}
