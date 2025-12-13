// popup.js

const State = {
    streamers: [],
    deletedUids: [],
    states: {}, // {uid: 'favorite' | 'like'}
    newlyStreaming: [],
    refreshInterval: 60,
    notificationPref: '2',
    browserNotify: true,
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
    
    // Clear new streamer highlight when popup opens
    if (State.newlyStreaming.length > 0) {
        chrome.storage.local.set({ newlyStreaming: [] });
        chrome.action.setBadgeText({ text: '' });
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
            'notificationPreference', 'browserNotificationsEnabled'
        ]);

        State.streamers = storage.streamingInfo || [];
        State.deletedUids = storage.deletedStreamers || [];
        State.states = storage.streamerStates || {};
        State.newlyStreaming = storage.newlyStreaming || [];
        State.refreshInterval = storage.refreshInterval || 60;
        State.notificationPref = storage.notificationPreference || '2';
        State.browserNotify = storage.browserNotificationsEnabled !== false;

        renderGrid();
        updateSettingsUI();

    } catch (e) {
        console.error(e);
        gridContainer.innerHTML = `<div class="loading-state"><p>${e.message}</p></div>`;
    }
}

// --- Rendering (核心修复：重写排序逻辑) ---
function renderGrid() {
    // 过滤掉被隐藏的主播
    const visibleStreamers = State.streamers.filter(s => !State.deletedUids.includes(s.uid));

    if (visibleStreamers.length === 0) {
        gridContainer.innerHTML = `
            <div class="loading-state">
                <i class="fab fa-bilibili" style="font-size: 32px; margin-bottom: 10px; opacity:0.5;"></i>
                <p>No streamers found.</p>
            </div>`;
        return;
    }

    // 修复：使用权重积分制进行排序，确保 直播 > 关注 > 等级
    visibleStreamers.sort((a, b) => {
        const getWeight = (s) => {
            let weight = 0;
            // 确保 live_status 是数字类型 (1=直播, 0=闲置)
            const status = Number(s.live_status);
            
            // 1. 直播状态 (最高优先级 - 权重 10,000,000)
            if (status === 1) weight += 10000000;
            
            // 2. 关注状态 (次级优先级 - 权重 100,000 ~ 200,000)
            const state = State.states[s.uid];
            if (state === 'favorite') weight += 200000;
            else if (state === 'like') weight += 100000;
            
            // 3. 勋章等级 (微调 - 权重 1 ~ 100)
            weight += (Number(s.medal_level) || 0);
            
            return weight;
        };

        // 降序排列 (高权重在前)
        return getWeight(b) - getWeight(a);
    });

    gridContainer.innerHTML = visibleStreamers.map(s => createCardHTML(s)).join('');
    
    // Add event listeners
    document.querySelectorAll('.streamer-card').forEach(card => {
        card.addEventListener('click', () => openStream(card.dataset.link));
        card.addEventListener('contextmenu', (e) => showContextMenu(e, card.dataset.uid));
        card.addEventListener('mouseenter', (e) => handleHover(e, card.dataset.uid, card.dataset.roomid));
        card.addEventListener('mouseleave', handleLeave);
    });
}

function createCardHTML(s) {
    // 强制类型转换为数字进行判断
    const isLive = Number(s.live_status) === 1;
    const isNew = State.newlyStreaming.includes(s.uid);
    const state = State.states[s.uid];
    
    let badges = '';
    if (state === 'favorite') badges = `<div class="badge-icon fav"><i class="fas fa-heart"></i></div>`;
    else if (state === 'like') badges = `<div class="badge-icon like"><i class="fas fa-star"></i></div>`;

    return `
        <div class="streamer-card ${!isLive ? 'offline' : ''}" 
             data-uid="${s.uid}" 
             data-link="${s.link}"
             data-roomid="${s.roomId}">
            
            ${badges ? `<div class="card-badges">${badges}</div>` : ''}
            
            <div class="avatar-wrapper">
                <img src="${s.streamer_icon}" loading="lazy" alt="${s.streamer_name}">
                ${isLive ? `<div class="status-dot live ${isNew ? 'new-live' : ''}"></div>` : ''}
            </div>
            
            <div class="streamer-name">${s.streamer_name}</div>
            <div class="medal-info">${s.medal_name} · Lv.${s.medal_level}</div>
        </div>
    `;
}

// --- Tooltip & Preview Logic ---
let hoverTimeout;
let currentHoverUid = null;

async function handleHover(e, uid, roomId) {
    const streamer = State.streamers.find(s => String(s.uid) === String(uid));
    
    // 只有直播中的才显示预览
    if (!streamer || Number(streamer.live_status) !== 1) return;

    currentHoverUid = uid;
    updateTooltipPosition(e.target);

    // Clear previous timeout
    clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(async () => {
        if (currentHoverUid !== uid) return;
        
        // Show tooltip, reset states
        previewTooltip.classList.remove('hidden');
        previewTooltip.classList.add('visible');
        
        // Reset Loader & Image
        previewImg.classList.remove('loaded');
        previewLoader.classList.remove('hidden'); 
        previewImg.src = ''; 
        
        // Check cache
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
    if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;
    
    // Flip if close to bottom
    if (top + tooltipHeight > window.innerHeight) {
        top = rect.top - tooltipHeight - gap;
    }

    previewTooltip.style.top = `${top}px`;
    previewTooltip.style.left = `${left}px`;
}

// --- Context Menu ---
let contextTargetUid = null;

function showContextMenu(e, uid) {
    e.preventDefault();
    contextTargetUid = uid;
    
    let x = e.clientX;
    let y = e.clientY;
    
    if (x + 130 > window.innerWidth) x = window.innerWidth - 140;
    if (y + 100 > window.innerHeight) y = window.innerHeight - 100;
    
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
        await chrome.storage.local.set({ 
            deletedStreamers: State.deletedUids,
            streamerStates: State.states 
        });
    } else {
        if (State.states[uid] === action) {
            delete State.states[uid];
        } else {
            State.states[uid] = action;
        }
        await chrome.storage.local.set({ streamerStates: State.states });
    }

    renderGrid();
    chrome.runtime.sendMessage({ action: 'updateStreamers' });
});

// --- Settings Logic ---
function updateSettingsUI() {
    document.getElementById('input-interval').value = State.refreshInterval;
    document.getElementById('select-notification').value = State.notificationPref;
    document.getElementById('check-browser-notify').checked = State.browserNotify;
}

function setupEventListeners() {
    document.getElementById('fab-settings').onclick = () => settingsPanel.classList.remove('hidden');
    document.getElementById('btn-close-settings').onclick = () => settingsPanel.classList.add('hidden');

    document.getElementById('btn-manual-refresh').onclick = async () => {
        const btn = document.getElementById('btn-manual-refresh');
        const originalText = btn.innerHTML;
        
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        btn.disabled = true;

        await chrome.runtime.sendMessage({ action: 'updateStreamers' });
        await loadData();
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 800);
    };

    document.getElementById('input-interval').onchange = (e) => {
        const val = Math.max(30, parseInt(e.target.value));
        chrome.storage.local.set({ refreshInterval: val });
        chrome.runtime.sendMessage({ action: 'setRefreshInterval', interval: val });
    };

    document.getElementById('select-notification').onchange = (e) => {
        chrome.storage.local.set({ notificationPreference: e.target.value });
    };

    document.getElementById('check-browser-notify').onchange = (e) => {
        chrome.storage.local.set({ browserNotificationsEnabled: e.target.checked });
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

    document.getElementById('btn-export').onclick = async () => {
        const data = await chrome.storage.local.get(null);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bili-config-${new Date().toISOString().slice(0,10)}.json`;
        a.click();
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
    };
}

function renderDeletedList() {
    const container = document.getElementById('deleted-list');
    if (State.deletedUids.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">List is empty</div>';
        return;
    }
    
    const listHTML = State.deletedUids.map(uid => {
        const info = State.streamers.find(s => s.uid === uid) || { streamer_name: 'Unknown', streamer_icon: 'images/icon128.png' };
        return `
            <div class="deleted-item">
                <img src="${info.streamer_icon}">
                <span>${info.streamer_name}</span>
                <button class="restore-btn" onclick="restoreStreamer(${uid})"><i class="fas fa-undo"></i></button>
            </div>
        `;
    }).join('');
    
    container.innerHTML = listHTML;
}

window.restoreStreamer = async (uid) => {
    State.deletedUids = State.deletedUids.filter(id => id !== uid);
    await chrome.storage.local.set({ deletedStreamers: State.deletedUids });
    renderDeletedList();
    renderGrid();
};

function openStream(link) {
    chrome.tabs.create({ url: link });
}

// Background Listener
chrome.runtime.onMessage.addListener((req) => {
    if (req.action === 'streamersUpdated') {
        loadData();
    }
});