// Shared module: chrome.storage.local state access, schema v3 migration, config import/export.

import {
    STORAGE_DEFAULTS,
    MIN_REFRESH_INTERVAL,
    ViewMode,
    PreviewMode,
    APPEARANCE_RANGES,
    sourceSet
} from './constants.js';
import { normalizeAlertScope } from './scope.js';
import { normalizeStreamer } from './merge.js';

export const STORAGE_VERSION = 3;

// Settings-type keys allowed in config import/export. Runtime state
// (seedSignature, followingCache, previousLiveUids, ...) is deliberately absent.
const SETTINGS_KEYS = Object.freeze([
    'customStreamers',
    'streamerStates',
    'deletedStreamers',
    'alertScope',
    'viewMode',
    'refreshInterval',
    'previewMode',
    'previewSound',
    'previewVolume',
    'appearance'
]);

// Legacy notification preference codes -> alert source sets (schema v2 -> v3).
// '2' (ALL) deliberately does NOT map to every source: in the medal-wall era it
// meant "everyone I monitor" (~90 people), and only drifted into "all
// follows" when v3.0 widened the population. Mapping it to the new default is
// the faithful reading of the original intent, and is the behaviour change this
// release exists to make. Called out in CHANGELOG 4.0.0.
const PREF_TO_SOURCES = Object.freeze({
    '0': {},
    '1': { fav: true },
    '2': { medal: true, custom: true, fav: true, like: true },
    '3': { fav: true, like: true },
    '4': { medal: true, custom: true }
});

/** Clone a mutable default so callers never share the frozen reference. */
function cloneDefault(value) {
    if (Array.isArray(value)) return value.slice();
    if (value !== null && typeof value === 'object') return structuredClone(value);
    return value;
}

/**
 * Read state from chrome.storage.local with STORAGE_DEFAULTS applied.
 * @param {string|string[]|null} keys null = all keys (defaults still applied)
 */
export async function getState(keys = null) {
    const data = await chrome.storage.local.get(keys);
    const result = { ...data };
    const applyKeys = keys == null
        ? Object.keys(STORAGE_DEFAULTS)
        : (Array.isArray(keys) ? keys : [keys]);
    for (const key of applyKeys) {
        if (result[key] === undefined && key in STORAGE_DEFAULTS) {
            result[key] = cloneDefault(STORAGE_DEFAULTS[key]);
        }
    }
    return result;
}

/** Write state to chrome.storage.local. */
export async function setState(obj) {
    return chrome.storage.local.set(obj);
}

/**
 * Schema migration to v3, idempotent. Runs the v2 fixups first so a v1 install
 * converges in one pass.
 *
 * v1 -> v2: browserNotificationsEnabled (bool) -> a preference code,
 *   appearance key renames, deletedStreamers -> Number[], refreshInterval clamp.
 * v2 -> v3: the two preference codes become alertScope {badge, notify} x sources;
 *   monitorMode is dropped (the fetch plan is derived from alertScope now);
 *   seedSignature is cleared so the first cycle after upgrading seeds silently
 *   instead of reporting every live streamer as newly live.
 * @returns {Promise<boolean>} true if a migration ran
 */
export async function migrateIfNeeded() {
    const data = await chrome.storage.local.get(null);
    if (typeof data.schemaVersion === 'number' && data.schemaVersion >= STORAGE_VERSION) {
        return false;
    }

    const updates = {};

    // --- v1 -> v2 fixups ---

    if (data.appearance && typeof data.appearance === 'object' && !Array.isArray(data.appearance)) {
        const appearance = { ...data.appearance };
        let changed = false;
        if (appearance.cardPadding !== undefined && appearance.cardPaddingY === undefined) {
            appearance.cardPaddingY = appearance.cardPadding;
            delete appearance.cardPadding;
            changed = true;
        }
        if (appearance.cardPaddingH !== undefined && appearance.cardPaddingX === undefined) {
            appearance.cardPaddingX = appearance.cardPaddingH;
            delete appearance.cardPaddingH;
            changed = true;
        }
        if (changed) updates.appearance = appearance;
    }

    if (Array.isArray(data.deletedStreamers)) {
        updates.deletedStreamers = data.deletedStreamers.map(Number).filter(Number.isFinite);
    }

    if (typeof data.refreshInterval === 'number' && data.refreshInterval < MIN_REFRESH_INTERVAL) {
        updates.refreshInterval = MIN_REFRESH_INTERVAL;
    }

    // --- v2 -> v3: preference codes -> alertScope ---

    // Only translate when legacy preferences actually exist. A fresh install has
    // no schemaVersion either, so it reaches this function too — deriving a
    // scope from absent codes there would quietly override DEFAULT_ALERT_SCOPE.
    const hasLegacyPrefs = data.notificationPreference !== undefined
        || data.browserNotificationPreference !== undefined
        || data.browserNotificationsEnabled !== undefined;

    if (data.alertScope === undefined && hasLegacyPrefs) {
        // Honour the v1 boolean kill switch and the old defaults
        // ('2' for the badge, '1' for desktop notifications).
        const badgeCode = data.notificationPreference ?? '2';
        let notifyCode = data.browserNotificationPreference;
        if (notifyCode === undefined) {
            const enabled = data.browserNotificationsEnabled !== false;
            notifyCode = enabled ? (data.notificationPreference ?? '1') : '0';
        }
        updates.alertScope = {
            badge: sourceSet(PREF_TO_SOURCES[badgeCode] ?? PREF_TO_SOURCES['2']),
            notify: sourceSet(PREF_TO_SOURCES[notifyCode] ?? PREF_TO_SOURCES['1'])
        };
    }

    // Force a silent seed on the first cycle after upgrading: the scope changed
    // shape, so the previous diff baseline can no longer be trusted.
    updates.seedSignature = '';
    updates.schemaVersion = STORAGE_VERSION;

    await chrome.storage.local.set(updates);
    await chrome.storage.local.remove([
        'browserNotificationsEnabled',
        'openTabsOnNotificationClick',
        'monitorMode',
        'notificationPreference',
        'browserNotificationPreference'
    ]);
    return true;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Validate each element's shape, dropping malformed entries instead of
 * rejecting the whole array. normalizeStreamer() already tolerates missing
 * fields (defaults them), so the only thing that makes an entry unusable is
 * a uid that cannot be read as a number.
 */
function sanitizeCustomStreamers(value) {
    if (!Array.isArray(value)) return undefined;
    return value
        .map(normalizeStreamer)
        .filter(s => s && Number.isFinite(s.uid));
}

/** Drop any mark that is not one of the two recognized values. */
function sanitizeStreamerStates(value) {
    if (!isPlainObject(value)) return undefined;
    const out = {};
    for (const [uid, mark] of Object.entries(value)) {
        if (mark === 'favorite' || mark === 'like') out[uid] = mark;
    }
    return out;
}

/**
 * Clamp every numeric field to the same range its slider enforces
 * (APPEARANCE_RANGES, mirrored from popup/popup.html). A field that is
 * present but not coercible to a finite number is dropped rather than
 * clamped, so the read side falls back to DEFAULT_APPEARANCE for it.
 */
function sanitizeAppearance(value) {
    if (!isPlainObject(value)) return undefined;
    const out = { ...value };
    for (const [key, { min, max }] of Object.entries(APPEARANCE_RANGES)) {
        if (!(key in out)) continue;
        const n = Number(out[key]);
        if (Number.isFinite(n)) out[key] = Math.min(max, Math.max(min, n));
        else delete out[key];
    }
    return out;
}

/** Validate and normalize one imported value; undefined = rejected. */
function sanitizeImportValue(key, value) {
    switch (key) {
        case 'customStreamers':
            return sanitizeCustomStreamers(value);
        case 'streamerStates':
            return sanitizeStreamerStates(value);
        case 'deletedStreamers':
            return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : undefined;
        case 'alertScope':
            // Coerced to the full shape; unknown keys are dropped.
            return isPlainObject(value) ? normalizeAlertScope(value) : undefined;
        case 'viewMode':
            return Object.values(ViewMode).includes(value) ? value : undefined;
        case 'refreshInterval': {
            const n = Number(value);
            return Number.isFinite(n) ? Math.max(MIN_REFRESH_INTERVAL, n) : undefined;
        }
        case 'previewMode':
            return Object.values(PreviewMode).includes(value) ? value : undefined;
        case 'previewSound':
            return typeof value === 'boolean' ? value : undefined;
        case 'previewVolume': {
            const n = Number(value);
            return Number.isFinite(n) ? n : undefined;
        }
        case 'appearance':
            return sanitizeAppearance(value);
        default:
            return undefined;
    }
}

/**
 * Import a config object: whitelisted settings keys only, per-key type
 * validation. Importing an alertScope changes what alerts you, so the seed
 * signature is cleared alongside it and the next cycle re-seeds silently.
 * @param {Object} jsonObj parsed JSON
 * @returns {Promise<string[]>} keys actually written
 * @throws {Error} if jsonObj is not a plain object
 */
export async function importConfig(jsonObj) {
    if (!isPlainObject(jsonObj)) {
        throw new Error('Invalid config: expected a JSON object');
    }
    const updates = {};
    for (const key of SETTINGS_KEYS) {
        if (!(key in jsonObj)) continue;
        const value = sanitizeImportValue(key, jsonObj[key]);
        if (value !== undefined) updates[key] = value;
    }
    const written = Object.keys(updates);
    if (written.length > 0) {
        if ('alertScope' in updates) updates.seedSignature = '';
        await chrome.storage.local.set(updates);
    }
    return written;
}

/**
 * Build the export object: settings keys only, plus schemaVersion.
 * @param {Object} state full state (e.g. from getState())
 */
export function exportConfig(state) {
    const out = {};
    for (const key of SETTINGS_KEYS) {
        if (state && state[key] !== undefined) out[key] = state[key];
    }
    out.schemaVersion = STORAGE_VERSION;
    return out;
}
