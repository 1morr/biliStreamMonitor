// Popup module: streamer card grid rendering and the card context menu.

import { escapeHtml, t } from '../shared/i18n.js';
import { mergeStreamers } from '../shared/merge.js';
import { setState } from '../shared/storage.js';
import { handleHover, handleLeave } from './preview.js';

const gridContainer = document.getElementById('grid-container');
const contextMenu = document.getElementById('context-menu');

// Context menu target, set on right-click and consumed by the menu click handler.
let contextTargetUid = null;

/**
 * Single merged render source (audit #8: the old popup duplicated the
 * medal-wall + custom merge logic in three places).
 * Hidden uids are filtered with a Number compare (deletedStreamers is
 * normalized to Numbers by shared/storage).
 */
function getVisibleStreamers(state) {
    const merged = mergeStreamers(state.streamers, state.customStreamers);
    const deletedUids = new Set((state.deletedUids || []).map(Number));
    return merged.filter(s => !deletedUids.has(Number(s.uid)));
}

function getWeight(s, state) {
    let weight = 0;
    if (Number(s.liveStatus) === 1) weight += 10000000; // live first
    const mark = state.states[s.uid];
    if (mark === 'favorite') weight += 200000;
    else if (mark === 'like') weight += 100000;
    weight += (Number(s.medalLevel) || 0);
    return weight;
}

function createCardHTML(s, state) {
    const isLive = Number(s.liveStatus) === 1;
    const mark = state.states[s.uid];
    const isNewLive = isLive && state.newlyStreaming.some(uid => String(uid) === String(s.uid));
    const link = `https://live.bilibili.com/${s.roomId}`;

    let badgeHTML = '';
    if (mark === 'favorite') {
        badgeHTML = '<div class="avatar-badge fav"><i class="fas fa-heart"></i></div>';
    } else if (mark === 'like') {
        badgeHTML = '<div class="avatar-badge like"><i class="fas fa-star"></i></div>';
    }

    // Every interpolated value is escaped (audit #12); the avatar opts out of
    // the Referer header to match the background side (audit #10).
    const medalText = s.medalName ? t('medalLevel', [s.medalName, String(s.medalLevel ?? '')]) : '';

    return `
        <div class="streamer-card ${!isLive ? 'offline' : ''} ${isNewLive ? 'new-live' : ''}"
             data-uid="${escapeHtml(s.uid)}"
             data-link="${escapeHtml(link)}"
             data-roomid="${escapeHtml(s.roomId)}">

            <div class="avatar-wrapper">
                <img src="${escapeHtml(s.face)}" loading="lazy" referrerpolicy="no-referrer" alt="${escapeHtml(s.uname)}">
                ${badgeHTML}
                ${isLive ? '<div class="live-dot"></div>' : ''}
            </div>

            <div class="streamer-name">${escapeHtml(s.uname)}</div>
            <div class="medal-info">${escapeHtml(medalText)}</div>
        </div>
    `;
}

/** Full grid render: merge -> filter hidden -> sort -> paint -> bind events. */
export function renderGrid(state) {
    const visibleStreamers = getVisibleStreamers(state);

    if (visibleStreamers.length === 0) {
        gridContainer.innerHTML = `
            <div class="loading-state">
                <i class="fab fa-bilibili" style="font-size: 32px; margin-bottom: 10px; opacity:0.5;"></i>
                <p>${escapeHtml(t('noStreamers'))}</p>
            </div>`;
        return;
    }

    visibleStreamers.sort((a, b) => getWeight(b, state) - getWeight(a, state));

    gridContainer.innerHTML = visibleStreamers.map(s => createCardHTML(s, state)).join('');

    gridContainer.querySelectorAll('.streamer-card').forEach(card => {
        const uid = card.dataset.uid;
        const streamer = visibleStreamers.find(s => String(s.uid) === String(uid));
        card.addEventListener('click', () => openStream(card.dataset.link, true));
        card.addEventListener('mousedown', (e) => {
            if (e.button === 1) e.preventDefault();
        });
        card.addEventListener('mouseup', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                openStream(card.dataset.link, false);
            }
        });
        card.addEventListener('contextmenu', (e) => showContextMenu(e, uid, state));
        card.addEventListener('mouseenter', (e) => handleHover(e, streamer, state));
        card.addEventListener('mouseleave', handleLeave);
    });
}

function openStream(link, active = true) {
    chrome.tabs.create({ url: link, active });
}

// --- Context menu ---

function showContextMenu(e, uid, state) {
    e.preventDefault();
    contextTargetUid = uid;

    contextMenu.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
    const mark = state.states[uid];
    if (mark === 'favorite' || mark === 'like') {
        const activeItem = contextMenu.querySelector(`.menu-item[data-action="${mark}"]`);
        if (activeItem) activeItem.classList.add('active');
    }

    let x = e.clientX;
    let y = e.clientY;
    const menuWidth = 140;
    if (x + menuWidth > state.appearance.width) x = state.appearance.width - menuWidth - 10;

    contextMenu.style.left = `${x}px`;
    contextMenu.style.top = `${y}px`;
    contextMenu.classList.remove('hidden');

    const closeMenu = () => {
        contextMenu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
}

/**
 * Bind the context menu click handler once. favorite/like toggle the mark,
 * hide moves the uid into deletedStreamers; every action re-renders and asks
 * the background to refresh (batched now, so the extra cycle is cheap).
 */
export function initContextMenu(state) {
    contextMenu.addEventListener('click', async (e) => {
        const action = e.target.closest('.menu-item')?.dataset.action;
        if (!action || !contextTargetUid) return;

        const uid = contextTargetUid;

        if (action === 'hide') {
            state.deletedUids.push(Number(uid));
            delete state.states[uid];
            await setState({ deletedStreamers: state.deletedUids, streamerStates: state.states });
        } else {
            if (state.states[uid] === action) delete state.states[uid];
            else state.states[uid] = action;
            await setState({ streamerStates: state.states });
        }

        renderGrid(state);
        chrome.runtime.sendMessage({ type: 'updateStreamers' }).catch(() => {});
    });
}
