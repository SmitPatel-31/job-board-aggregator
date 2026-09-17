// ============================================================
// MULTI-SELECT
// ============================================================
// ATS and experience level were single-<select>, so "Greenhouse OR Lever" or
// "entry AND mid" were impossible to express. Rather than swap in a dependency,
// this decorates a hidden native <select> with a checkbox panel and writes the
// chosen values back as a comma-separated string. filters.js already splits on
// commas, so the filter predicates stay unchanged and a bookmarked URL with a
// single value keeps working.

const registry = new Map();

/**
 * @param {string} rootId   wrapper element id, e.g. 'multi-ats'
 * @param {Array<{value: string, label: string}>} options
 * @param {string} emptyLabel  trigger text when nothing is selected
 * @param {() => void} onChange
 */
export function createMultiSelect(rootId, options, emptyLabel, onChange) {
    const root = document.getElementById(rootId);
    if (!root) return null;

    const hidden = document.getElementById(root.dataset.target);
    const trigger = root.querySelector('.multi-trigger');
    const panel = root.querySelector('.multi-panel');
    if (!hidden || !trigger || !panel) return null;

    const state = { root, hidden, trigger, panel, options, emptyLabel, onChange, selected: new Set() };
    registry.set(rootId, state);

    panel.textContent = '';
    for (const opt of options) {
        const label = document.createElement('label');
        label.className = 'multi-option';

        const box = document.createElement('input');
        box.type = 'checkbox';
        box.className = 'form-check-input';
        box.value = opt.value;
        box.addEventListener('change', () => {
            if (box.checked) state.selected.add(opt.value);
            else state.selected.delete(opt.value);
            syncHidden(state);
            onChange();
        });

        const text = document.createElement('span');
        text.textContent = opt.label;

        const count = document.createElement('span');
        count.className = 'opt-count';
        count.dataset.countFor = opt.value;

        label.append(box, text, count);
        panel.appendChild(label);
    }

    const actions = document.createElement('div');
    actions.className = 'multi-actions';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.textContent = 'Select all';
    allBtn.addEventListener('click', () => setValues(rootId, options.map(o => o.value), true));
    const noneBtn = document.createElement('button');
    noneBtn.type = 'button';
    noneBtn.textContent = 'Clear';
    noneBtn.addEventListener('click', () => setValues(rootId, [], true));
    actions.append(allBtn, noneBtn);
    panel.appendChild(actions);

    trigger.addEventListener('click', e => {
        e.stopPropagation();
        const open = panel.classList.contains('open');
        closeAll();
        if (!open) {
            panel.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
        }
    });

    // Keyboard dismissal matters here: the panel traps nothing, so Escape has to
    // return focus to the trigger or keyboard users get stranded.
    root.addEventListener('keydown', e => {
        if (e.key === 'Escape' && panel.classList.contains('open')) {
            closeAll();
            trigger.focus();
        }
    });

    syncHidden(state);
    return state;
}

function syncHidden(state) {
    const values = [...state.selected];
    state.hidden.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = values.join(',');
    opt.selected = true;
    state.hidden.appendChild(opt);
    state.hidden.value = values.join(',');

    const labels = values
        .map(v => state.options.find(o => o.value === v)?.label || v);
    state.trigger.textContent = labels.length === 0
        ? state.emptyLabel
        : labels.length <= 2
            ? labels.join(', ')
            : `${labels.length} selected`;
    state.trigger.classList.toggle('has-selection', labels.length > 0);
}

/** Programmatically set values. Pass fire=false to avoid a filter re-run. */
export function setValues(rootId, values, fire = false) {
    const state = registry.get(rootId);
    if (!state) return;
    state.selected = new Set(values.filter(v => v));
    for (const box of state.panel.querySelectorAll('input[type=checkbox]')) {
        box.checked = state.selected.has(box.value);
    }
    syncHidden(state);
    if (fire) state.onChange();
}

export function getValues(rootId) {
    return [...(registry.get(rootId)?.selected || [])];
}

/** Show how many loaded jobs sit behind each option. */
export function setOptionCounts(rootId, counts) {
    const state = registry.get(rootId);
    if (!state) return;
    for (const el of state.panel.querySelectorAll('[data-count-for]')) {
        const n = counts[el.dataset.countFor];
        el.textContent = typeof n === 'number' ? n.toLocaleString() : '';
    }
}

export function closeAll() {
    for (const { panel, trigger } of registry.values()) {
        panel.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
    }
}

document.addEventListener('click', e => {
    if (!e.target.closest('.multi')) closeAll();
});
