// Popup module: hover preview tooltip (thumbnail / live player) and the
// postMessage volume bridge into the bilibili player iframe.

import { fetchRoomInfo, normalizeImageUrl } from '../shared/api.js';
import { t } from '../shared/i18n.js';

const previewTooltip = document.getElementById('preview-tooltip');
const previewImg = document.getElementById('preview-img');
const previewIframe = document.getElementById('preview-iframe');
const previewLoader = document.getElementById('preview-loader');
const previewTitle = document.getElementById('preview-title');
const previewTime = document.getElementById('preview-time');

const HOVER_DELAY_MS = 350;
const LIVE_PLAYER_URL = (roomId) =>
    `https://www.bilibili.com/blackboard/live/live-activity-player.html?cid=${roomId}&muted=1&autoplay=1`;

// Session-scoped room info cache (same lifetime as the old in-memory Map).
const roomCache = new Map();

let hoverTimeout;
let iframeLoadTimeout;
let currentHoverUid = null;

/**
 * Hover entry point, bound per card. `streamer` is the normalized entry the
 * card was rendered from; the preview only triggers for liveStatus === 1.
 */
export function handleHover(e, streamer, state) {
    if (!streamer || Number(streamer.liveStatus) !== 1) return;

    const uid = String(streamer.uid);
    const roomId = streamer.roomId;

    if (currentHoverUid === uid && previewTooltip.classList.contains('visible')) {
        updateTooltipPosition(e.target, state);
        return;
    }

    currentHoverUid = uid;
    updateTooltipPosition(e.target, state);

    clearTimeout(hoverTimeout);
    clearTimeout(iframeLoadTimeout);

    hoverTimeout = setTimeout(async () => {
        if (currentHoverUid !== uid) return;

        previewTooltip.classList.remove('hidden');
        previewTooltip.classList.add('visible');

        // Reset state
        previewImg.classList.add('hidden');
        previewImg.classList.remove('loaded');
        previewImg.src = '';

        // Reset aspect ratio to default 16:9 initially
        const previewWrapper = document.querySelector('.preview-image-wrapper');
        if (previewWrapper) {
            previewWrapper.style.aspectRatio = '16 / 9';
            previewWrapper.style.height = 'auto';
        }

        previewIframe.classList.add('hidden');
        previewIframe.src = '';

        previewLoader.classList.remove('hidden');

        let roomData = roomCache.get(Number(roomId));

        if (!roomData) {
            try {
                roomData = await fetchRoomInfo(roomId);
                roomCache.set(Number(roomId), roomData);
            } catch (err) {
                // audit #14: a failed fetch or code !== 0 used to leave the
                // loader spinning forever; show an error placeholder instead.
                console.error(err);
                if (currentHoverUid !== uid) return;
                previewTitle.textContent = t('previewError');
                previewTime.textContent = '';
                previewLoader.classList.add('hidden');
                return;
            }
        }

        if (currentHoverUid !== uid) return;

        if (state.previewMode === 'live') {
            let liveReady = false;

            // 1. Load the thumbnail first (as placeholder)
            previewImg.classList.remove('hidden');
            previewImg.src = normalizeImageUrl(roomData.keyframe || roomData.user_cover);

            const showThumbnail = () => {
                // Adjust aspect ratio based on the image
                if (previewImg.naturalWidth && previewImg.naturalHeight) {
                    const ratio = previewImg.naturalWidth / previewImg.naturalHeight;
                    const wrapper = document.querySelector('.preview-image-wrapper');
                    if (wrapper) wrapper.style.aspectRatio = `${ratio}`;
                }

                // Only show the thumbnail if the live player hasn't taken over yet
                if (!liveReady) {
                    previewImg.classList.add('loaded');
                    previewLoader.classList.add('hidden');
                }
            };

            previewImg.onload = showThumbnail;
            if (previewImg.complete) showThumbnail();

            // 2. Load the live player
            previewIframe.src = LIVE_PLAYER_URL(roomId);

            previewIframe.onload = () => {
                previewIframe.classList.remove('hidden');

                // Delay hiding the thumbnail and enabling audio to keep
                // sound and picture in sync
                iframeLoadTimeout = setTimeout(() => {
                    liveReady = true;

                    if (previewImg.classList.contains('loaded')) {
                        previewImg.classList.remove('loaded');
                        setTimeout(() => {
                            previewImg.classList.add('hidden');
                        }, 500);
                    } else {
                        previewLoader.classList.add('hidden');
                        previewImg.classList.add('hidden');
                    }

                    updateIframeAudio(state);
                }, 800);
            };
        } else {
            // Thumbnail mode
            previewImg.classList.remove('hidden');
            previewImg.classList.remove('loaded'); // reset opacity
            previewImg.src = normalizeImageUrl(roomData.keyframe || roomData.user_cover);

            const showImg = () => {
                if (previewImg.naturalWidth && previewImg.naturalHeight) {
                    const ratio = previewImg.naturalWidth / previewImg.naturalHeight;
                    const wrapper = document.querySelector('.preview-image-wrapper');
                    if (wrapper) wrapper.style.aspectRatio = `${ratio}`;
                }
                previewImg.classList.add('loaded');
                previewLoader.classList.add('hidden');
            };

            previewImg.onload = showImg;
            if (previewImg.complete) showImg();
        }

        previewTitle.textContent = roomData.title || '';
        if (roomData.live_time) {
            const startTime = new Date(roomData.live_time.replace(' ', 'T'));
            const diff = Date.now() - startTime.getTime();
            const hrs = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            previewTime.textContent = t('liveFor', [String(hrs), String(mins)]);
        } else {
            previewTime.textContent = '';
        }
    }, HOVER_DELAY_MS);
}

export function handleLeave() {
    currentHoverUid = null;
    clearTimeout(hoverTimeout);
    clearTimeout(iframeLoadTimeout);
    previewTooltip.classList.remove('visible');
    setTimeout(() => {
        if (!currentHoverUid) {
            previewTooltip.classList.add('hidden');
            previewImg.src = '';
            previewIframe.src = '';
        }
    }, 200);
}

function updateTooltipPosition(targetEl, state) {
    const rect = targetEl.getBoundingClientRect();
    const tooltipWidth = 260;
    const gap = 10;
    const infoHeight = 60; // approximate height of the preview-info section
    const defaultImageHeight = Math.round(tooltipWidth * 9 / 16); // 16:9 -> 146px
    const minImageHeight = 80; // minimum usable image height
    const padding = 0; // safety padding from window edges

    // Available space below and above the target
    const spaceBelow = window.innerHeight - rect.bottom - gap - padding;
    const spaceAbove = rect.top - gap - padding;

    const defaultTooltipHeight = defaultImageHeight + infoHeight;

    // Prefer below, unless there is not enough space and more space above
    const showAbove = spaceBelow < defaultTooltipHeight && spaceAbove > spaceBelow;
    const availableHeight = showAbove ? spaceAbove : spaceBelow;

    const imageHeight = Math.max(minImageHeight, Math.min(defaultImageHeight, availableHeight - infoHeight));
    const actualTooltipHeight = imageHeight + infoHeight;

    let top;
    if (showAbove) {
        top = rect.top - gap - actualTooltipHeight;
        top = Math.max(padding, top);
    } else {
        top = rect.bottom + gap;
    }

    const previewWrapper = document.querySelector('.preview-image-wrapper');
    if (previewWrapper) {
        previewWrapper.style.maxHeight = `${imageHeight}px`;
    }

    // Horizontal positioning
    let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
    if (left < 10) left = 10;
    const appWidth = state.appearance.width;
    if (left + tooltipWidth > appWidth - 10) left = appWidth - tooltipWidth - 10;

    previewTooltip.style.top = `${top}px`;
    previewTooltip.style.left = `${left}px`;
}

/**
 * Volume bridge into the player iframe. The protocol is owned by
 * content_script.js and must stay exactly: { type: 'BSM_UPDATE_VOLUME', muted, volume }.
 */
export function updateIframeAudio(state) {
    if (previewIframe && !previewIframe.classList.contains('hidden') && previewIframe.src) {
        // Targeted at the iframe's own origin (LIVE_PLAYER_URL), not '*': a
        // wildcard target would still hand the message to whatever page the
        // iframe happens to be navigated to. content_script.js independently
        // checks event.origin against this extension's own origin (the
        // origin this message is actually sent FROM) before acting on it.
        previewIframe.contentWindow.postMessage({
            type: 'BSM_UPDATE_VOLUME',
            muted: !state.previewSound,
            volume: state.previewVolume / 100
        }, 'https://www.bilibili.com');
    }
}
