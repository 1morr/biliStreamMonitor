// Shared module: central constants, storage keys/defaults, and enums.

export const API_BASE = 'https://api.live.bilibili.com';
export const ALARM_NAME = 'updateStreamers';
export const DEFAULT_REFRESH_INTERVAL = 60;   // seconds
export const MIN_REFRESH_INTERVAL = 30;       // seconds
export const BATCH_UID_LIMIT = 200;
export const MAX_FOLLOW_PAGES = 20;
export const NOTIF_ID_PREFIX = 'live-';
export const NOTIF_OVERFLOW_ID = 'live-overflow';
export const BACKOFF_BASE_MS = 5 * 60 * 1000; // risk-control backoff base (exponential)
export const BACKOFF_MAX_MS = 30 * 60 * 1000;

// Badge text caps here; anything above renders as '99+'. Chrome only fits a few
// glyphs anyway, and an exact count past this point carries no information.
export const BADGE_MAX = 99;
// Desktop notifications sent individually per cycle; the rest collapse into one.
export const NOTIF_BATCH_LIMIT = 5;
// Past this age the cached following snapshot's live flags are too stale to
// paint at all; the popup shows a loading state instead of yesterday's news.
export const SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;
// Rough cost of one following page walk, for the settings request-count readout.
export const FOLLOW_PAGE_ESTIMATE = 5;
// A gap this long since the last successful cycle means the diff baseline is
// stale — browser restarted, laptop slept, cookie expired for hours — and the
// next cycle must seed instead of announcing everything that happened while we
// were blind. Scaled off the refresh interval, floored so a couple of missed
// alarms never trip it.
export const STALE_BASELINE_CYCLES = 5;
export const MIN_STALE_BASELINE_MS = 5 * 60 * 1000;

// Alert sources. Every streamer falls into exactly one bucket (see
// shared/scope.js sourceOf), so per-source counts can simply be summed.
export const AlertSource = Object.freeze({
    MEDAL: 'medal',    // on the user's medal wall
    CUSTOM: 'custom',  // manually added room, not on the medal wall
    FAV: 'fav',        // marked 'favorite', none of the above
    LIKE: 'like',      // marked 'like', none of the above
    REST: 'rest'       // every other followed streamer
});

export const ALERT_SOURCES = Object.freeze(Object.values(AlertSource));

// The two ways the extension can interrupt you. They subscribe to sources
// independently: a desktop notification covers what you are doing, a badge
// just sits in the toolbar, so they deserve different thresholds.
export const AlertChannel = Object.freeze({
    BADGE: 'badge',
    NOTIFY: 'notify'
});

export const ALERT_CHANNELS = Object.freeze(Object.values(AlertChannel));

// The popup's hover-preview mode (persisted as previewMode).
export const PreviewMode = Object.freeze({
    LIVE: 'live',
    THUMBNAIL: 'thumbnail'
});

// Popup display modes (persisted as viewMode).
export const ViewMode = Object.freeze({
    ALERT: 'alert',   // union of both channels' subscribed sources (default)
    MEDAL: 'medal',
    MARK: 'mark',     // marked 'favorite' or 'like'
    ALL: 'all'        // everything fetched; needs following data
});

/** Build an alertScope channel entry. */
function sourceSet({ medal = false, custom = false, fav = false, like = false, rest = false } = {}) {
    return { medal, custom, fav, like, rest };
}

// Default: medal wall + manually added rooms + anything marked. Deliberately
// excludes 'rest' — pulling every followed streamer into the badge is the
// v3.0 regression this model exists to undo.
export const DEFAULT_ALERT_SCOPE = Object.freeze({
    badge: sourceSet({ medal: true, custom: true, fav: true, like: true }),
    notify: sourceSet({ medal: true, custom: true, fav: true, like: true })
});

export { sourceSet };

// Numeric ranges for the appearance sliders, mirrored by the min/max
// attributes on the range inputs in popup/popup.html. There is no build step
// to derive one from the other, so keep them in sync by hand; this is also
// the single place shared/storage.js clamps an imported appearance object to.
export const APPEARANCE_RANGES = Object.freeze({
    width: { min: 300, max: 800 },
    height: { min: 300, max: 600 },
    avatarSize: { min: 30, max: 120 },
    gapX: { min: 0, max: 30 },
    gapY: { min: 0, max: 30 },
    cardPaddingX: { min: 0, max: 30 },
    cardPaddingY: { min: 0, max: 30 },
    fontSize: { min: 10, max: 16 }
});

// Full chrome.storage.local key set with defaults.
// Note: mutable defaults (arrays/objects) must be cloned by consumers.
export const STORAGE_DEFAULTS = Object.freeze({
    schemaVersion: 3,
    streamingInfo: [],
    customStreamers: [],
    streamerStates: {},
    deletedStreamers: [],
    previousLiveUids: [],
    newlyStreaming: [],
    // Who the previous cycle could actually see. A uid entering the fetch set
    // for the first time (newly marked, custom room just added) must not be
    // diffed as "just started" — it was simply invisible before.
    previousCoverage: { uids: [], following: false },
    alertScope: DEFAULT_ALERT_SCOPE,
    viewMode: ViewMode.ALERT,
    // Stable string describing the currently subscribed source set. A mismatch
    // means "seed silently this cycle" (first install, sources changed, or a
    // risk-control backoff that cleared it). See shared/scope.js scopeSignature.
    seedSignature: '',
    // When the last cycle actually completed. Drives the staleness check above.
    lastSuccessAt: 0,
    // On-demand following snapshot for the 'all' view. Never feeds the diff.
    followingCache: { fetchedAt: 0, list: [] },
    refreshInterval: DEFAULT_REFRESH_INTERVAL,
    previewMode: PreviewMode.THUMBNAIL,
    previewSound: false,
    previewVolume: 50,
    appearance: {},
    lastError: null,
    backoffUntil: 0,
    // Consecutive risk-control failures since the last success. Persisted
    // (not module-level) because MV3 recycles the service worker well inside
    // the >=5 minute backoff window; without this the exponential escalation
    // (5 -> 10 -> 20 -> 30 min, background/poller.js applyRiskBackoff) could
    // never advance past its first step. Reset to 0 on every successful cycle.
    consecutiveRiskErrors: 0,
    notifRoomMap: {}
});

export const STORAGE_KEYS = Object.freeze(Object.keys(STORAGE_DEFAULTS));
