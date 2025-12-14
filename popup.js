// popup.js

// 1. 定义默认配置
const DEFAULT_APPEARANCE = {
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

// 2. State
const State = {
    streamers: [],
    deletedUids: [],
    states: {}, 
    newlyStreaming: [],
    refreshInterval: 60,
    notificationPref: '2',
    browserNotify: '1',
    appearance: { ...DEFAULT_APPEARANCE }, 
    roomCache: new Map() 
};

// --- DOM Elements ---
const gridContainer = document.getElementById('grid-container');
const previewTooltip = document.getElementById('preview-tooltip');
const previewImg = document.getElementById('preview-img');
const previewLoader = document.getElementById('preview-loader');
const previewTitle = document.getElementById('preview-title');
const previewTime = document.getElementById('preview-time');
const contextMenu = document.getElementById('context-menu');
const settingsPanel = document.getElementById('settings-panel');
const deletedPanel = document.getElementById('deleted-panel');

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    await loadData();
    setupEventListeners();
    
    // Always clear badge when popup is opened
    chrome.action.setBadgeText({ text: '' });
    if (State.newlyStreaming.length > 0) {
        chrome.storage.local.set({ newlyStreaming: [] });
    }
});

// --- Data Loading ---
async function loadData() {
    if (gridContainer.children.length === 0) {
        gridContainer.innerHTML = `
            <div class="loading-state">
                <div class="spinner"></div>
                <p>Syncing...</p>
            </div>`;
    }

    try {
        const storage = await chrome.storage.local.get([
            'streamingInfo', 'deletedStreamers', 'streamerStates', 
            'newlyStreaming', 'refreshInterval', 
            'notificationPreference', 'browserNotificationsEnabled',
            'browserNotificationPreference',
            'appearance'
        ]);

        State.streamers = storage.streamingInfo || [];
        State.deletedUids = storage.deletedStreamers || [];
        State.states = storage.streamerStates || {};
        State.newlyStreaming = storage.newlyStreaming || [];
        State.refreshInterval = storage.refreshInterval || 60;
        State.notificationPref = storage.notificationPreference || '2';
        
        // Data Migration for browserNotify
        if (storage.browserNotificationPreference !== undefined) {
            State.browserNotify = storage.browserNotificationPreference;
        } else {
            // Migration logic
            const enabled = storage.browserNotificationsEnabled !== false;
            State.browserNotify = enabled ? (storage.notificationPreference || '1') : '0';
        }
        
        let loadedAppearance = storage.appearance || {};
        
        // Migration: cardPadding -> cardPaddingY
        if (loadedAppearance.cardPadding !== undefined && loadedAppearance.cardPaddingY === undefined) {
             loadedAppearance.cardPaddingY = loadedAppearance.cardPadding;
             delete loadedAppearance.cardPadding;
        }
        // Migration: cardPaddingH -> cardPaddingX
        if (loadedAppearance.cardPaddingH !== undefined && loadedAppearance.cardPaddingX === undefined) {
             loadedAppearance.cardPaddingX = loadedAppearance.cardPaddingH;
             delete loadedAppearance.cardPaddingH;
        }
        
        State.appearance = { ...DEFAULT_APPEARANCE, ...loadedAppearance }; 

        applyTheme(State.appearance);
        renderGrid();
        updateSettingsUI();

    } catch (e) {
        console.error(e);
        gridContainer.innerHTML = `<div class="loading-state"><p>${e.message}</p></div>`;
    }
}

// --- Theme Logic ---
function applyTheme(appearance) {
    const root = document.documentElement;
    root.style.setProperty('--app-width', `${appearance.width}px`);
    root.style.setProperty('--app-height', `${appearance.height}px`);
    root.style.setProperty('--avatar-size', `${appearance.avatarSize}px`);
    root.style.setProperty('--card-padding-y', `${appearance.cardPaddingY}px`);
    root.style.setProperty('--card-padding-x', `${appearance.cardPaddingX}px`);
    root.style.setProperty('--base-font-size', `${appearance.fontSize}px`);
    root.style.setProperty('--grid-gap-x', `${appearance.gapX}px`);
    root.style.setProperty('--grid-gap-y', `${appearance.gapY}px`);

    // Apply theme (dark/light)
    root.setAttribute('data-theme', appearance.theme || 'light');

    if (appearance.showCardBg) {
        gridContainer.classList.remove('minimal-mode');
    } else {
        gridContainer.classList.add('minimal-mode');
    }
}

function saveAppearance() {
    chrome.storage.local.set({ appearance: State.appearance });
}

// --- Rendering ---
function renderGrid() {
    const visibleStreamers = State.streamers.filter(s => !State.deletedUids.includes(s.uid));

    if (visibleStreamers.length === 0) {
        gridContainer.innerHTML = `
            <div class="loading-state">
                <i class="fab fa-bilibili" style="font-size: 32px; margin-bottom: 10px; opacity:0.5;"></i>
                <p>No streamers found.</p>
            </div>`;
        return;
    }

    visibleStreamers.sort((a, b) => {
        const getWeight = (s) => {
            let weight = 0;
            const status = Number(s.live_status);
            if (status === 1) weight += 10000000;
            const state = State.states[s.uid];
            if (state === 'favorite') weight += 200000;
            else if (state === 'like') weight += 100000;
            weight += (Number(s.medal_level) || 0);
            return weight;
        };
        return getWeight(b) - getWeight(a);
    });

    gridContainer.innerHTML = visibleStreamers.map(s => createCardHTML(s)).join('');
    
    document.querySelectorAll('.streamer-card').forEach(card => {
        card.addEventListener('click', () => openStream(card.dataset.link));
        card.addEventListener('contextmenu', (e) => showContextMenu(e, card.dataset.uid));
        card.addEventListener('mouseenter', (e) => handleHover(e, card.dataset.uid, card.dataset.roomid));
        card.addEventListener('mouseleave', handleLeave);
    });
}

function createCardHTML(s) {
    const isLive = Number(s.live_status) === 1;
    const state = State.states[s.uid];
    const isNewLive = isLive && State.newlyStreaming.some(uid => String(uid) === String(s.uid));
    
    let badgeHTML = '';
    if (state === 'favorite') {
        badgeHTML = `<div class="avatar-badge fav"><i class="fas fa-heart"></i></div>`;
    } else if (state === 'like') {
        badgeHTML = `<div class="avatar-badge like"><i class="fas fa-star"></i></div>`;
    }

    return `
        <div class="streamer-card ${!isLive ? 'offline' : ''} ${isNewLive ? 'new-live' : ''}" 
             data-uid="${s.uid}" 
             data-link="${s.link}"
             data-roomid="${s.roomId}">
            
            <div class="avatar-wrapper">
                <img src="${s.streamer_icon}" loading="lazy" alt="${s.streamer_name}">
                ${badgeHTML}
                ${isLive ? '<div class="live-dot"></div>' : ''}
            </div>
            
            <div class="streamer-name">${s.streamer_name}</div>
            <div class="medal-info">${s.medal_name} · Lv.${s.medal_level}</div>
        </div>
    `;
}

// --- Tooltip Logic ---
let hoverTimeout;
let currentHoverUid = null;

async function handleHover(e, uid, roomId) {
    const streamer = State.streamers.find(s => String(s.uid) === String(uid));
    if (!streamer || Number(streamer.live_status) !== 1) return;

    currentHoverUid = uid;
    updateTooltipPosition(e.target);

    clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(async () => {
        if (currentHoverUid !== uid) return;
        
        previewTooltip.classList.remove('hidden');
        previewTooltip.classList.add('visible');
        
        previewImg.classList.remove('loaded');
        previewLoader.classList.remove('hidden'); 
        previewImg.src = ''; 
        
        let roomData = State.roomCache.get(roomId);
        
        if (!roomData) {
            try {
                const res = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`);
                const json = await res.json();
                if(json.code === 0) {
                    roomData = json.data;
                    State.roomCache.set(roomId, roomData);
                }
            } catch (err) {
                console.error(err);
                previewTitle.textContent = "Error loading info";
                previewLoader.classList.add('hidden');
                return;
            }
        }

        if (currentHoverUid !== uid) return;

        if (roomData) {
            const thumb = roomData.keyframe || roomData.user_cover;
            previewImg.src = thumb;
            previewImg.onload = () => {
                previewImg.classList.add('loaded');
                previewLoader.classList.add('hidden');
            };
            if (previewImg.complete) {
                previewImg.classList.add('loaded');
                previewLoader.classList.add('hidden');
            }
            previewTitle.textContent = roomData.title;
            const startTime = new Date(roomData.live_time.replace(' ', 'T'));
            const diff = Date.now() - startTime.getTime();
            const hrs = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            previewTime.textContent = `Live for: ${hrs}h ${mins}m`;
        }

    }, 350); 
}

function handleLeave() {
    currentHoverUid = null;
    clearTimeout(hoverTimeout);
    previewTooltip.classList.remove('visible');
    setTimeout(() => {
        if (!currentHoverUid) {
            previewTooltip.classList.add('hidden');
            previewImg.src = ''; 
        }
    }, 200);
}

function updateTooltipPosition(targetEl) {
    const rect = targetEl.getBoundingClientRect();
    const tooltipHeight = 210;
    const tooltipWidth = 260;
    const gap = 10;
    let top = rect.bottom + gap;
    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);

    if (left < 10) left = 10;
    const appWidth = State.appearance.width;
    if (left + tooltipWidth > appWidth - 10) left = appWidth - tooltipWidth - 10;
    
    if (top + tooltipHeight > window.innerHeight) top = rect.top - tooltipHeight - gap;
    previewTooltip.style.top = `${top}px`;
    previewTooltip.style.left = `${left}px`;
}

// --- Context Menu ---
let contextTargetUid = null;

function showContextMenu(e, uid) {
    e.preventDefault();
    contextTargetUid = uid;
    
    const items = contextMenu.querySelectorAll('.menu-item');
    items.forEach(item => item.classList.remove('active'));
    const state = State.states[uid];
    if (state === 'favorite' || state === 'like') {
        const activeItem = contextMenu.querySelector(`.menu-item[data-action="${state}"]`);
        if (activeItem) activeItem.classList.add('active');
    }
    
    let x = e.clientX;
    let y = e.clientY;
    const menuWidth = 140; 
    
    if (x + menuWidth > State.appearance.width) x = State.appearance.width - menuWidth - 10;
    
    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

    const closeMenu = () => {
        contextMenu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

contextMenu.addEventListener('click', async (e) => {
    const action = e.target.closest('.menu-item')?.dataset.action;
    if (!action || !contextTargetUid) return;

    const uid = contextTargetUid;
    
    if (action === 'hide') {
        State.deletedUids.push(Number(uid));
        delete State.states[uid];
        await chrome.storage.local.set({ deletedStreamers: State.deletedUids, streamerStates: State.states });
    } else {
        if (State.states[uid] === action) delete State.states[uid];
        else State.states[uid] = action;
        await chrome.storage.local.set({ streamerStates: State.states });
    }

    renderGrid();
    chrome.runtime.sendMessage({ action: 'updateStreamers' });
});

// --- Settings Logic ---
function updateSettingsUI() {
    document.getElementById('input-interval').value = State.refreshInterval;
    document.getElementById('select-notification').value = State.notificationPref;
    document.getElementById('select-browser-notify').value = State.browserNotify;

    const app = State.appearance;
    
    const syncUI = (id, val) => {
        const range = document.getElementById(`range-${id}`);
        const num = document.getElementById(`num-${id}`);
        if(range && num) {
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
    
    // Update Theme Select
    const themeSelect = document.getElementById('select-theme');
    if (themeSelect) {
        themeSelect.value = app.theme || 'light';
    }
}

function setupEventListeners() {
    // 1. Accordion Toggle
    const btnAppearance = document.getElementById('btn-toggle-appearance');
    const contentAppearance = document.getElementById('appearance-content');
    const wrapperAppearance = document.querySelector('.accordion-wrapper');
    
    btnAppearance.onclick = () => {
        wrapperAppearance.classList.toggle('open');
    };

    // 2. Settings Panel Open/Close
    document.getElementById('fab-settings').onclick = () => settingsPanel.classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => settingsPanel.classList.add('hidden');

    document.getElementById('btn-manual-refresh').onclick = async () => {
        const btn = document.getElementById('btn-manual-refresh');
        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        btn.disabled = true;
        await chrome.runtime.sendMessage({ action: 'updateStreamers' });
        await loadData();
        setTimeout(() => { btn.innerHTML = originalText; btn.disabled = false; }, 800);
    };

    // --- Appearance Sliders ---
    const bindSlider = (id, key) => {
        const rangeInput = document.getElementById(`range-${id}`);
        const numInput = document.getElementById(`num-${id}`);
        const container = document.getElementById(`wrap-${id}`);
        
        rangeInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            numInput.value = val; 
            State.appearance[key] = val;
            
            if (key !== 'width' && key !== 'height') {
                applyTheme(State.appearance);
            }
        });

        numInput.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            if (!isNaN(val)) {
                State.appearance[key] = val;
                if (val >= parseInt(rangeInput.min) && val <= parseInt(rangeInput.max)) {
                    rangeInput.value = val;
                }
                if (key !== 'width' && key !== 'height') {
                    applyTheme(State.appearance);
                }
            }
        });

        const saveHandler = () => {
            if (key === 'width' || key === 'height') {
                applyTheme(State.appearance);
            }
            saveAppearance();
        };

        rangeInput.addEventListener('change', saveHandler);
        numInput.addEventListener('change', saveHandler);

        // Ghost Mode
        const startGhost = () => {
            settingsPanel.classList.add('ghost-mode');
            container.classList.add('active-control');
        };
        const endGhost = () => {
            settingsPanel.classList.remove('ghost-mode');
            container.classList.remove('active-control');
        };

        rangeInput.addEventListener('mousedown', startGhost);
        rangeInput.addEventListener('touchstart', startGhost, {passive: true});
        
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
        State.appearance.showCardBg = e.target.checked;
        applyTheme(State.appearance);
        saveAppearance();
    });

    // Theme Select Listener
    const themeSelect = document.getElementById('select-theme');
    if (themeSelect) {
        themeSelect.addEventListener('change', (e) => {
            State.appearance.theme = e.target.value;
            applyTheme(State.appearance);
            saveAppearance();
        });
    }

    document.getElementById('btn-reset-appearance').onclick = () => {
        State.appearance = { ...DEFAULT_APPEARANCE };
        applyTheme(State.appearance);
        saveAppearance();
        updateSettingsUI();
    };

    // --- General Settings ---
    document.getElementById('input-interval').onchange = (e) => {
        const val = Math.max(30, parseInt(e.target.value));
        chrome.storage.local.set({ refreshInterval: val });
        chrome.runtime.sendMessage({ action: 'setRefreshInterval', interval: val });
    };
    document.getElementById('select-notification').onchange = (e) => {
        chrome.storage.local.set({ notificationPreference: e.target.value });
    };
    document.getElementById('select-browser-notify').onchange = (e) => {
        chrome.storage.local.set({ browserNotificationPreference: e.target.value });
    };
    document.getElementById('btn-deleted').onclick = () => {
        settingsPanel.classList.add('hidden');
        deletedPanel.classList.remove('hidden');
        renderDeletedList();
    };
    document.getElementById('btn-close-deleted').onclick = () => {
        deletedPanel.classList.add('hidden');
        settingsPanel.classList.remove('hidden');
    };

    // --- Export / Import ---
    document.getElementById('btn-export').onclick = async () => {
        const keysToExport = [
            'appearance', 'streamerStates', 'deletedStreamers', 
            'refreshInterval', 'notificationPreference', 'browserNotificationPreference'
        ];
        const data = await chrome.storage.local.get(keysToExport);
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
                await chrome.storage.local.set(config);
                location.reload();
            } catch (err) {
                alert('Invalid file');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };
}

function renderDeletedList() {
    const container = document.getElementById('deleted-list');
    if (State.deletedUids.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">List is empty</div>';
        return;
    }
    const listHTML = State.deletedUids.map(uid => {
        const info = State.streamers.find(s => String(s.uid) === String(uid)) || { streamer_name: 'Unknown', streamer_icon: 'images/icon128.png' };
        return `
            <div class="deleted-item">
                <img src="${info.streamer_icon}">
                <span>${info.streamer_name}</span>
                <button class="restore-btn" data-uid="${uid}"><i class="fas fa-undo"></i></button>
            </div>
        `;
    }).join('');
    container.innerHTML = listHTML;

    // Add event listeners
    container.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const uid = parseInt(btn.dataset.uid);
            restoreStreamer(uid);
        });
    });
}

async function restoreStreamer(uid) {
    State.deletedUids = State.deletedUids.filter(id => id !== uid);
    await chrome.storage.local.set({ deletedStreamers: State.deletedUids });
    renderDeletedList();
    renderGrid();
}

function openStream(link) {
    chrome.tabs.create({ url: link });
}

// Background Listener
chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'streamersUpdated') {
        loadData();
    }
});
