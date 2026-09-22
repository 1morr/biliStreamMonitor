// Popup module: hover preview tooltip (thumbnail / live player) and the
// postMessage volume bridge into the bilibili player iframe.

import { fetchRoomInfo, normalizeImageUrl } from '../shared/api.js';
import { t } from '../shared/i18n.js';
import { PLAYER_ORIGIN, livePlayerUrl, volumeCommand } from './preview-protocol.js';

const previewTooltip = document.getElementById('preview-tooltip');
const previewImg = document.getElementById('preview-img');
const previewIframe = document.getElementById('preview-iframe');
const previewLoader = document.getElementById('preview-loader');
const previewTitle = document.getElementById('preview-title');
const previewTime = document.getElementById('preview-time');

const HOVER_DELAY_MS = 350;

// The player ignores volume commands until it has built its own <video>, which
// lands roughly a second after the iframe's load event and moves with the
// network. It acknowledges nothing, and the frame is cross-origin to the popup,
// so the applied value cannot be read back either. The command is therefore
// re-asserted over a bounded window instead of being fired once at a guessed
// moment -- firing once was what made the configured volume arrive late.
const VOLUME_SYNC_INTERVAL_MS = 250;
const VOLUME_SYNC_ATTEMPTS = 24; // ~6s, comfortably past a slow player start

// Session-scoped room info cache (same lifetime as the old in-memory Map).
const roomCache = new Map();

let hoverTimeout;
let iframeLoadTimeout;
let thumbFadeTimeout;
let volumeSyncTimer = null;
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
        unmountPlayer();

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

            // 2. Load the live player. It opens silent (mute=1) whatever the
            //    volume the player remembers, so the level can be applied on
            //    its own schedule instead of racing the first frame of audio.
            previewIframe.src = livePlayerUrl(roomId);
            if (state.previewSound) startVolumeSync(state);

            previewIframe.onload = () => {
                previewIframe.classList.remove('hidden');

                // Hold the thumbnail over the player for a moment; the player
                // shows its own black frame before the stream arrives.
                iframeLoadTimeout = setTimeout(() => {
                    liveReady = true;

                    if (previewImg.classList.contains('loaded')) {
                        previewImg.classList.remove('loaded');
                        thumbFadeTimeout = setTimeout(() => {
                            previewImg.classList.add('hidden');
                        }, 500);
                    } else {
                        previewLoader.classList.add('hidden');
                        previewImg.classList.add('hidden');
                    }
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
    clearTimeout(thumbFadeTimeout);
    stopVolumeSync();
    previewTooltip.classList.remove('visible');
    setTimeout(() => {
        if (!currentHoverUid) {
            previewTooltip.classList.add('hidden');
            previewImg.src = '';
            unmountPlayer();
        }
    }, 200);
}

/**
 * Tear the player down.
 *
 * `removeAttribute` rather than `src = ''`: an empty src attribute still
 * reflects back through the `src` property as the document's base URL, which
 * would leave every `previewIframe.src` guard permanently true. Clearing the
 * src also fires `load` one more time, so the handler is dropped first --
 * otherwise the previous hover's closure runs the thumbnail swap again against
 * a blank frame.
 */
function unmountPlayer() {
    stopVolumeSync();
    previewIframe.onload = null;
    previewIframe.removeAttribute('src');
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
 * Push the current volume into the player, through the player's own documented
 * control channel (see popup/preview-protocol.js). Safe to call at any time:
 * with no player mounted it does nothing.
 *
 * Targeted at the player's origin rather than '*', so the command cannot follow
 * the frame if it is ever navigated somewhere else.
 */
export function updateIframeAudio(state) {
    if (!previewIframe || !previewIframe.getAttribute('src')) return;
    previewIframe.contentWindow.postMessage(volumeCommand(state), PLAYER_ORIGIN);
}

/** Re-assert the volume until the player is far enough along to accept it. */
function startVolumeSync(state) {
    stopVolumeSync();
    let attemptsLeft = VOLUME_SYNC_ATTEMPTS;
    volumeSyncTimer = setInterval(() => {
        updateIframeAudio(state);
        if (--attemptsLeft <= 0) stopVolumeSync();
    }, VOLUME_SYNC_INTERVAL_MS);
}

function stopVolumeSync() {
    clearInterval(volumeSyncTimer);
    volumeSyncTimer = null;
}
