// Background module: browser notifications (create, click-to-room mapping, id-stable dedupe).

import { NOTIF_ID_PREFIX, NOTIF_OVERFLOW_ID, NOTIF_BATCH_LIMIT } from '../shared/constants.js';
import { getState, setState } from '../shared/storage.js';

const FALLBACK_ICON = 'images/icon128.png';
const LIVE_BASE_URL = 'https://live.bilibili.com/';
// Where the collapsed "N more" notification points: the page that actually
// lists everyone it stands for.
const FOLLOW_LIVE_URL = 'https://link.bilibili.com/p/center/index#/user-center/follow/1';

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

/** Sort weight: favorites first, then likes, then by medal level. */
function notifyWeight(streamer, streamerStates) {
    const mark = streamerStates[streamer.uid];
    let weight = 0;
    if (mark === 'favorite') weight += 2000;
    else if (mark === 'like') weight += 1000;
    return weight + (Number(streamer.medalLevel) || 0);
}

/**
 * Send one notification per newly live streamer, capped at NOTIF_BATCH_LIMIT
 * with the remainder collapsed into a single summary.
 *
 * The caller passes streamers already filtered to the notify channel's scope
 * (background/poller.js runs both channel filters off one diff).
 *
 * @param {Array} streamers newly live streamers (merged shape, live and not hidden)
 * @param {Object} streamerStates {uid: 'favorite'|'like'} marks, used for ordering
 */
export async function sendLiveNotifications(streamers, streamerStates = {}) {
    if (!streamers || streamers.length === 0) return;

    // Order before capping. Without this an unmarked streamer can take one of
    // the individual slots while a favorite is collapsed into the summary —
    // the cap would then change WHICH alerts you get, not just how many.
    const ordered = [...streamers].sort(
        (a, b) => notifyWeight(b, streamerStates) - notifyWeight(a, streamerStates)
    );
    const individual = ordered.slice(0, NOTIF_BATCH_LIMIT);
    const overflow = ordered.slice(NOTIF_BATCH_LIMIT);

    const { notifRoomMap } = await getState(['notifRoomMap']);
    const roomMap = { ...notifRoomMap };
    let mapChanged = false;

    for (const streamer of individual) {
        const uid = Number(streamer.uid);

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

    if (overflow.length > 0) {
        const count = String(overflow.length);
        // Fixed id, so a later overflow replaces this one rather than stacking.
        // No notifRoomMap entry: it stands for many rooms, and the click
        // handler routes it to the followed-live page instead.
        chrome.notifications.create(NOTIF_OVERFLOW_ID, {
            type: 'basic',
            iconUrl: FALLBACK_ICON,
            title: chrome.i18n.getMessage('notificationMore', count)
                || `${count} more streamers went live`,
            message: overflow.map(s => s.uname).filter(Boolean).join('、'),
            priority: 1
        });
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
            if (notifId === NOTIF_OVERFLOW_ID) {
                await chrome.tabs.create({ url: FOLLOW_LIVE_URL });
                return;
            }

            const { notifRoomMap } = await getState(['notifRoomMap']);
            const roomId = notifRoomMap[notifId];
            await chrome.tabs.create({ url: roomId ? LIVE_BASE_URL + roomId : LIVE_BASE_URL });

            // Legacy behavior: clicking clears the streamer's highlight mark.
            // The isFinite guard keeps a non-uid id from ever reaching the
            // filter — clearing the whole badge from one click would be silent.
            if (notifId.startsWith(NOTIF_ID_PREFIX)) {
                const uid = Number(notifId.slice(NOTIF_ID_PREFIX.length));
                if (!Number.isFinite(uid)) return;
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
