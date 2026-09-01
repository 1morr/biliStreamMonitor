// Tests for shared/scope.js and shared/merge.js -- pure ES modules with no
// chrome.* dependency, importable directly under plain node (node --test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    markOf,
    sourceOf,
    normalizeAlertScope,
    channelSources,
    inChannel,
    inUnion,
    inViewMode,
    needsFollowing,
    scopeSignature,
    trackedUids
} from '../shared/scope.js';
import { normalizeStreamer, mergeStreamers } from '../shared/merge.js';
import { AlertSource, AlertChannel, ViewMode, sourceSet } from '../shared/constants.js';

// --- Regression: fix #1 (custom rooms bucketed as 'rest', never alert) ---
// background/poller.js fetchScope() step 5 used to push an unseen custom uid
// through normalizeStreamer() directly, which has no `isCustom` raw field
// name and so always drops the flag; it also marked the uid `seen`, which
// then stopped mergeStreamers() from ever substituting the real
// customStreamers entry. The fix skips custom uids in that loop so
// mergeStreamers alone is responsible for the isCustom flag.

test('mergeStreamers assigns isCustom to a custom room absent from primary, so sourceOf buckets it as custom (fix #1)', () => {
    const custom = { uid: 555, roomId: 999, uname: 'CustomRoom', liveStatus: 1 };
    const merged = mergeStreamers([], [custom]);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].isCustom, true);
    assert.equal(sourceOf(merged[0], {}), AlertSource.CUSTOM);
});

test('a normalizeStreamer() entry built without isCustom falls through to rest (the exact bug fix #1 avoids)', () => {
    // This is precisely the shape fetchScope's old step 5 produced:
    // normalizeStreamer({ uid, ...info }) with no isCustom in `info`.
    const wronglyBuilt = normalizeStreamer({ uid: 555, roomId: 999, liveStatus: 1 });

    assert.equal(wronglyBuilt.isCustom, false);
    assert.equal(sourceOf(wronglyBuilt, {}), AlertSource.REST);
});

test('mergeStreamers does not duplicate a custom uid already present in primary', () => {
    const primary = [{ uid: 555, roomId: 999, uname: 'FromFollowing', liveStatus: 1 }];
    const custom = { uid: 555, roomId: 999, uname: 'CustomCopy', liveStatus: 1 };
    const merged = mergeStreamers(primary, [custom]);

    assert.equal(merged.length, 1);
    // Primary wins the conflict; its isCustom (false, from a following-list
    // entry) is preserved rather than being overwritten by the custom copy.
    assert.equal(merged[0].uname, 'FromFollowing');
    assert.equal(merged[0].isCustom, false);
});

// --- sourceOf: exclusive-bucket priority order (medal > custom > fav > like > rest) ---

test('sourceOf: medal wins over custom, favorite and like', () => {
    const streamer = { uid: 1, medalName: 'Fan', isCustom: true };
    const states = { 1: 'favorite' };
    assert.equal(sourceOf(streamer, states), AlertSource.MEDAL);
});

test('sourceOf: custom wins over favorite and like (no medal)', () => {
    const streamer = { uid: 2, medalName: null, isCustom: true };
    const states = { 2: 'favorite' };
    assert.equal(sourceOf(streamer, states), AlertSource.CUSTOM);
});

test('sourceOf: favorite wins over like (no medal, no custom)', () => {
    const streamer = { uid: 3, medalName: null, isCustom: false };
    const states = { 3: 'favorite' };
    assert.equal(sourceOf(streamer, states), AlertSource.FAV);
});

test('sourceOf: like is used when nothing else applies', () => {
    const streamer = { uid: 4, medalName: null, isCustom: false };
    const states = { 4: 'like' };
    assert.equal(sourceOf(streamer, states), AlertSource.LIKE);
});

test('sourceOf: rest is the fallback bucket', () => {
    const streamer = { uid: 5, medalName: null, isCustom: false };
    assert.equal(sourceOf(streamer, {}), AlertSource.REST);
});

test('sourceOf: a null streamer is rest, not a throw', () => {
    assert.equal(sourceOf(null, {}), AlertSource.REST);
});

// --- markOf ---

test('markOf: reads favorite/like from streamerStates by uid', () => {
    const states = { 10: 'favorite', 11: 'like', 12: 'bogus' };
    assert.equal(markOf({ uid: 10 }, states), 'favorite');
    assert.equal(markOf({ uid: 11 }, states), 'like');
    assert.equal(markOf({ uid: 12 }, states), null);
    assert.equal(markOf({ uid: 13 }, states), null);
});

test('markOf: null streamer or missing streamerStates returns null, not a throw', () => {
    assert.equal(markOf(null, {}), null);
    assert.equal(markOf({ uid: 1 }, null), null);
});

// --- normalizeAlertScope / channelSources ---

test('normalizeAlertScope: fills the full {badge, notify} x sources shape, defaulting to false', () => {
    const out = normalizeAlertScope({ badge: { medal: true, bogusKey: true } });
    assert.deepEqual(out.badge, sourceSet({ medal: true }));
    assert.deepEqual(out.notify, sourceSet());
    assert.equal('bogusKey' in out.badge, false);
});

test('normalizeAlertScope: tolerates a non-object input', () => {
    const out = normalizeAlertScope(null);
    assert.deepEqual(out.badge, sourceSet());
    assert.deepEqual(out.notify, sourceSet());
});

test('channelSources: returns an all-false set for a missing channel', () => {
    assert.deepEqual(channelSources({}, AlertChannel.BADGE), sourceSet());
    assert.deepEqual(channelSources(null, AlertChannel.BADGE), sourceSet());
});

// --- inChannel / inUnion / inViewMode ---

test('inChannel / inUnion: true only when the streamer\'s bucket is subscribed on that channel', () => {
    const scope = {
        badge: sourceSet({ fav: true }),
        notify: sourceSet({ like: true })
    };
    const favStreamer = { uid: 1 };
    const states = { 1: 'favorite' };

    assert.equal(inChannel(favStreamer, states, scope, AlertChannel.BADGE), true);
    assert.equal(inChannel(favStreamer, states, scope, AlertChannel.NOTIFY), false);
    assert.equal(inUnion(favStreamer, states, scope), true);

    const restStreamer = { uid: 2 };
    assert.equal(inUnion(restStreamer, states, scope), false);
});

test('inViewMode: ALL is unconditional; MEDAL/MARK test their own predicate; default is the channel union', () => {
    const scope = { badge: sourceSet({ fav: true }), notify: sourceSet() };
    const states = { 1: 'favorite' };
    const medalStreamer = { uid: 2, medalName: 'Fan' };
    const favStreamer = { uid: 1, medalName: null };
    const plainStreamer = { uid: 3, medalName: null };

    assert.equal(inViewMode(plainStreamer, states, scope, ViewMode.ALL), true);
    assert.equal(inViewMode(medalStreamer, states, scope, ViewMode.MEDAL), true);
    assert.equal(inViewMode(favStreamer, states, scope, ViewMode.MEDAL), false);
    assert.equal(inViewMode(favStreamer, states, scope, ViewMode.MARK), true);
    assert.equal(inViewMode(plainStreamer, states, scope, ViewMode.MARK), false);
    assert.equal(inViewMode(favStreamer, states, scope, ViewMode.ALERT), true);
    assert.equal(inViewMode(plainStreamer, states, scope, ViewMode.ALERT), false);
});

// --- needsFollowing ---

test('needsFollowing: true only when rest is subscribed on either channel', () => {
    assert.equal(needsFollowing({ badge: sourceSet({ rest: true }), notify: sourceSet() }), true);
    assert.equal(needsFollowing({ badge: sourceSet(), notify: sourceSet({ rest: true }) }), true);
    assert.equal(needsFollowing({ badge: sourceSet({ medal: true }), notify: sourceSet() }), false);
});

// --- scopeSignature ---

test('scopeSignature: stable, source-order string that changes when the scope changes', () => {
    const scopeA = {
        badge: sourceSet({ medal: true, custom: true }),
        notify: sourceSet({ fav: true })
    };
    assert.equal(scopeSignature(scopeA), 'badge:medal,custom|notify:fav');

    const scopeB = { ...scopeA, notify: sourceSet({ fav: true, like: true }) };
    assert.notEqual(scopeSignature(scopeA), scopeSignature(scopeB));
});

// --- trackedUids ---

test('trackedUids: unions medal uids, custom room uids and favorite/like marks, deduped', () => {
    const customStreamers = [{ uid: 200 }, { uid: 300 }];
    const streamerStates = { 300: 'favorite', 400: 'like', 500: 'bogus' };
    const uids = trackedUids(customStreamers, streamerStates, [100, 200]);

    assert.deepEqual([...uids].sort((a, b) => a - b), [100, 200, 300, 400]);
});

// --- normalizeStreamer ---

test('normalizeStreamer: tolerates legacy v1 field names', () => {
    const s = normalizeStreamer({
        uid: '42',
        streamer_name: 'Legacy',
        live_status: 1,
        medal_name: 'Fan',
        medal_level: 5,
        _custom: true
    });
    assert.equal(s.uid, 42);
    assert.equal(s.uname, 'Legacy');
    assert.equal(s.liveStatus, 1);
    assert.equal(s.medalName, 'Fan');
    assert.equal(s.medalLevel, 5);
    assert.equal(s.isCustom, true);
});

test('normalizeStreamer: returns null for a falsy input', () => {
    assert.equal(normalizeStreamer(null), null);
    assert.equal(normalizeStreamer(undefined), null);
});
