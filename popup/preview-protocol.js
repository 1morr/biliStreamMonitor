// Popup module: the contract with Bilibili's embedded live "activity player".
//
// Kept free of DOM access so tests/preview-protocol.test.mjs can exercise it
// under plain node. Everything here is a value the player accepts silently when
// it is wrong -- a misspelled query parameter and an out-of-scale volume both
// produce no error, just a preview playing at the player's own remembered
// volume -- so the two of them are pinned by tests rather than by review.
//
// Protocol reference (official):
// https://live.bilibili.com/p/html/bilibili-live-player/docs/player-activity.html

export const PLAYER_ORIGIN = 'https://www.bilibili.com';

const PLAYER_PATH = '/blackboard/live/live-activity-player.html';

/** The player's volume scale: 0-100, NOT the 0-1 an HTMLMediaElement takes. */
const VOLUME_MAX = 100;

/**
 * Embed URL for one room.
 *
 * `mute=1` is the documented parameter, and the only thing that makes the
 * player open silent: it is implemented as volume 0 and it overrides the volume
 * the player remembers from the user's last visit. There is no `muted`
 * parameter -- spelling it that way is ignored, which is what made previews
 * open at full blast.
 */
export function livePlayerUrl(roomId) {
    return `${PLAYER_ORIGIN}${PLAYER_PATH}?cid=${encodeURIComponent(roomId)}&mute=1`;
}

/**
 * The volume command, as the exact string the player listens for.
 *
 * Sound being off is expressed as volume 0 rather than as a separate mute
 * command, because that is what the player itself does for `mute=1`.
 *
 * @param {{previewSound: boolean, previewVolume: number}} state
 * @returns {string} a `setPlayer-<json>` payload
 */
export function volumeCommand({ previewSound, previewVolume }) {
    const requested = previewSound ? Number(previewVolume) : 0;
    const volume = Number.isFinite(requested)
        ? Math.round(Math.min(VOLUME_MAX, Math.max(0, requested)))
        : 0;
    return `setPlayer-${JSON.stringify({ type: 'changeVolume', value: { volume } })}`;
}
