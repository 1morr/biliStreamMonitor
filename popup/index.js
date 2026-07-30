// Popup entry point: state loading, global controls (add room, manual
// refresh, settings FAB + mode speed-dial), error banner, and the
// background message listener.

import { applyI18n, escapeHtml, t } from '../shared/i18n.js';
import { getState, setState, migrateIfNeeded } from '../shared/storage.js';
import { fetchRoomInfo, fetchMasterInfo, normalizeImageUrl } from '../shared/api.js';
import { renderGrid, initContextMenu } from './cards.js';
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
    notificationPref: '2',
    browserNotify: '1',
    previewMode: 'thumbnail',
    previewSound: false,
    previewVolume: 50,
    monitorMode: 'following',
    appearance: { ...DEFAULT_APPEARANCE }
};

const gridContainer = document.getElementById('grid-container');
const errorBanner = document.getElementById('error-banner');
const errorBannerText = document.getElementById('error-banner-text');

// Session-only flag: closing the banner hides it until a new error arrives.
let bannerDismissed = false;

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    applyI18n();
    await migrateIfNeeded(); // idempotent; converges legacy keys before first read
    await loadData();
    await updateErrorBanner();
    setupControls();
    initContextMenu(State);
    setupSettings(State, { onImported: loadData, onModeChanged: updateModeFab });

    // Always clear the badge when the popup is opened
    chrome.action.setBadgeText({ text: '' });
    if (State.newlyStreaming.length > 0) {
        setState({ newlyStreaming: [] });
    }
});

// --- Data loading ---
async function loadData() {
    if (gridContainer.children.length === 0) {
        gridContainer.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>${escapeHtml(t('syncing'))}</p>
            </div>`;
    }

    try {
        const storage = await getState();

        State.streamers = storage.streamingInfo;
        State.customStreamers = storage.customStreamers;
        State.deletedUids = storage.deletedStreamers;
        State.states = storage.streamerStates;
        State.newlyStreaming = storage.newlyStreaming;
        State.refreshInterval = storage.refreshInterval;
        State.notificationPref = storage.notificationPreference;
        State.browserNotify = storage.browserNotificationPreference;
        State.previewMode = storage.previewMode;
        State.previewSound = storage.previewSound;
        State.previewVolume = storage.previewVolume;
        State.monitorMode = storage.monitorMode;
        State.appearance = { ...DEFAULT_APPEARANCE, ...storage.appearance };

        applyTheme(State);
        renderGrid(State);
        updateSettingsUI(State);
        updateModeFab();
        renderCustomRoomList(State);
    } catch (e) {
        console.error(e);
        gridContainer.innerHTML = `<div class="loading-state"><p>${escapeHtml(e.message)}</p></div>`;
    }
}

// --- Error banner ---
// lastError is persisted by the background as 'auth' | 'risk' | 'network'
// (null on success). The banner mirrors it; nothing listened to the showError
// broadcast before (audit #1).
const ERROR_KEY_BY_KIND = {
    auth: 'errorAuth',
    risk: 'errorRisk',
    network: 'errorNetwork'
};

function errorKindOf(lastError) {
    if (!lastError) return null;
    // Tolerate an object shape ({kind}) in addition to the plain string.
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
    // auth / risk: warning red; network: neutral yellow
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

    document.getElementById('fab-mode').onclick = () => toggleMonitorMode();
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

// --- Mode speed-dial button ---
// The icon shows the CURRENT mode; the tooltip names the mode a click
// switches to. The settings-panel radios stay in sync both ways.
const MODE_FAB_ICON = { following: 'fas fa-users', medal: 'fas fa-medal' };
const MODE_TOOLTIP_KEY = { following: 'modeSwitchToMedal', medal: 'modeSwitchToFollowing' };

function updateModeFab() {
    const btn = document.getElementById('fab-mode');
    btn.querySelector('i').className = MODE_FAB_ICON[State.monitorMode] || MODE_FAB_ICON.following;
    btn.title = t(MODE_TOOLTIP_KEY[State.monitorMode] || MODE_TOOLTIP_KEY.following);
}

async function toggleMonitorMode() {
    State.monitorMode = State.monitorMode === 'medal' ? 'following' : 'medal';
    await setState({ monitorMode: State.monitorMode });
    updateModeFab();
    updateSettingsUI(State); // sync the settings radios if the panel is open
    chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
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
        renderGrid(State);
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
