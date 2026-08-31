// Background service worker entry: wires alarms, message routing, and notification handlers.

import { ALARM_NAME, MIN_REFRESH_INTERVAL } from '../shared/constants.js';
import { getState } from '../shared/storage.js';
import { runUpdateCycle, fetchFollowingSnapshot } from './poller.js';
import { registerNotificationHandlers } from './notify.js';

registerNotificationHandlers();

/** (Re)create the refresh alarm from the stored interval (clamped to the minimum). */
async function rebuildAlarm() {
    const { refreshInterval } = await getState(['refreshInterval']);
    const interval = Math.max(MIN_REFRESH_INTERVAL, Number(refreshInterval) || 0);
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval / 60 });
}

// Both install and startup rebuild the alarm from storage (audit #2: the old
// onInstalled hardcoded 1 minute and silently overrode the user's interval).
chrome.runtime.onInstalled.addListener(() => {
    rebuildAlarm()
        .then(() => runUpdateCycle('alarm')) // one initial cycle on install/update
        .catch(e => console.error('Initial setup failed:', e));
});

chrome.runtime.onStartup.addListener(() => {
    // Do not run a cycle here; the alarm fires soon enough and restores the badge.
    rebuildAlarm().catch(e => console.error('Alarm rebuild failed:', e));
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) {
        runUpdateCycle('alarm').catch(e => console.error('Alarm cycle failed:', e));
    }
});

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
    const action = req && (req.action || req.type);

    if (action === 'updateStreamers') {
        runUpdateCycle('message')
            .then(result => sendResponse(result))
            .catch(e => sendResponse({ ok: false, reason: 'internal', message: String(e) }));
        return true; // async response: keep the port open
    }

    // Popup asking for the "all" view's data. On success it writes
    // followingCache only; a risk-control failure shares the cycle's backoff.
    if (action === 'fetchFollowing') {
        fetchFollowingSnapshot()
            .then(result => sendResponse(result))
            .catch(e => sendResponse({ ok: false, reason: 'internal', message: String(e) }));
        return true;
    }

    if (action === 'setRefreshInterval') {
        const interval = Number(req.interval);
        if (!Number.isFinite(interval) || interval < MIN_REFRESH_INTERVAL) {
            sendResponse({ ok: false, reason: 'invalidInterval' });
            return false;
        }
        chrome.alarms.create(ALARM_NAME, { periodInMinutes: interval / 60 })
            .then(() => sendResponse({ ok: true })) // audit #11: old handler left the port hanging
            .catch(e => sendResponse({ ok: false, reason: 'alarm', message: String(e) }));
        return true;
    }

    return false;
});
