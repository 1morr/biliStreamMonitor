// Shared module: chrome.storage.local state access, schema v2 migration, config import/export.

import {
    STORAGE_DEFAULTS,
    MIN_REFRESH_INTERVAL,
    MonitorMode,
    NotifyPref
} from './constants.js';

export const STORAGE_VERSION = 2;

// Settings-type keys allowed in config import/export.
const SETTINGS_KEYS = Object.freeze([
    'monitorMode',
    'customStreamers',
    'streamerStates',
    'deletedStreamers',
    'notificationPreference',
    'browserNotificationPreference',
    'refreshInterval',
    'previewMode',
    'previewSound',
    'previewVolume',
    'appearance'
]);

/** Clone a mutable default so callers never share the frozen reference. */
function cloneDefault(value) {
    if (Array.isArray(value)) return value.slice();
    if (value !== null && typeof value === 'object') return { ...value };
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
 * Schema v2 migration, idempotent. Converges the legacy migrations previously
 * spread across background.js and popup.js:
 * - browserNotificationsEnabled (bool) -> browserNotificationPreference ('0'-'3')
 * - appearance.cardPadding -> cardPaddingY, cardPaddingH -> cardPaddingX
 * - deletedStreamers normalized to a Number array
 * - refreshInterval clamped to >= MIN_REFRESH_INTERVAL
 * - dead key openTabsOnNotificationClick removed
 * @returns {Promise<boolean>} true if a migration ran
 */
export async function migrateIfNeeded() {
    const data = await chrome.storage.local.get(null);
    if (typeof data.schemaVersion === 'number' && data.schemaVersion >= STORAGE_VERSION) {
        return false;
    }

    const updates = {};
    const removals = [];

    // Legacy boolean -> preference code (was background.js:127-132 / popup.js:92-98)
    if (data.browserNotificationPreference === undefined) {
        const enabled = data.browserNotificationsEnabled !== false;
        updates.browserNotificationPreference = enabled
            ? (data.notificationPreference || NotifyPref.FAVORITES)
            : NotifyPref.OFF;
    }
    removals.push('browserNotificationsEnabled');

    // Appearance key renames (was popup.js:103-111)
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

    // deletedStreamers -> Number array
    if (Array.isArray(data.deletedStreamers)) {
        updates.deletedStreamers = data.deletedStreamers.map(Number).filter(Number.isFinite);
    }

    // refreshInterval lower bound
    if (typeof data.refreshInterval === 'number' && data.refreshInterval < MIN_REFRESH_INTERVAL) {
        updates.refreshInterval = MIN_REFRESH_INTERVAL;
    }

    // Dead key from the old notification click mapping
    removals.push('openTabsOnNotificationClick');

    updates.schemaVersion = STORAGE_VERSION;

    await chrome.storage.local.set(updates);
    if (removals.length > 0) await chrome.storage.local.remove(removals);
    return true;
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Validate and normalize one imported value; undefined = rejected. */
function sanitizeImportValue(key, value) {
    switch (key) {
        case 'monitorMode':
            return Object.values(MonitorMode).includes(value) ? value : undefined;
        case 'customStreamers':
            return Array.isArray(value) ? value : undefined;
        case 'streamerStates':
            return isPlainObject(value) ? value : undefined;
        case 'deletedStreamers':
            return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : undefined;
        case 'notificationPreference':
        case 'browserNotificationPreference':
            return Object.values(NotifyPref).includes(value) ? value : undefined;
        case 'refreshInterval': {
            const n = Number(value);
            return Number.isFinite(n) ? Math.max(MIN_REFRESH_INTERVAL, n) : undefined;
        }
        case 'previewMode':
            return typeof value === 'string' ? value : undefined;
        case 'previewSound':
            return typeof value === 'boolean' ? value : undefined;
        case 'previewVolume': {
            const n = Number(value);
            return Number.isFinite(n) ? n : undefined;
        }
        case 'appearance':
            return isPlainObject(value) ? value : undefined;
        default:
            return undefined;
    }
}

/**
 * Import a config object: whitelisted settings keys only, per-key type
 * validation, deletedStreamers -> Number, refreshInterval clamped.
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
    if (written.length > 0) await chrome.storage.local.set(updates);
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
