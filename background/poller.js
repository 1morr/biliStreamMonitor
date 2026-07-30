// Background module: refresh cycle core (fetch, merge, diff, badge, notify, persist).

import {
    MonitorMode,
    NotifyPref,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS
} from '../shared/constants.js';
import {
    BiliApiError,
    fetchFollowingLive,
    fetchMedalWall,
    fetchRoomStatusByUids,
    getTargetUid
} from '../shared/api.js';
import { migrateIfNeeded, getState, setState } from '../shared/storage.js';
import { mergeStreamers } from '../shared/merge.js';
import { sendLiveNotifications, pruneNotifRoomMap } from './notify.js';

// Module-level guards. Both are lost on SW restart; that is acceptable because
// backoffUntil itself is persisted, so the actual pause survives restarts.
let cycleInFlight = false;       // re-entrancy guard (audit #1: concurrent cycles double-notify)
let consecutiveRiskErrors = 0;   // risk-control backoff exponent, reset on success

/** Update the badge counter. Color priority: favorite (red) > like (orange) > normal (blue). */
async function updateBadge(count, colorType = 'normal') {
    if (count > 0) {
        const color = colorType === 'favorite' ? '#FF3B30' : (colorType === 'like' ? '#FF9500' : '#007AFF');
        await chrome.action.setBadgeText({ text: String(count) });
        await chrome.action.setBadgeBackgroundColor({ color });
    } else {
        await chrome.action.setBadgeText({ text: '' });
    }
}

/** Error state must be visible on the badge (audit #1: silent auth expiry). */
async function showErrorBadge() {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF3B30' });
}

/** Map an error to the persisted lastError category. */
function classifyError(error) {
    if (error instanceof BiliApiError) {
        if (error.isAuth) return 'auth';
        if (error.isRiskControl) return 'risk';
    }
    return 'network';
}

/**
 * Run one refresh cycle. Re-entrant triggers while a cycle is in flight are
 * rejected; triggers inside a risk-control backoff window are skipped
 * (manual refreshes included).
 * @param {'alarm'|'manual'|'message'} trigger what started this cycle
 * @returns {Promise<{ok: true, liveCount: number}|{ok: false, reason: string}>}
 */
export async function runUpdateCycle(trigger) {
    if (cycleInFlight) {
        console.debug('Update cycle already in flight, skipping trigger:', trigger);
        return { ok: false, reason: 'busy' };
    }
    cycleInFlight = true;
    try {
        await migrateIfNeeded(); // idempotent and cheap

        const state = await getState([
            'monitorMode',
            'customStreamers',
            'deletedStreamers',
            'streamerStates',
            'previousLiveUids',
            'newlyStreaming',
            'notificationPreference',
            'browserNotificationPreference',
            'refreshInterval',
            'backoffUntil'
        ]);

        // Backoff gate: skip the whole cycle while the penalty window is open
        if (Date.now() < (state.backoffUntil || 0)) {
            return { ok: false, reason: 'backoff' };
        }

        // Mode dispatch -> mode streamer list (normalized Streamer shape)
        let modeStreamers;
        if (state.monitorMode === MonitorMode.MEDAL) {
            const uid = await getTargetUid();
            if (uid == null) throw new BiliApiError('Not logged in', { isAuth: true });
            modeStreamers = await fetchMedalWall(uid);
        } else {
            const { live, liveCount, truncated } = await fetchFollowingLive();
            if (truncated) {
                console.warn(`Following list truncated: collected ${live.length} of ~${liveCount} live entries`);
            }
            modeStreamers = live;
        }

        // Batch-refresh custom rooms not covered by the mode list (String compare).
        // On batch failure the previous custom states are kept (legacy behavior)
        // without aborting the rest of the cycle.
        const customStreamers = state.customStreamers;
        const coveredUids = new Set(modeStreamers.map(s => String(s.uid)));
        const pendingUids = customStreamers
            .map(c => Number(c.uid))
            .filter(uid => Number.isFinite(uid) && !coveredUids.has(String(uid)));
        if (pendingUids.length > 0) {
            try {
                const statusMap = await fetchRoomStatusByUids(pendingUids);
                for (const entry of customStreamers) {
                    const uid = Number(entry.uid);
                    if (!Number.isFinite(uid) || coveredUids.has(String(uid))) continue;
                    const info = statusMap.get(uid);
                    if (info) {
                        // In-place update to the new-shape fields, preserve the rest
                        entry.roomId = info.roomId;
                        entry.uname = info.uname;
                        entry.face = info.face;
                        entry.title = info.title;
                        entry.cover = info.cover;
                        entry.area = info.area;
                        entry.liveStatus = info.liveStatus;
                    } else {
                        entry.liveStatus = 0; // missing key = uid has no room
                    }
                }
            } catch (e) {
                console.warn('Custom room batch refresh failed, keeping previous states:', e);
            }
        }

        // Single merge source of truth (audit #8)
        const merged = mergeStreamers(modeStreamers, customStreamers);

        // Only liveStatus === 1 counts (2 = replay/round-robin, always excluded).
        // Hidden (deleted) streamers are excluded with Number uid compare (type-safe).
        const deletedUids = new Set((state.deletedStreamers || []).map(Number));
        const currentLiveStreamers = merged.filter(s => s.liveStatus === 1 && !deletedUids.has(Number(s.uid)));
        const currentLiveUids = currentLiveStreamers.map(s => Number(s.uid));
        const liveByUid = new Map(currentLiveStreamers.map(s => [Number(s.uid), s]));

        // Diff against the previous cycle
        const prevSet = new Set((state.previousLiveUids || []).map(Number));
        const justStartedUids = currentLiveUids.filter(uid => !prevSet.has(uid));

        // Highlight list: drop streamers that went offline, add the newly live
        let newlyStreaming = (state.newlyStreaming || [])
            .map(Number)
            .filter(uid => currentLiveUids.includes(uid));
        for (const uid of justStartedUids) {
            if (!newlyStreaming.includes(uid)) newlyStreaming.push(uid);
        }

        // Badge counts only newly-live streamers, filtered by the badge preference
        const streamerStates = state.streamerStates;
        const badgePref = state.notificationPreference;
        const badgeUids = newlyStreaming.filter(uid => {
            if (!liveByUid.has(uid)) return false;
            const mark = streamerStates[uid];
            if (badgePref === NotifyPref.OFF) return false;
            if (badgePref === NotifyPref.FAVORITES) return mark === 'favorite';
            if (badgePref === NotifyPref.LIKED_AND_FAVORITES) return mark === 'favorite' || mark === 'like';
            return true; // NotifyPref.ALL
        });
        let badgeColorType = 'normal';
        if (badgeUids.some(uid => streamerStates[uid] === 'favorite')) badgeColorType = 'favorite';
        else if (badgeUids.some(uid => streamerStates[uid] === 'like')) badgeColorType = 'like';
        await updateBadge(badgeUids.length, badgeColorType);

        // Browser notifications for newly live streamers (preference filter inside)
        if (justStartedUids.length > 0) {
            const justStarted = justStartedUids.map(uid => liveByUid.get(uid)).filter(Boolean);
            await sendLiveNotifications(justStarted, state.browserNotificationPreference, streamerStates);
        }

        // Persist only on success: a failed cycle must never overwrite the
        // previous state and report everyone as offline (kept legacy design).
        await setState({
            streamingInfo: modeStreamers,
            customStreamers,
            previousLiveUids: currentLiveUids,
            newlyStreaming,
            lastError: null
        });
        consecutiveRiskErrors = 0;

        await pruneNotifRoomMap(new Set(currentLiveUids));

        chrome.runtime.sendMessage({ type: 'streamersUpdated' }).catch(() => {});
        return { ok: true, liveCount: currentLiveUids.length };
    } catch (error) {
        const lastError = classifyError(error);
        const update = { lastError };
        if (error instanceof BiliApiError && error.isRiskControl) {
            consecutiveRiskErrors += 1;
            // Exponential backoff: 5 -> 10 -> 20 -> 30 (cap) minutes
            update.backoffUntil = Date.now()
                + Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveRiskErrors - 1), BACKOFF_MAX_MS);
        }
        console.error(`Update cycle failed (${lastError}):`, error);
        try {
            await setState(update);
            await showErrorBadge();
        } catch (e) {
            console.error('Failed to persist error state:', e);
        }
        chrome.runtime.sendMessage({ type: 'showError', error: lastError }).catch(() => {});
        return { ok: false, reason: lastError };
    } finally {
        cycleInFlight = false;
    }
}
