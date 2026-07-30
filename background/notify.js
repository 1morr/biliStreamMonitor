// Background module: browser notifications (create, click-to-room mapping, id-stable dedupe).

import { NOTIF_ID_PREFIX, NotifyPref } from '../shared/constants.js';
import { getState, setState } from '../shared/storage.js';

const FALLBACK_ICON = 'images/icon128.png';
const LIVE_BASE_URL = 'https://live.bilibili.com/';

/** Download an image and convert it to a Data URL; null on failure (caller falls back). */
async function fetchImageAsDataURL(url) {
    try {
        if (url.startsWith('http:')) url = url.replace('http:', 'https:');
        const response = await fetch(url, { credentials: 'include', referrerPolicy: 'no-referrer' });
        if (!response.ok) throw new Error(`Image fetch failed: ${response.status}`);
        const blob = await response.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Failed to fetch image as Data URL:', e);
        return null;
    }
}

/**
 * Send one notification per newly live streamer that matches the browser
 * notification preference.
 * @param {Array} streamers newly live streamers (merged shape, already live and not hidden)
 * @param {string} browserPref NotifyPref code for browser notifications
 * @param {Object} streamerStates {uid: 'favorite'|'like'} marks
 */
export async function sendLiveNotifications(streamers, browserPref, streamerStates) {
    if (browserPref === NotifyPref.OFF || !streamers || streamers.length === 0) return;

    const { notifRoomMap } = await getState(['notifRoomMap']);
    const roomMap = { ...notifRoomMap };
    let mapChanged = false;

    for (const streamer of streamers) {
        const uid = Number(streamer.uid);
        const mark = streamerStates[uid];
        const shouldNotify = browserPref === NotifyPref.ALL
            || (browserPref === NotifyPref.FAVORITES && mark === 'favorite')
            || (browserPref === NotifyPref.LIKED_AND_FAVORITES && (mark === 'favorite' || mark === 'like'));
        if (!shouldNotify) continue;

        // Stable id (audit #15): re-notifying the same uid replaces the previous
        // notification instead of stacking duplicates.
        const notifId = NOTIF_ID_PREFIX + uid;

        let iconUrl = FALLBACK_ICON;
        const dataUrl = await fetchImageAsDataURL(streamer.face);
        if (dataUrl) iconUrl = dataUrl;

        // Title comes from the merged list directly; no extra get_info call.
        const title = chrome.i18n.getMessage('notificationTitle', streamer.uname)
            || `${streamer.uname} is now live!`;

        chrome.notifications.create(notifId, {
            type: 'basic',
            iconUrl,
            title,
            message: streamer.title || streamer.area || '',
            priority: 2
        });

        if (streamer.roomId) {
            roomMap[notifId] = streamer.roomId;
            mapChanged = true;
        }
    }

    if (mapChanged) await setState({ notifRoomMap: roomMap });
}

/** Drop notifRoomMap entries whose uid is no longer live (called after a successful cycle). */
export async function pruneNotifRoomMap(liveUids) {
    const { notifRoomMap } = await getState(['notifRoomMap']);
    const pruned = {};
    let changed = false;
    for (const [notifId, roomId] of Object.entries(notifRoomMap)) {
        const uid = Number(notifId.slice(NOTIF_ID_PREFIX.length));
        if (liveUids.has(uid)) {
            pruned[notifId] = roomId;
        } else {
            changed = true;
        }
    }
    if (changed) await setState({ notifRoomMap: pruned });
}

/** Register the notification click handler (audit #3: click must always do something). */
export function registerNotificationHandlers() {
    chrome.notifications.onClicked.addListener(async (notifId) => {
        try {
            const { notifRoomMap } = await getState(['notifRoomMap']);
            const roomId = notifRoomMap[notifId];
            await chrome.tabs.create({ url: roomId ? LIVE_BASE_URL + roomId : LIVE_BASE_URL });

            // Legacy behavior: clicking clears the streamer's highlight mark
            if (notifId.startsWith(NOTIF_ID_PREFIX)) {
                const uid = Number(notifId.slice(NOTIF_ID_PREFIX.length));
                const { newlyStreaming } = await getState(['newlyStreaming']);
                const kept = (newlyStreaming || []).filter(u => Number(u) !== uid);
                if (kept.length !== (newlyStreaming || []).length) {
                    await setState({ newlyStreaming: kept });
                }
            }
        } catch (e) {
            console.error('Notification click handling failed:', e);
        } finally {
            chrome.notifications.clear(notifId);
        }
    });
}
