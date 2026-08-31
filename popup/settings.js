// Popup module: settings panel (appearance, alert scope, general, custom
// room management, hidden list, import/export).

import {
    MIN_REFRESH_INTERVAL,
    ALERT_SOURCES,
    ALERT_CHANNELS,
    BATCH_UID_LIMIT,
    FOLLOW_PAGE_ESTIMATE,
    SNAPSHOT_MAX_AGE_MS
} from '../shared/constants.js';
import { getState, setState, importConfig, exportConfig } from '../shared/storage.js';
import { escapeHtml, t } from '../shared/i18n.js';
import { normalizeStreamer } from '../shared/merge.js';
import { sourceOf, needsFollowing, trackedUids, channelSources } from '../shared/scope.js';
import { renderGrid, knownLiveStreamers } from './cards.js';
import { updateIframeAudio } from './preview.js';

export const DEFAULT_APPEARANCE = {
    width: 500,
    height: 550,
    avatarSize: 84,
    cardPaddingY: 10,
    cardPaddingX: 0,
    fontSize: 14,
    gapX: 12,
    gapY: 12,
    showCardBg: false,
    theme: 'light'
};

const FALLBACK_ICON = chrome.runtime.getURL('images/icon128.png');

// Set by setupSettings; lets the list editors below refresh the display dial,
// whose per-mode counts change whenever the known population does.
let notifyScopeChanged = () => {};

const settingsPanel = document.getElementById('settings-panel');
const deletedPanel = document.getElementById('deleted-panel');
const gridContainer = document.getElementById('grid-container');

// --- Theme ---

export function applyTheme(state) {
    const appearance = state.appearance;
    const root = document.documentElement;
    root.style.setProperty('--app-width', `${appearance.width}px`);
    root.style.setProperty('--app-height', `${appearance.height}px`);
    root.style.setProperty('--avatar-size', `${appearance.avatarSize}px`);
    root.style.setProperty('--card-padding-y', `${appearance.cardPaddingY}px`);
    root.style.setProperty('--card-padding-x', `${appearance.cardPaddingX}px`);
    root.style.setProperty('--base-font-size', `${appearance.fontSize}px`);
    root.style.setProperty('--grid-gap-x', `${appearance.gapX}px`);
    root.style.setProperty('--grid-gap-y', `${appearance.gapY}px`);

    root.setAttribute('data-theme', appearance.theme || 'light');

    if (appearance.showCardBg) {
        gridContainer.classList.remove('minimal-mode');
    } else {
        gridContainer.classList.add('minimal-mode');
    }
}

function saveAppearance(state) {
    setState({ appearance: state.appearance });
}

// --- Settings UI sync ---

export function updateSettingsUI(state) {
    document.getElementById('input-interval').value = state.refreshInterval;
    document.getElementById('select-preview-mode').value = state.previewMode;
    document.getElementById('check-preview-sound').checked = state.previewSound;
    document.getElementById('range-preview-volume').value = state.previewVolume;
    document.getElementById('val-preview-volume').textContent = `${state.previewVolume}%`;

    renderScopeMatrix(state);

    const app = state.appearance;

    const syncUI = (id, val) => {
        const range = document.getElementById(`range-${id}`);
        const num = document.getElementById(`num-${id}`);
        if (range && num) {
            range.value = val;
            num.value = val;
        }
    };

    syncUI('width', app.width);
    syncUI('height', app.height);
    syncUI('avatar', app.avatarSize);
    syncUI('gap-x', app.gapX);
    syncUI('gap-y', app.gapY);
    syncUI('padding-y', app.cardPaddingY);
    syncUI('padding-x', app.cardPaddingX);
    syncUI('font', app.fontSize);

    document.getElementById('check-card-bg').checked = app.showCardBg;

    const themeSelect = document.getElementById('select-theme');
    if (themeSelect) {
        themeSelect.value = app.theme || 'light';
    }

    updateAudioControlsState(state);
}

function updateAudioControlsState(state) {
    const isLiveMode = state.previewMode === 'live';
    const isSoundEnabled = state.previewSound;

    const soundWrap = document.getElementById('wrap-preview-sound');
    const volumeWrap = document.getElementById('wrap-preview-volume');
    const soundCheck = document.getElementById('check-preview-sound');
    const volumeRange = document.getElementById('range-preview-volume');

    if (isLiveMode) {
        soundWrap.classList.remove('disabled');
        soundCheck.disabled = false;

        if (isSoundEnabled) {
            volumeWrap.classList.remove('disabled');
            volumeRange.disabled = false;
        } else {
            volumeWrap.classList.add('disabled');
            volumeRange.disabled = true;
        }
    } else {
        soundWrap.classList.add('disabled');
        soundCheck.disabled = true;

        volumeWrap.classList.add('disabled');
        volumeRange.disabled = true;
    }
}

// --- Custom room list management ---

export function renderCustomRoomList(state) {
    const container = document.getElementById('custom-room-list');
    if (!state.customStreamers.length) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML = state.customStreamers.map(raw => {
        const s = normalizeStreamer(raw);
        if (!s) return '';
        const face = s.face || FALLBACK_ICON;
        return `
        <div class="custom-room-item">
            <img src="${escapeHtml(face)}" referrerpolicy="no-referrer" alt="${escapeHtml(s.uname)}">
            <div class="custom-room-info">
                <div class="custom-room-name">${escapeHtml(s.uname)}</div>
                <div class="custom-room-id">${escapeHtml(t('roomFallbackName', [String(s.roomId)]))}</div>
            </div>
            <button class="btn-remove-custom" data-uid="${escapeHtml(s.uid)}" title="${escapeHtml(t('remove'))}"><i class="fas fa-times"></i></button>
        </div>`;
    }).join('');

    container.querySelectorAll('.btn-remove-custom').forEach(btn => {
        btn.addEventListener('click', () => removeCustomRoom(state, btn.dataset.uid));
    });
}

async function removeCustomRoom(state, uid) {
    state.customStreamers = state.customStreamers.filter(s => String(s.uid) !== String(uid));
    await setState({ customStreamers: state.customStreamers });
    renderCustomRoomList(state);
    renderGrid(state);
    notifyScopeChanged();
}

// --- Hidden (deleted) streamers list ---

function renderDeletedList(state) {
    const container = document.getElementById('deleted-list');
    if (state.deletedUids.length === 0) {
        container.innerHTML = `<div class="deleted-list-empty">${escapeHtml(t('listEmpty'))}</div>`;
        return;
    }
    const allStreamers = [...state.streamers, ...state.customStreamers]
        .map(normalizeStreamer)
        .filter(Boolean);
    container.innerHTML = state.deletedUids.map(uid => {
        const info = allStreamers.find(s => String(s.uid) === String(uid))
            || { uname: t('unknown'), face: FALLBACK_ICON };
        const face = info.face || FALLBACK_ICON;
        return `
            <div class="deleted-item">
                <img src="${escapeHtml(face)}" referrerpolicy="no-referrer" alt="">
                <span>${escapeHtml(info.uname)}</span>
                <button class="restore-btn" data-uid="${escapeHtml(uid)}"><i class="fas fa-undo"></i></button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', () => restoreStreamer(state, parseInt(btn.dataset.uid, 10)));
    });
}

async function restoreStreamer(state, uid) {
    state.deletedUids = state.deletedUids.filter(id => Number(id) !== uid);
    await setState({ deletedStreamers: state.deletedUids });
    renderDeletedList(state);
    renderGrid(state);
    notifyScopeChanged();
}

// --- Alert scope matrix ---

/**
 * Live headcount per source bucket. Buckets are mutually exclusive
 * (shared/scope.js sourceOf), which is what lets the tallies be plain sums.
 *
 * 'rest' is only knowable when the follow list has actually been fetched —
 * either because the source is subscribed, or because the "all" view pulled a
 * snapshot. Otherwise it reads as unknown rather than as a fabricated zero.
 */
function sourceCounts(state) {
    const counts = Object.fromEntries(ALERT_SOURCES.map(source => [source, 0]));
    for (const streamer of knownLiveStreamers(state)) {
        counts[sourceOf(streamer, state.states)] += 1;
    }
    // Must agree with what cards.js actually folds into the grid, or the row
    // shows a fabricated 0 for a population nobody fetched.
    const cache = state.followingCache;
    const restKnown = needsFollowing(state.alertScope)
        || Boolean(cache && cache.list.length > 0
            && Date.now() - (cache.fetchedAt || 0) <= SNAPSHOT_MAX_AGE_MS);
    return { counts, restKnown };
}

/** Requests one refresh cycle will make under the current scope. */
function cycleCost(state) {
    // The medal wall rides the same batch, so it counts toward the chunking.
    const medalUids = state.streamers
        .filter(streamer => streamer.medalName != null)
        .map(streamer => Number(streamer.uid));
    const tracked = trackedUids(state.customStreamers, state.states, medalUids);
    const batches = Math.ceil(tracked.length / BATCH_UID_LIMIT);
    const paging = needsFollowing(state.alertScope);
    return {
        requests: 1 + batches + (paging ? FOLLOW_PAGE_ESTIMATE : 0),
        approximate: paging
    };
}

export function renderScopeMatrix(state) {
    const { counts, restKnown } = sourceCounts(state);

    for (const source of ALERT_SOURCES) {
        const cell = document.getElementById(`count-${source}`);
        if (cell) {
            cell.textContent = (source === 'rest' && !restKnown) ? '—' : String(counts[source]);
        }
    }

    for (const channel of ALERT_CHANNELS) {
        const sources = channelSources(state.alertScope, channel);
        let tally = 0;
        let anyChecked = false;

        for (const source of ALERT_SOURCES) {
            const box = document.getElementById(`chk-${channel}-${source}`);
            const on = Boolean(sources[source]);
            if (box) {
                box.classList.toggle('on', on);
                box.setAttribute('aria-checked', String(on));
            }
            if (on) {
                anyChecked = true;
                if (source !== 'rest' || restKnown) tally += counts[source];
            }
        }

        const pill = document.getElementById(`scope-tally-${channel}`);
        if (pill) {
            const key = channel === 'badge' ? 'scopeTallyBadge' : 'scopeTallyNotify';
            const offKey = channel === 'badge' ? 'scopeTallyBadgeOff' : 'scopeTallyNotifyOff';
            pill.textContent = anyChecked ? t(key, [String(tally)]) : t(offKey);
            pill.classList.toggle('off', !anyChecked);
        }
    }

    const cost = cycleCost(state);
    const costPill = document.getElementById('scope-cost');
    if (costPill) {
        costPill.textContent = cost.approximate
            ? t('scopeCostApprox', [String(cost.requests)])
            : t('scopeCost', [String(cost.requests)]);
        costPill.classList.toggle('heavy', cost.approximate);
    }

    // The 'alert' display mode is the union of both columns, so it needs its
    // own number — with divergent columns it matches neither one.
    const unionHint = document.getElementById('scope-union-hint');
    if (unionHint) {
        let union = 0;
        for (const source of ALERT_SOURCES) {
            const subscribed = ALERT_CHANNELS.some(
                channel => channelSources(state.alertScope, channel)[source]
            );
            if (subscribed && (source !== 'rest' || restKnown)) union += counts[source];
        }
        unionHint.textContent = t('scopeUnionHint', [String(union)]);
    }
}

/**
 * Wire the ten checkboxes. Each flip can change the fetch plan, so the refresh
 * is debounced: firing a cycle per click during a multi-box edit would be both
 * wasteful and a risk-control nudge.
 */
function bindScopeMatrix(state, onScopeChanged) {
    let refreshTimer = null;
    const scheduleRefresh = () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
        }, 800);
    };

    for (const channel of ALERT_CHANNELS) {
        for (const source of ALERT_SOURCES) {
            const box = document.getElementById(`chk-${channel}-${source}`);
            if (!box) continue;
            box.addEventListener('click', async () => {
                const sources = channelSources(state.alertScope, channel);
                sources[source] = !sources[source];
                await setState({ alertScope: state.alertScope });
                renderScopeMatrix(state);
                if (onScopeChanged) onScopeChanged();
                scheduleRefresh();
            });
        }
    }
}

// --- Event wiring ---

/**
 * Bind every settings-panel control.
 * @param {Object} state shared popup state (mutated in place)
 * @param {Object} callbacks
 * @param {Function} callbacks.onImported called after a successful config
 *   import so the entry point can reload state and re-render
 * @param {Function} callbacks.onScopeChanged called after the alert scope
 *   changes so the entry point can re-render the grid and the display dial
 */
export function setupSettings(state, { onImported, onScopeChanged } = {}) {
    if (onScopeChanged) notifyScopeChanged = onScopeChanged;

    // 1. Accordion toggles
    const wrapperAppearance = document.querySelector('.accordion-wrapper');
    document.getElementById('btn-toggle-appearance').onclick = () => {
        wrapperAppearance.classList.toggle('open');
    };

    const wrapperCustomRooms = document.getElementById('accordion-custom-rooms');
    document.getElementById('btn-toggle-custom-rooms').onclick = () => {
        wrapperCustomRooms.classList.toggle('open');
    };

    // 2. Panel open/close (open button is the settings FAB)
    document.getElementById('fab-settings').onclick = () => {
        updateSettingsUI(state); // reflect the latest state on every open
        settingsPanel.classList.remove('hidden');
    };
    document.getElementById('btn-close-settings').onclick = () => settingsPanel.classList.add('hidden');

    // --- Appearance sliders ---
    const bindSlider = (id, key) => {
        const rangeInput = document.getElementById(`range-${id}`);
        const numInput = document.getElementById(`num-${id}`);
        const container = document.getElementById(`wrap-${id}`);

        rangeInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            numInput.value = val;
            state.appearance[key] = val;

            if (key !== 'width' && key !== 'height') {
                applyTheme(state);
            }
        });

        numInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val)) {
                state.appearance[key] = val;
                if (val >= parseInt(rangeInput.min, 10) && val <= parseInt(rangeInput.max, 10)) {
                    rangeInput.value = val;
                }
                if (key !== 'width' && key !== 'height') {
                    applyTheme(state);
                }
            }
        });

        const saveHandler = () => {
            if (key === 'width' || key === 'height') {
                applyTheme(state);
            }
            saveAppearance(state);
        };

        rangeInput.addEventListener('change', saveHandler);
        numInput.addEventListener('change', saveHandler);

        // Ghost mode: hide the panel chrome while dragging a slider
        const startGhost = () => {
            settingsPanel.classList.add('ghost-mode');
            container.classList.add('active-control');
        };
        const endGhost = () => {
            settingsPanel.classList.remove('ghost-mode');
            container.classList.remove('active-control');
        };

        rangeInput.addEventListener('mousedown', startGhost);
        rangeInput.addEventListener('touchstart', startGhost, { passive: true });

        window.addEventListener('mouseup', endGhost);
        window.addEventListener('touchend', endGhost);
    };

    bindSlider('width', 'width');
    bindSlider('height', 'height');
    bindSlider('avatar', 'avatarSize');
    bindSlider('gap-x', 'gapX');
    bindSlider('gap-y', 'gapY');
    bindSlider('padding-y', 'cardPaddingY');
    bindSlider('padding-x', 'cardPaddingX');
    bindSlider('font', 'fontSize');

    document.getElementById('check-card-bg').addEventListener('change', (e) => {
        state.appearance.showCardBg = e.target.checked;
        applyTheme(state);
        saveAppearance(state);
    });

    const themeSelect = document.getElementById('select-theme');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            state.appearance.theme = e.target.value;
            applyTheme(state);
            saveAppearance(state);
        });
    }

    document.getElementById('btn-reset-appearance').onclick = () => {
        state.appearance = { ...DEFAULT_APPEARANCE };
        applyTheme(state);
        saveAppearance(state);
        updateSettingsUI(state);
    };

    // --- General settings ---
    document.getElementById('input-interval').onchange = (e) => {
        const parsed = parseInt(e.target.value, 10);
        if (!Number.isFinite(parsed)) return;
        const val = Math.max(MIN_REFRESH_INTERVAL, parsed);
        e.target.value = val;
        state.refreshInterval = val;
        setState({ refreshInterval: val });
        chrome.runtime.sendMessage({ type: 'setRefreshInterval', interval: val }).catch(() => {});
    };
    document.getElementById('select-preview-mode').onchange = (e) => {
        state.previewMode = e.target.value;
        setState({ previewMode: e.target.value });
        updateAudioControlsState(state);
    };
    document.getElementById('check-preview-sound').onchange = (e) => {
        state.previewSound = e.target.checked;
        setState({ previewSound: state.previewSound });
        updateIframeAudio(state);
        updateAudioControlsState(state);
    };
    const rangeVolume = document.getElementById('range-preview-volume');
    rangeVolume.oninput = (e) => {
        const val = parseInt(e.target.value, 10);
        state.previewVolume = val;
        document.getElementById('val-preview-volume').textContent = `${val}%`;
        updateIframeAudio(state);
    };
    rangeVolume.onchange = (e) => {
        setState({ previewVolume: parseInt(e.target.value, 10) });
    };

    // --- Alert scope matrix ---
    bindScopeMatrix(state, onScopeChanged);

    // --- Hidden list panel ---
    document.getElementById('btn-deleted').onclick = () => {
        settingsPanel.classList.add('hidden');
        deletedPanel.classList.remove('hidden');
        renderDeletedList(state);
    };
    document.getElementById('btn-close-deleted').onclick = () => {
        deletedPanel.classList.add('hidden');
        settingsPanel.classList.remove('hidden');
    };

    // --- Export / Import ---
    document.getElementById('btn-export').onclick = async () => {
        const fullState = await getState();
        const data = exportConfig(fullState);
        const date = new Date().toISOString().slice(0, 10);
        const filename = `bili-monitor-settings-${date}.json`;

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    document.getElementById('btn-import').onclick = () => document.getElementById('file-import').click();
    document.getElementById('file-import').onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const config = JSON.parse(ev.target.result);
                const written = await importConfig(config);
                if (written.length === 0) throw new Error('no valid settings keys');
                if (onImported) await onImported();
                chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
            } catch (err) {
                console.error('Config import failed:', err);
                alert(t('importInvalid'));
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    renderCustomRoomList(state);
}
