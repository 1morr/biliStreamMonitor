// Background module: refresh cycle core (fetch, merge, seed/diff, badge, notify, persist).

import {
    AlertChannel,
    BADGE_MAX,
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
import { mergeStreamers, normalizeStreamer } from '../shared/merge.js';
import { inChannel, needsFollowing, scopeSignature, watchedUids } from '../shared/scope.js';
import { sendLiveNotifications, pruneNotifRoomMap } from './notify.js';

// Module-level guards. Both are lost on SW restart; that is acceptable because
// backoffUntil itself is persisted, so the actual pause survives restarts.
let cycleInFlight = false;       // re-entrancy guard (audit #1: concurrent cycles double-notify)
let consecutiveRiskErrors = 0;   // risk-control backoff exponent, reset on success

/** Update the badge counter. Color priority: favorite (red) > like (orange) > normal (blue). */
async function updateBadge(count, colorType = 'normal') {
    if (count > 0) {
        const color = colorType === 'favorite' ? '#FF3B30' : (colorType === 'like' ? '#FF9500' : '#007AFF');
        // Past the cap an exact number carries no information and does not fit.
        await chrome.action.setBadgeText({ text: count > BADGE_MAX ? `${BADGE_MAX}+` : String(count) });
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
 * Fetch everything the current alert scope needs.
 *
 * Any failure throws. That is deliberate: a tolerated failure would silently
 * shrink the fetched set, and every streamer missing from one cycle would be
 * diffed as "just started" on the next one — the exact path that produced
 * three-digit badges. A thrown error leaves previousLiveUids untouched.
 *
 * @returns {Promise<{primary: Array, coverage: {uids: number[], following: boolean}}>}
 */
async function fetchScope(alertScope, customStreamers, streamerStates) {
    const selfUid = await getTargetUid();
    if (selfUid == null) throw new BiliApiError('Not logged in', { isAuth: true });

    // 1. Medal wall — always. One request, no pagination, and it is the only
    //    source of medal name/level, which every card displays.
    const medalWall = await fetchMedalWall(selfUid);
    const medalByUid = new Map(medalWall.map(m => [Number(m.uid), m]));
    const medalUids = new Set(medalByUid.keys());

    const primary = [...medalWall];
    const seen = new Set(medalUids);
    let followingFetched = false;

    // 2. Following pagination — only when the 'rest' source is subscribed.
    //    Everything else is uid-addressable and far cheaper.
    if (needsFollowing(alertScope)) {
        const { live, liveCount, truncated } = await fetchFollowingLive();
        if (truncated) {
            console.warn(`Following list truncated: collected ${live.length} of ~${liveCount} live entries`);
        }
        // Only claim coverage of the follow list when it was read in full.
        // A truncated page walk leaves live streamers unseen, and claiming
        // otherwise would let them diff as "just started" once they surface.
        followingFetched = !truncated;
        for (const streamer of live) {
            const uid = Number(streamer.uid);
            if (seen.has(uid)) continue;
            // Carry medal data across so sourceOf() buckets them correctly.
            const medal = medalByUid.get(uid);
            if (medal) {
                streamer.medalName = medal.medalName;
                streamer.medalLevel = medal.medalLevel;
            }
            primary.push(streamer);
            seen.add(uid);
        }
    }

    // 3. One batched status lookup for custom rooms and marked streamers the
    //    medal wall did not already cover. get_status_info_by_uids needs no
    //    cookie, accepts arbitrary uids, and chunks at 200 (shared/api.js).
    const pending = watchedUids(customStreamers, streamerStates, medalUids);
    if (pending.length > 0) {
        const statusMap = await fetchRoomStatusByUids(pending);

        // Custom entries are updated in place and persisted by the caller.
        for (const entry of customStreamers) {
            const uid = Number(entry.uid);
            if (!Number.isFinite(uid) || medalUids.has(uid)) continue;
            const info = statusMap.get(uid);
            if (info) {
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

        // Marked streamers that are neither on the medal wall nor already in
        // the primary list get a standalone entry, live or not.
        for (const uid of pending) {
            if (seen.has(uid)) continue;
            const info = statusMap.get(uid);
            if (!info) continue;
            primary.push(normalizeStreamer({ uid, ...info }));
            seen.add(uid);
        }
    }

    return {
        primary,
        coverage: { uids: [...medalUids, ...pending], following: followingFetched }
    };
}

/**
 * One-off `following` page walk for the popup's "all" display mode, used when
 * the 'rest' source is not subscribed and the cycle therefore never pages it.
 *
 * Deliberately NOT part of runUpdateCycle and sharing none of its state: it
 * writes exactly one key, followingCache, and the cycle never reads that key.
 * The isolation is structural rather than a filter someone has to remember —
 * an on-demand fetch can therefore never seed previousLiveUids, feed
 * newlyStreaming, or move the badge. It shares the in-flight guard and the
 * backoff gate so the two paths never issue requests at the same time.
 *
 * @returns {Promise<{ok: true, count: number}|{ok: false, reason: string}>}
 */
export async function fetchFollowingSnapshot() {
    if (cycleInFlight) return { ok: false, reason: 'busy' };
    cycleInFlight = true;
    try {
        const { backoffUntil } = await getState(['backoffUntil']);
        if (Date.now() < (backoffUntil || 0)) return { ok: false, reason: 'backoff' };

        const { live, truncated } = await fetchFollowingLive();
        await setState({ followingCache: { fetchedAt: Date.now(), list: live, truncated } });
        return { ok: true, count: live.length };
    } catch (error) {
        const reason = classifyError(error);
        if (error instanceof BiliApiError && error.isRiskControl) {
            consecutiveRiskErrors += 1;
            await setState({
                lastError: reason,
                backoffUntil: Date.now()
                    + Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveRiskErrors - 1), BACKOFF_MAX_MS),
                // The next real cycle re-seeds: we were blind during the pause.
                seedSignature: ''
            });
        }
        console.error(`Following snapshot failed (${reason}):`, error);
        return { ok: false, reason };
    } finally {
        cycleInFlight = false;
    }
}

/**
 * Run one refresh cycle. Re-entrant triggers while a cycle is in flight are
 * rejected; triggers inside a risk-control backoff window are skipped
 * (manual refreshes included).
 * @param {'alarm'|'manual'|'message'} trigger what started this cycle
 * @returns {Promise<{ok: true, liveCount: number, seeded?: boolean}|{ok: false, reason: string}>}
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
            'alertScope',
            'customStreamers',
            'deletedStreamers',
            'streamerStates',
            'previousLiveUids',
            'previousCoverage',
            'newlyStreaming',
            'seedSignature',
            'backoffUntil'
        ]);

        // Backoff gate: skip the whole cycle while the penalty window is open
        if (Date.now() < (state.backoffUntil || 0)) {
            return { ok: false, reason: 'backoff' };
        }

        const { alertScope, streamerStates, customStreamers } = state;
        const { primary, coverage } = await fetchScope(alertScope, customStreamers, streamerStates);

        // Single merge source of truth (audit #8)
        const merged = mergeStreamers(primary, customStreamers);

        // Only liveStatus === 1 counts (2 = replay/round-robin, always excluded).
        // Hidden (deleted) streamers are excluded with Number uid compare.
        const deletedUids = new Set((state.deletedStreamers || []).map(Number));
        const liveStreamers = merged.filter(s => s.liveStatus === 1 && !deletedUids.has(Number(s.uid)));
        const currentLiveUids = liveStreamers.map(s => Number(s.uid));
        const liveByUid = new Map(liveStreamers.map(s => [Number(s.uid), s]));

        const persistBase = {
            streamingInfo: primary,
            customStreamers,
            previousLiveUids: currentLiveUids,
            previousCoverage: coverage,
            lastError: null
        };

        // Silent seeding. The signature changes on first install, whenever a
        // source is added or removed, and after a backoff (which clears it).
        // Seeding records the baseline WITHOUT counting or notifying, so a
        // changed scope can never dump its whole live set onto the badge.
        const signature = scopeSignature(alertScope);
        if (signature !== state.seedSignature) {
            await setState({ ...persistBase, newlyStreaming: [], seedSignature: signature });
            await updateBadge(0);
            consecutiveRiskErrors = 0;
            await pruneNotifRoomMap(new Set(currentLiveUids));
            chrome.runtime.sendMessage({ type: 'streamersUpdated' }).catch(() => {});
            return { ok: true, liveCount: currentLiveUids.length, seeded: true };
        }

        // Diff against the previous cycle. A uid the previous cycle could not
        // see is absorbed silently instead of counting as a new stream: marking
        // someone who is already live, or adding a custom room mid-broadcast,
        // must not fire an alert for a stream that started hours ago.
        const prevSet = new Set((state.previousLiveUids || []).map(Number));
        const prevCoverage = state.previousCoverage || { uids: [], following: false };
        const prevSeen = new Set((prevCoverage.uids || []).map(Number));
        const wasObservable = uid => prevCoverage.following || prevSeen.has(uid);

        const justStarted = liveStreamers.filter(s => {
            const uid = Number(s.uid);
            return !prevSet.has(uid) && wasObservable(uid);
        });

        // The scope filter is applied HERE, before the accumulator is written —
        // not later when the badge is computed. That is what bounds
        // newlyStreaming (and the card highlight that reads it) by the alert
        // scope instead of by the follow count.
        const inBadge = s => inChannel(s, streamerStates, alertScope, AlertChannel.BADGE);

        const newlyStreaming = (state.newlyStreaming || [])
            .map(Number)
            .filter(uid => liveByUid.has(uid) && inBadge(liveByUid.get(uid)));
        for (const streamer of justStarted) {
            const uid = Number(streamer.uid);
            if (inBadge(streamer) && !newlyStreaming.includes(uid)) newlyStreaming.push(uid);
        }

        let badgeColorType = 'normal';
        if (newlyStreaming.some(uid => streamerStates[uid] === 'favorite')) badgeColorType = 'favorite';
        else if (newlyStreaming.some(uid => streamerStates[uid] === 'like')) badgeColorType = 'like';
        await updateBadge(newlyStreaming.length, badgeColorType);

        // Desktop notifications use their own channel scope, from the same diff.
        const toNotify = justStarted.filter(
            s => inChannel(s, streamerStates, alertScope, AlertChannel.NOTIFY)
        );
        if (toNotify.length > 0) await sendLiveNotifications(toNotify, streamerStates);

        // Persist only on success: a failed cycle must never overwrite the
        // previous state and report everyone as offline (kept legacy design).
        await setState({ ...persistBase, newlyStreaming });
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
            // Re-seed when the pause ends: the world moved on while we were
            // blind, and the stale baseline would read as a mass of new streams.
            update.seedSignature = '';
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
