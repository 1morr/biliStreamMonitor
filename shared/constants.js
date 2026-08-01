// Shared module: central constants, storage keys/defaults, and enums.

export const API_BASE = 'https://api.live.bilibili.com';
export const ALARM_NAME = 'updateStreamers';
export const DEFAULT_REFRESH_INTERVAL = 60;   // seconds
export const MIN_REFRESH_INTERVAL = 30;       // seconds
export const BATCH_UID_LIMIT = 200;
export const MAX_FOLLOW_PAGES = 20;
export const NOTIF_ID_PREFIX = 'live-';
export const BACKOFF_BASE_MS = 5 * 60 * 1000; // risk-control backoff base (exponential)
export const BACKOFF_MAX_MS = 30 * 60 * 1000;

export const MonitorMode = Object.freeze({
    FOLLOWING: 'following',
    MEDAL: 'medal'
});

// Notification preference codes, shared by the badge counter
// (notificationPreference) and browser notifications
// (browserNotificationPreference). Semantics per background.js:
// '0' = off, '1' = favorites only, '2' = all, '3' = liked + favorites,
// '4' = medal wall members (plus custom rooms).
export const NotifyPref = Object.freeze({
    OFF: '0',                  // disabled
    FAVORITES: '1',            // only streamers marked 'favorite'
    ALL: '2',                  // all streamers
    LIKED_AND_FAVORITES: '3',  // streamers marked 'favorite' or 'like'
    MEDAL_ONLY: '4'            // medal wall members (plus custom rooms)
});

// Full chrome.storage.local key set with defaults.
// Pref defaults verified against popup.js:24-29,85-89 and background.js:123,274.
// Note: mutable defaults (arrays/objects) must be cloned by consumers.
export const STORAGE_DEFAULTS = Object.freeze({
    schemaVersion: 2,
    monitorMode: MonitorMode.MEDAL,
    streamingInfo: [],
    customStreamers: [],
    streamerStates: {},
    deletedStreamers: [],
    previousLiveUids: [],
    newlyStreaming: [],
    notificationPreference: NotifyPref.ALL,              // default '2'
    browserNotificationPreference: NotifyPref.FAVORITES, // default '1'
    refreshInterval: DEFAULT_REFRESH_INTERVAL,
    previewMode: 'thumbnail',
    previewSound: false,
    previewVolume: 50,
    appearance: {},
    lastError: null,
    backoffUntil: 0,
    notifRoomMap: {}
});

export const STORAGE_KEYS = Object.freeze(Object.keys(STORAGE_DEFAULTS));
