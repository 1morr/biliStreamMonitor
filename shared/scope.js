// Shared module: alert-source bucketing and scope predicates.
//
// Single source of truth for "which bucket is this streamer in" and "does this
// streamer fall inside a given channel's scope". The poller, the notifier and
// the popup all need these answers; the v3.0 audit already had to fix one round
// of the same logic drifting across three copies (see docs/audit.md #8).

import {
    AlertSource,
    ALERT_SOURCES,
    AlertChannel,
    ALERT_CHANNELS,
    ViewMode,
    sourceSet
} from './constants.js';

/** The 'favorite' | 'like' mark on a streamer, or null. */
export function markOf(streamer, streamerStates) {
    if (!streamer || !streamerStates) return null;
    const mark = streamerStates[streamer.uid];
    return mark === 'favorite' || mark === 'like' ? mark : null;
}

/**
 * Which alert source a streamer belongs to. Buckets are EXCLUSIVE and checked
 * in priority order, so per-source counts sum to the total without overlap —
 * that is what lets the settings matrix show plain addable numbers.
 *
 * Consequence worth knowing: a medal-wall streamer who is also marked lands in
 * 'medal', not 'fav'. For the "marked" display mode use markOf() instead, which
 * tests the mark directly and therefore does not miss them.
 */
export function sourceOf(streamer, streamerStates) {
    if (!streamer) return AlertSource.REST;
    if (streamer.medalName != null) return AlertSource.MEDAL;
    if (streamer.isCustom) return AlertSource.CUSTOM;
    const mark = markOf(streamer, streamerStates);
    if (mark === 'favorite') return AlertSource.FAV;
    if (mark === 'like') return AlertSource.LIKE;
    return AlertSource.REST;
}

/** Coerce any stored/imported value into a full {badge, notify} x sources shape. */
export function normalizeAlertScope(raw) {
    const out = {};
    for (const channel of ALERT_CHANNELS) {
        const src = raw && typeof raw === 'object' ? raw[channel] : null;
        const picked = {};
        for (const source of ALERT_SOURCES) {
            picked[source] = Boolean(src && src[source]);
        }
        out[channel] = sourceSet(picked);
    }
    return out;
}

/** The source set a channel subscribes to, defaulted to all-false. */
export function channelSources(alertScope, channel) {
    const src = alertScope && alertScope[channel];
    if (!src) return sourceSet();
    return src;
}

/** Does this streamer trigger the given channel? */
export function inChannel(streamer, streamerStates, alertScope, channel) {
    const set = channelSources(alertScope, channel);
    return Boolean(set[sourceOf(streamer, streamerStates)]);
}

/** Union of both channels — what the popup's 'alert' display mode shows. */
export function inUnion(streamer, streamerStates, alertScope) {
    return ALERT_CHANNELS.some(
        channel => inChannel(streamer, streamerStates, alertScope, channel)
    );
}

/** Does this streamer belong in the given display mode? */
export function inViewMode(streamer, streamerStates, alertScope, viewMode) {
    switch (viewMode) {
        case ViewMode.ALL:
            return true;
        case ViewMode.MEDAL:
            return streamer && streamer.medalName != null;
        case ViewMode.MARK:
            // Tests the mark directly, not the exclusive bucket, so marked
            // medal-wall streamers still show up here.
            return markOf(streamer, streamerStates) !== null;
        case ViewMode.ALERT:
        default:
            return inUnion(streamer, streamerStates, alertScope);
    }
}

/**
 * Whether the expensive `following` pagination is needed at all. Only the
 * 'rest' source requires it; everything else is uid-addressable through
 * MedalWall plus one batched get_status_info_by_uids call.
 */
export function needsFollowing(alertScope) {
    return ALERT_CHANNELS.some(channel => channelSources(alertScope, channel).rest);
}

/**
 * Stable string describing the subscribed source set, e.g.
 * "badge:medal,custom,fav,like|notify:medal,custom,fav".
 * A mismatch against the stored seedSignature means the poller must seed
 * silently this cycle instead of diffing.
 */
export function scopeSignature(alertScope) {
    return ALERT_CHANNELS
        .map(channel => {
            const set = channelSources(alertScope, channel);
            return `${channel}:${ALERT_SOURCES.filter(source => set[source]).join(',')}`;
        })
        .join('|');
}

/**
 * Uids that need a batched status lookup: manually added rooms plus every
 * marked streamer, minus whatever the medal wall already covered.
 * @param {Array} customStreamers
 * @param {Object} streamerStates {uid: 'favorite'|'like'}
 * @param {Set<number>} coveredUids uids already carrying a fresh status
 */
export function watchedUids(customStreamers, streamerStates, coveredUids) {
    const uids = new Set();
    for (const entry of customStreamers || []) {
        const uid = Number(entry && entry.uid);
        if (Number.isFinite(uid) && !coveredUids.has(uid)) uids.add(uid);
    }
    for (const [key, mark] of Object.entries(streamerStates || {})) {
        if (mark !== 'favorite' && mark !== 'like') continue;
        const uid = Number(key);
        if (Number.isFinite(uid) && !coveredUids.has(uid)) uids.add(uid);
    }
    return [...uids];
}

export { AlertSource, AlertChannel, ViewMode };
