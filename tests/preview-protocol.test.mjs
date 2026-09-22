// Tests for popup/preview-protocol.js -- the embed contract with Bilibili's
// activity player. Pure ES module with no chrome.* or DOM dependency.
//
// Both values pinned here fail silently in the product: the player ignores an
// unknown query parameter and clamps an out-of-scale volume to zero, neither of
// which raises anything. The regression they guard is the one users heard --
// the preview opening at the player's own remembered volume (90%) and only
// dropping to the configured level a second or so later.
//
// Assertions run against parsed output (URLSearchParams, JSON.parse) rather
// than against the source text, so renaming a constant or reformatting the
// module cannot turn them red on its own.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLAYER_ORIGIN, livePlayerUrl, volumeCommand } from '../popup/preview-protocol.js';

/** Decode a `setPlayer-<json>` payload back into its object form. */
function parseCommand(payload) {
    assert.ok(payload.startsWith('setPlayer-'), `not a setPlayer payload: ${payload}`);
    return JSON.parse(payload.slice('setPlayer-'.length));
}

// --- livePlayerUrl: the mute parameter ---

test('livePlayerUrl opens the player muted, using the parameter the player actually reads', () => {
    const url = new URL(livePlayerUrl(545068));

    // Verified against the live player: `mute=1` starts it at volume 0 and
    // overrides the volume remembered from the user's last visit.
    assert.equal(url.searchParams.get('mute'), '1');

    // `muted` is not a parameter of this player. Shipping that spelling is what
    // made the preview blare on open, and it is silently ignored -- so the
    // absence has to be asserted, not just the presence of `mute`.
    assert.equal(url.searchParams.has('muted'), false);
});

test('livePlayerUrl points at the activity player on the expected origin', () => {
    const url = new URL(livePlayerUrl(545068));
    assert.equal(url.origin, PLAYER_ORIGIN);
    assert.equal(url.pathname, '/blackboard/live/live-activity-player.html');
    assert.equal(url.searchParams.get('cid'), '545068');
});

test('livePlayerUrl encodes the room id instead of interpolating it raw', () => {
    const url = new URL(livePlayerUrl('123&mute=0'));
    // The injected pair must land inside cid, not as its own parameter.
    assert.equal(url.searchParams.get('cid'), '123&mute=0');
    assert.equal(url.searchParams.get('mute'), '1');
});

// --- volumeCommand: the 0-100 scale ---

test('volumeCommand sends the volume on the player 0-100 scale, not a 0-1 fraction', () => {
    const cmd = parseCommand(volumeCommand({ previewSound: true, previewVolume: 50 }));

    assert.equal(cmd.type, 'changeVolume');
    // Verified against the live player: {volume: 50} lands on video.volume 0.5,
    // while a 0-1 fraction (0.5) rounds to 0 and plays silently.
    assert.equal(cmd.value.volume, 50);
});

test('volumeCommand expresses "sound off" as volume 0, which is how the player mutes', () => {
    const cmd = parseCommand(volumeCommand({ previewSound: false, previewVolume: 80 }));
    assert.equal(cmd.value.volume, 0);
});

test('volumeCommand clamps out-of-range values into 0-100', () => {
    const at = (previewVolume) =>
        parseCommand(volumeCommand({ previewSound: true, previewVolume })).value.volume;

    // An imported config is not range-checked on previewVolume, so the clamp
    // here is what keeps a junk value from reaching the player.
    assert.equal(at(10000), 100);
    assert.equal(at(-5), 0);
    assert.equal(at(0), 0);
    assert.equal(at(100), 100);
});

test('volumeCommand falls back to silence for a non-numeric volume', () => {
    const at = (previewVolume) =>
        parseCommand(volumeCommand({ previewSound: true, previewVolume })).value.volume;

    assert.equal(at(undefined), 0);
    assert.equal(at(null), 0);
    assert.equal(at('not a number'), 0);
});

test('volumeCommand rounds to an integer, the only thing the player accepts', () => {
    const cmd = parseCommand(volumeCommand({ previewSound: true, previewVolume: 33.7 }));
    assert.equal(cmd.value.volume, 34);
    assert.equal(Number.isInteger(cmd.value.volume), true);
});

// --- payload shape ---

test('volumeCommand produces the exact string shape the player listens for', () => {
    // The player matches on the `setPlayer-` prefix and ignores anything else,
    // including a structured-clone object payload -- which is what the previous
    // content-script bridge sent.
    const payload = volumeCommand({ previewSound: true, previewVolume: 45 });
    assert.equal(typeof payload, 'string');
    assert.equal(payload, 'setPlayer-{"type":"changeVolume","value":{"volume":45}}');
});
