// Background module: refresh cycle core (fetch, merge, seed/diff, badge, notify, persist).

import {
    AlertChannel,
    BADGE_MAX,
    BACKOFF_BASE_MS,
    BACKOFF_MAX_MS,
    STALE_BASELINE_CYCLES,
    MIN_STALE_BASELINE_MS
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
import { inChannel, needsFollowing, scopeSignature, trackedUids } from '../shared/scope.js';
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

/** Persist a risk-control pause and force the next live cycle to re-seed. */
async function applyRiskBackoff(lastError) {
    consecutiveRiskErrors += 1;
    await setState({
        lastError,
        // Exponential backoff: 5 -> 10 -> 20 -> 30 (cap) minutes
        backoffUntil: Date.now()
            + Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveRiskErrors - 1), BACKOFF_MAX_MS),
        // The world moved on while we were paused; a stale baseline would read
        // as a mass of new streams.
        seedSignature: ''
    });
}

/**
 * Fetch everything the current alert scope needs.
 *
 * Any failure throws. That is deliberate: a tolerated failure would silently
 * shrink the fetched set, and every streamer missing from one cycle would be
 * diffed as "just started" on the next one — the exact path that produced
 * three-digit badges. A thrown error leaves previousLiveUids untouched.
 *
 * @returns {Promise<{primary: Array, trackedUids: number[], followingCovered: boolean}>}
 */
async function fetchScope(alertScope, customStreamers, streamerStates) {
    const selfUid = await getTargetUid();
    if (selfUid == null) throw new BiliApiError('Not logged in', { isAuth: true });

    // 1. Medal wall — always. One request, no pagination, and the only source
    //    of medal name/level, which every card displays.
    const medalWall = await fetchMedalWall(selfUid);
    const medalUids = medalWall.map(m => Number(m.uid));

    // 2. One batched status lookup covering the medal wall, custom rooms and
    //    every marked uid. MedalWall reports live status but returns no title,
    //    cover or area, so without this a medal-bucket notification would have
    //    an empty body. get_status_info_by_uids needs no cookie, accepts
    //    arbitrary uids, and chunks at 200 (shared/api.js).
    const tracked = trackedUids(customStreamers, streamerStates, medalUids);
    const statusMap = tracked.length > 0 ? await fetchRoomStatusByUids(tracked) : new Map();

    const primary = [];
    const seen = new Set();

    /** Batch data wins on room fields; the medal wall keeps name and level. */
    const withStatus = (base) => {
        const info = statusMap.get(Number(base.uid));
        if (!info) return base;
        return {
            ...base,
            roomId: info.roomId || base.roomId,
            uname: base.uname || info.uname,
            face: base.face || info.face,
            title: info.title,
            cover: info.cover,
            area: info.area,
            liveStatus: info.liveStatus
        };
    };

    for (const entry of medalWall) {
        primary.push(withStatus(entry));
        seen.add(Number(entry.uid));
    }

    // 3. Following pagination — only when the 'rest' source is subscribed.
    let followingCovered = false;
    if (needsFollowing(alertScope)) {
        const { live, liveCount, truncated } = await fetchFollowingLive();
        // Claim coverage only when the walk was demonstrably complete. Page
        // boundaries shift while paging, so a short read can happen without the
        // truncation flag; claiming coverage then would let the missed
        // streamers diff as "just started" when they surface next cycle.
        followingCovered = !truncated && live.length >= liveCount;
        if (!followingCovered) {
            console.warn(`Following walk incomplete: collected ${live.length} of ~${liveCount} live entries`);
        }
        for (const streamer of live) {
            const uid = Number(streamer.uid);
            if (seen.has(uid)) continue;
            primary.push(streamer);
            seen.add(uid);
        }
    }

    // 4. Custom entries are updated in place and persisted by the caller.
    for (const entry of customStreamers) {
        const uid = Number(entry.uid);
        if (!Number.isFinite(uid)) continue;
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

    // 5. Marked streamers not covered above get a standalone entry, live or not.
    for (const uid of tracked) {
        if (seen.has(uid)) continue;
        const info = statusMap.get(uid);
        if (!info) continue;
        primary.push(normalizeStreamer({ uid, ...info }));
        seen.add(uid);
    }

    return { primary, trackedUids: tracked, followingCovered };
}

/**
 * One-off `following` page walk for the popup's "all" display mode, used when
 * the 'rest' source is not subscribed and the cycle therefore never pages it.
 *
 * On success it writes exactly one key, followingCache, which runUpdateCycle
 * never reads — so a snapshot can never seed previousLiveUids, feed
 * newlyStreaming, or move the badge. On a risk-control error it DOES share the
 * cycle's penalty state (backoffUntil, lastError, seedSignature): the block is
 * per IP, so pretending the cycle is unaffected would just keep hammering it.
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
        if (error instanceof BiliApiError && error.isRiskControl) await applyRiskBackoff(reason);
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
            'lastSuccessAt',
            'refreshInterval',
            'backoffUntil'
        ]);

        // Backoff gate: skip the whole cycle while the penalty window is open
        if (Date.now() < (state.backoffUntil || 0)) {
            return { ok: false, reason: 'backoff' };
        }

        const { alertScope, streamerStates, customStreamers } = state;
        const { primary, trackedUids: tracked, followingCovered } =
            await fetchScope(alertScope, customStreamers, streamerStates);

        // Single merge source of truth (audit #8)
        const merged = mergeStreamers(primary, customStreamers);

        // Only liveStatus === 1 counts (2 = replay/round-robin, always excluded).
        // Hidden (deleted) streamers are excluded with Number uid compare.
        const deletedUids = new Set((state.deletedStreamers || []).map(Number));
        const liveStreamers = merged.filter(s => s.liveStatus === 1 && !deletedUids.has(Number(s.uid)));
        const currentLiveUids = liveStreamers.map(s => Number(s.uid));
        const liveByUid = new Map(liveStreamers.map(s => [Number(s.uid), s]));

        // Coverage must describe the same population the diff runs over, so
        // hidden uids are excluded here too. Otherwise un-hiding someone who
        // has been live for hours would diff them as a fresh stream.
        const coverage = {
            uids: tracked.filter(uid => !deletedUids.has(uid)),
            following: followingCovered
        };

        const persistBase = {
            streamingInfo: primary,
            customStreamers,
            previousLiveUids: currentLiveUids,
            previousCoverage: coverage,
            lastSuccessAt: Date.now(),
            lastError: null
        };

        // Seed silently when the baseline cannot be trusted:
        //  - the subscribed source set changed (or this is a first run)
        //  - too long since the last successful cycle: browser restarted,
        //    machine slept, or auth/network failed for hours. Neither the
        //    signature nor the coverage set can notice elapsed time, and
        //    without this check every stream started while we were blind is
        //    announced at once — the three-digit badge, by another door.
        const signature = scopeSignature(alertScope);
        const staleAfter = Math.max(
            MIN_STALE_BASELINE_MS,
            (Number(state.refreshInterval) || 60) * 1000 * STALE_BASELINE_CYCLES
        );
        const baselineAge = Date.now() - (state.lastSuccessAt || 0);

        if (signature !== state.seedSignature || baselineAge > staleAfter) {
            await setState({ ...persistBase, newlyStreaming: [], seedSignature: signature });
            await updateBadge(0);
            consecutiveRiskErrors = 0;
            await pruneNotifRoomMap(new Set(currentLiveUids));
            chrome.runtime.sendMessage({ type: 'streamersUpdated' }).catch(() => {});
            return { ok: true, liveCount: currentLiveUids.length, seeded: true };
        }

        // Diff against the previous cycle. A uid the previous cycle could not
        // see is absorbed silently instead of counting as a new stream: marking
        // someone who is already live, un-hiding them, or adding a custom room
        // mid-broadcast must not fire an alert for an hours-old stream.
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

        // Persist before notifying. If the service worker is killed between the
        // two, the next cycle re-runs the diff off the same baseline and rings
        // the same batch again; persisting first makes the lost work a missed
        // notification rather than a duplicated one.
        await setState({ ...persistBase, newlyStreaming });
        consecutiveRiskErrors = 0;

        // Desktop notifications use their own channel scope, from the same diff.
        const toNotify = justStarted.filter(
            s => inChannel(s, streamerStates, alertScope, AlertChannel.NOTIFY)
        );
        if (toNotify.length > 0) await sendLiveNotifications(toNotify, streamerStates);

        await pruneNotifRoomMap(new Set(currentLiveUids));

        chrome.runtime.sendMessage({ type: 'streamersUpdated' }).catch(() => {});
        return { ok: true, liveCount: currentLiveUids.length };
    } catch (error) {
        const lastError = classifyError(error);
        console.error(`Update cycle failed (${lastError}):`, error);
        try {
            if (error instanceof BiliApiError && error.isRiskControl) {
                await applyRiskBackoff(lastError);
            } else {
                await setState({ lastError });
            }
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
