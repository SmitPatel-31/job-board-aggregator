// ============================================================
// THEME
// ============================================================
// Three states, not two: an explicit light or dark choice, or no choice at all,
// in which case the OS preference wins via the prefers-color-scheme block in
// styles.css. Only an explicit choice is persisted.

const KEY = 'job-board-theme';

function systemPrefersDark() {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

function currentlyDark() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return systemPrefersDark();
}

function apply(theme) {
    if (theme === 'light' || theme === 'dark') {
        document.documentElement.dataset.theme = theme;
    } else {
        delete document.documentElement.dataset.theme;
    }
    const btn = document.getElementById('theme-toggle');
    if (btn) {
        const dark = currentlyDark();
        btn.setAttribute('aria-pressed', String(dark));
        btn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
    }
}

/** Read the stored choice before first paint to avoid a flash of light mode. */
export function initTheme() {
    let stored = null;
    try {
        stored = localStorage.getItem(KEY);
    } catch {
        // private mode or storage disabled; fall back to the OS preference
    }
    apply(stored);

    document.getElementById('theme-toggle')?.addEventListener('click', () => {
        const next = currentlyDark() ? 'light' : 'dark';
        try {
            localStorage.setItem(KEY, next);
        } catch {
            // non-persistent is still better than non-functional
        }
        apply(next);
    });

    // Follow the OS while the user has made no explicit choice.
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
        if (!document.documentElement.dataset.theme) apply(null);
    });
}
