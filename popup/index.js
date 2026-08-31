// Popup entry point: state loading, global controls (add room, manual refresh,
// settings FAB + display-mode dial), error banner, and the background listener.

import { applyI18n, escapeHtml, t } from '../shared/i18n.js';
import { getState, setState, migrateIfNeeded } from '../shared/storage.js';
import { fetchRoomInfo, fetchMasterInfo, normalizeImageUrl } from '../shared/api.js';
import { DEFAULT_ALERT_SCOPE, ViewMode, SNAPSHOT_MAX_AGE_MS } from '../shared/constants.js';
import { needsFollowing, normalizeAlertScope } from '../shared/scope.js';
import { renderGrid, renderLoading, initContextMenu, liveCountsByView } from './cards.js';
import {
    DEFAULT_APPEARANCE,
    applyTheme,
    updateSettingsUI,
    setupSettings,
    renderCustomRoomList
} from './settings.js';

const State = {
    streamers: [],
    customStreamers: [],
    deletedUids: [],
    states: {},
    newlyStreaming: [],
    refreshInterval: 60,
    previewMode: 'thumbnail',
    previewSound: false,
    previewVolume: 50,
    viewMode: ViewMode.ALERT,
    alertScope: structuredClone(DEFAULT_ALERT_SCOPE),
    followingCache: { fetchedAt: 0, list: [] },
    appearance: { ...DEFAULT_APPEARANCE }
};

const gridContainer = document.getElementById('grid-container');
const errorBanner = document.getElementById('error-banner');
const errorBannerText = document.getElementById('error-banner-text');

// Session-only flag: closing the banner hides it until a new error arrives.
let bannerDismissed = false;
let snapshotInFlight = false;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await migrateIfNeeded(); // idempotent; converges legacy keys before first read
    await loadData();
    await updateErrorBanner();
    setupControls();
    initContextMenu(State, onScopeChanged);
    setupSettings(State, { onImported: loadData, onScopeChanged });

    // Always clear the badge when the popup is opened
    chrome.action.setBadgeText({ text: '' });
    if (State.newlyStreaming.length > 0) {
        setState({ newlyStreaming: [] });
    }
});

// --- Data loading ---
async function loadData() {
    if (gridContainer.children.length === 0) {
        renderLoading('syncing');
    }

    try {
        const storage = await getState();

        State.streamers = storage.streamingInfo;
        State.customStreamers = storage.customStreamers;
        State.deletedUids = storage.deletedStreamers;
        State.states = storage.streamerStates;
        State.newlyStreaming = storage.newlyStreaming;
        State.refreshInterval = storage.refreshInterval;
        State.previewMode = storage.previewMode;
        State.previewSound = storage.previewSound;
        State.previewVolume = storage.previewVolume;
        State.viewMode = storage.viewMode;
        // Normalized on every read: consumers mutate it, and the stored value
        // may predate a source being added.
        State.alertScope = normalizeAlertScope(storage.alertScope);
        State.followingCache = storage.followingCache;
        State.appearance = { ...DEFAULT_APPEARANCE, ...storage.appearance };

        applyTheme(State);
        renderGrid(State);
        updateSettingsUI(State);
        updateViewDial();
        renderCustomRoomList(State);
    } catch (e) {
        console.error(e);
        gridContainer.innerHTML = `<div class="loading-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

/** Anything that changes marks or the alert scope moves the 'alert' view too. */
function onScopeChanged() {
    renderGrid(State);
    updateViewDial();
}

// --- Error banner ---
const ERROR_KEY_BY_KIND = {
    auth: 'errorAuth',
    risk: 'errorRisk',
    network: 'errorNetwork'
};

function errorKindOf(lastError) {
    if (!lastError) return null;
    const kind = typeof lastError === 'string' ? lastError : (lastError.kind || lastError.type || '');
    return ERROR_KEY_BY_KIND[kind] ? kind : 'network';
}

async function updateErrorBanner() {
    const { lastError } = await getState('lastError');
    const kind = errorKindOf(lastError);

    if (!kind || bannerDismissed) {
        errorBanner.classList.add('hidden');
        return;
    }

    errorBannerText.textContent = t(ERROR_KEY_BY_KIND[kind]);
    const severity = kind === 'network' ? 'severity-medium' : 'severity-high';
    errorBanner.className = `error-banner ${severity}`;
}

// --- Global controls ---
function setupControls() {
    document.getElementById('error-banner-close').onclick = () => {
        bannerDismissed = true;
        errorBanner.classList.add('hidden');
    };

    bindRefreshButton(document.getElementById('btn-manual-refresh'), true);

    // The add-room input lives in the settings custom-rooms accordion
    document.getElementById('btn-add-room').onclick = () => addRoom();
    document.getElementById('input-add-room').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addRoom();
    });

    document.getElementById('fab-dial').addEventListener('click', (e) => {
        const button = e.target.closest('[data-view]');
        if (button) setViewMode(button.dataset.view);
    });
}

function bindRefreshButton(btn, withText) {
    if (!btn) return;
    btn.onclick = async () => {
        const original = btn.innerHTML;
        btn.innerHTML = withText
            ? `<i class="fas fa-spinner fa-spin"></i> ${escapeHtml(t('refreshing'))}`
            : '<i class="fas fa-spinner fa-spin"></i>';
        btn.disabled = true;
        // The background answers this message after the cycle finishes.
        await chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
        await loadData();
        setTimeout(() => { btn.innerHTML = original; btn.disabled = false; }, 800);
    };
}

// --- Display-mode dial ---
// Icon-only by design; the name and live count live in the native tooltip so
// the resting popup carries no chrome at all.
const VIEW_LABEL_KEY = {
    [ViewMode.ALERT]: 'viewAlert',
    [ViewMode.MEDAL]: 'viewMedal',
    [ViewMode.MARK]: 'viewMark',
    [ViewMode.ALL]: 'viewAll'
};

function updateViewDial() {
    const counts = liveCountsByView(State);
    document.querySelectorAll('#fab-dial [data-view]').forEach(button => {
        const mode = button.dataset.view;
        button.classList.toggle('on', mode === State.viewMode);
        button.title = t('viewTooltip', [t(VIEW_LABEL_KEY[mode]), String(counts[mode] ?? 0)]);
    });
}

async function setViewMode(mode) {
    if (!Object.values(ViewMode).includes(mode) || mode === State.viewMode) return;
    State.viewMode = mode;
    await setState({ viewMode: mode });
    updateViewDial();
    renderGrid(State);

    if (mode === ViewMode.ALL) await ensureFollowingSnapshot();
}

/**
 * The 'all' view needs the follow list. When the 'rest' source is subscribed
 * the cycle already paged it into streamingInfo; otherwise fetch it on demand.
 *
 * The reply only ever lands in followingCache — the background writes no diff
 * state for it — so opening this view can never move the badge.
 */
async function ensureFollowingSnapshot() {
    if (needsFollowing(State.alertScope) || snapshotInFlight) return;

    const age = Date.now() - (State.followingCache?.fetchedAt || 0);
    if (age < State.refreshInterval * 1000) return; // still fresh

    // Past this age the cached "live" flags are not worth showing at all.
    if (age > SNAPSHOT_MAX_AGE_MS) renderLoading('loadingFollowing');

    snapshotInFlight = true;
    try {
        await chrome.runtime.sendMessage({ type: 'fetchFollowing' }).catch(() => {});
        const { followingCache } = await getState(['followingCache']);
        State.followingCache = followingCache;
        renderGrid(State);
        updateViewDial();
    } finally {
        snapshotInFlight = false;
    }
}

// --- Add room (input lives in the settings custom-rooms accordion) ---
function parseRoomId(input) {
    input = input.trim();
    const urlMatch = input.match(/live\.bilibili\.com\/(\d+)/);
    if (urlMatch) return urlMatch[1];
    if (/^\d+$/.test(input)) return input;
    return null;
}

function showAddRoomStatus(msg, type) {
    const el = document.getElementById('add-room-status');
    el.textContent = msg;
    el.className = `custom-room-status ${type}`;
    if (type !== 'loading') {
        setTimeout(() => el.classList.add('hidden'), 3000);
    }
}

async function addRoom() {
    const input = document.getElementById('input-add-room');
    const roomId = parseRoomId(input.value);
    if (!roomId) {
        showAddRoomStatus(t('addRoomInvalid'), 'error');
        return;
    }

    // Duplicate check by room id against the custom list
    if (State.customStreamers.some(s => String(s.roomId) === String(roomId))) {
        showAddRoomStatus(t('addRoomDuplicateCustom'), 'error');
        return;
    }

    const btn = document.getElementById('btn-add-room');
    btn.disabled = true;
    showAddRoomStatus(t('addRoomFetching'), 'loading');

    try {
        // Room info: uid + current live status (throws on code !== 0)
        const roomData = await fetchRoomInfo(roomId);
        const uid = Number(roomData.uid);

        // Duplicate check by uid against the mode list and the custom list
        if (State.streamers.some(s => String(s.uid) === String(uid))) {
            showAddRoomStatus(t('addRoomDuplicateMain'), 'error');
            input.value = '';
            return;
        }
        if (State.customStreamers.some(s => String(s.uid) === String(uid))) {
            showAddRoomStatus(t('addRoomDuplicateCustom'), 'error');
            input.value = '';
            return;
        }

        // Master info for name/avatar; failure is tolerated with a fallback
        let uname = t('roomFallbackName', [roomId]);
        let face = chrome.runtime.getURL('images/icon128.png');
        try {
            const masterData = await fetchMasterInfo(uid);
            if (masterData && masterData.info) {
                uname = masterData.info.uname || uname;
                face = normalizeImageUrl(masterData.info.face) || face;
            }
        } catch (e) {
            console.warn('Master info fetch failed, using fallback:', e);
        }

        // New entries use the normalized shape directly (see shared/merge.js)
        const newStreamer = {
            uid,
            roomId: Number(roomId),
            uname,
            face,
            liveStatus: roomData.live_status,
            title: '',
            cover: '',
            area: '',
            medalName: null,
            medalLevel: null,
            isCustom: true
        };

        State.customStreamers.push(newStreamer);
        await setState({ customStreamers: State.customStreamers });

        input.value = '';
        showAddRoomStatus(t('addedRoom', [uname]), 'success');
        renderCustomRoomList(State);
        onScopeChanged();
        chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
    } catch (err) {
        showAddRoomStatus(t('addRoomError', [String(err.message || err)]), 'error');
    } finally {
        btn.disabled = false;
    }
}

// --- Background message listener ---
chrome.runtime.onMessage.addListener((req) => {
    const type = req && (req.type || req.action);
    if (type === 'streamersUpdated') {
        loadData();
        updateErrorBanner(); // a successful cycle clears lastError -> banner hides
    } else if (type === 'showError') {
        bannerDismissed = false; // a fresh error resurfaces the banner
        updateErrorBanner();
    }
});
