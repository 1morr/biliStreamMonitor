// Shared module: Bilibili live API wrappers with normalized shapes and risk-control detection.

import { API_BASE, BATCH_UID_LIMIT, MAX_FOLLOW_PAGES } from './constants.js';

/**
 * Normalized streamer shape used across the extension.
 * @typedef {Object} Streamer
 * @property {number} uid
 * @property {number} roomId
 * @property {string} uname
 * @property {string} face
 * @property {number} liveStatus 0 = offline, 1 = live, 2 = replay/round-robin
 * @property {string} title
 * @property {string} cover
 * @property {string} area
 * @property {string|null} medalName
 * @property {number|null} medalLevel
 */

export class BiliApiError extends Error {
    /**
     * @param {string} message
     * @param {Object} [options]
     * @param {number|null} [options.code] Bilibili error code (e.g. -101, -412)
     * @param {number|null} [options.httpStatus] HTTP status when transport failed
     * @param {boolean} [options.isRiskControl] true for code -412/-352 or v_voucher responses
     * @param {boolean} [options.isAuth] true for code -101 or missing login cookie
     */
    constructor(message, { code = null, httpStatus = null, isRiskControl = false, isAuth = false } = {}) {
        super(message);
        this.name = 'BiliApiError';
        this.code = code;
        this.httpStatus = httpStatus;
        this.isRiskControl = isRiskControl;
        this.isAuth = isAuth;
    }
}

/**
 * Shared fetch wrapper. Accepts an API path ('/room/v1/...') or a full https URL.
 * Returns json.data on success; throws BiliApiError otherwise.
 */
export async function fetchBili(path) {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
        throw new BiliApiError(`HTTP ${response.status}`, { httpStatus: response.status });
    }
    const json = await response.json();
    if (json.code !== 0) {
        const code = typeof json.code === 'number' ? json.code : null;
        throw new BiliApiError(json.message || `API error (code ${json.code})`, {
            code,
            isRiskControl: code === -412 || code === -352,
            isAuth: code === -101
        });
    }
    // code 0 + v_voucher is a silent risk-control challenge, treat as failure
    if (json.data && json.data.v_voucher) {
        throw new BiliApiError('Risk control challenge (v_voucher)', { code: 0, isRiskControl: true });
    }
    return json.data;
}

/** Normalize an image URL: force https, empty value -> ''. */
export function normalizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    return url.replace(/^http:\/\//i, 'https://');
}

/** Parse the numeric room id out of a MedalWall link (live.bilibili.com/<room>?...). */
function parseRoomIdFromLink(link) {
    const m = String(link || '').match(/live\.bilibili\.com\/(\d+)/);
    return m ? Number(m[1]) : 0;
}

/** Current user's uid from the DedeUserID cookie (.bilibili.com), or null. */
export async function getTargetUid() {
    try {
        const cookie = await chrome.cookies.get({ url: 'https://www.bilibili.com', name: 'DedeUserID' });
        if (!cookie || !cookie.value) return null;
        const uid = parseInt(cookie.value, 10);
        return Number.isFinite(uid) ? uid : null;
    } catch (e) {
        console.error('Cookie error:', e);
        return null;
    }
}

/**
 * Medal wall -> Streamer[]. No pagination server-side.
 * @param {number} [uid] target user uid; defaults to the logged-in user
 */
export async function fetchMedalWall(uid) {
    const targetUid = uid ?? await getTargetUid();
    if (!targetUid) throw new BiliApiError('Not logged in', { isAuth: true });
    const data = await fetchBili(`/xlive/web-ucenter/user/MedalWall?target_id=${targetUid}`);
    const list = (data && data.list) || [];
    return list.map(m => ({
        uid: m.medal_info.target_id,
        roomId: parseRoomIdFromLink(m.link),
        uname: m.target_name || '',
        face: normalizeImageUrl(m.target_icon),
        liveStatus: m.live_status,
        title: '',
        cover: '',
        area: '',
        medalName: m.medal_info.medal_name || null,
        medalLevel: m.medal_info.level ?? null
    }));
}

function normalizeFollowingItem(item) {
    return {
        uid: item.uid,
        roomId: item.roomid,
        uname: item.uname || '',
        face: normalizeImageUrl(item.face),
        liveStatus: item.live_status,
        title: item.title || '',
        cover: normalizeImageUrl(item.room_cover),
        area: item.area_name_v2 || '',
        medalName: null,
        medalLevel: null
    };
}

/**
 * Paged following list, collecting only live_status === 1 entries.
 * Live entries are sorted first, so a page without any live entry ends the scan.
 * @returns {{live: Streamer[], liveCount: number, totalFollows: number, truncated: boolean}}
 */
export async function fetchFollowingLive({ pageSize = 29, maxPages = MAX_FOLLOW_PAGES } = {}) {
    const live = [];
    let liveCount = 0;
    let totalFollows = 0;
    let truncated = false;

    for (let page = 1; page <= maxPages; page++) {
        const data = await fetchBili(
            `/xlive/web-ucenter/user/following?page=${page}&page_size=${pageSize}&ignoreRecord=1&hit_ab=true`
        );
        if (page === 1) {
            liveCount = data?.live_count ?? 0;
            totalFollows = data?.count ?? 0;
        }
        const list = (data && data.list) || [];
        if (list.length === 0) break; // out-of-range page: code 0 with empty list

        const liveItems = list.filter(item => item.live_status === 1);
        live.push(...liveItems.map(normalizeFollowingItem));

        if (liveItems.length === 0) break;   // no more live entries past this page
        if (page === maxPages) truncated = true; // hit the page cap with live entries remaining
    }

    return { live, liveCount, totalFollows, truncated };
}

/**
 * Batch room status by uids. Splits into chunks of BATCH_UID_LIMIT and fetches
 * in parallel. Uids without a room are silently omitted by the API and will not
 * appear in the result.
 * @param {number[]} uids
 * @returns {Promise<Map<number, {roomId: number, uname: string, face: string, title: string,
 *   cover: string, liveStatus: number, liveTime: number|null, online: number, area: string}>>}
 */
export async function fetchRoomStatusByUids(uids) {
    const unique = [...new Set((uids || []).map(Number).filter(Number.isFinite))];
    const batches = [];
    for (let i = 0; i < unique.length; i += BATCH_UID_LIMIT) {
        batches.push(unique.slice(i, i + BATCH_UID_LIMIT));
    }

    const results = await Promise.all(batches.map(batch => {
        const qs = batch.map(u => `uids[]=${encodeURIComponent(u)}`).join('&');
        return fetchBili(`/room/v1/Room/get_status_info_by_uids?${qs}`);
    }));

    const map = new Map();
    for (const data of results) {
        if (!data) continue;
        for (const [uidKey, info] of Object.entries(data)) {
            map.set(Number(uidKey), {
                roomId: info.room_id,
                uname: info.uname || '',
                face: normalizeImageUrl(info.face),
                title: info.title || '',
                cover: normalizeImageUrl(info.cover_from_user || info.keyframe),
                liveStatus: info.live_status,
                liveTime: info.live_time ?? null,
                online: info.online ?? 0,
                area: info.area_v2_name || ''
            });
        }
    }
    return map;
}

/** Single room info (short id accepted). Note: response has no uname. */
export async function fetchRoomInfo(roomId) {
    return fetchBili(`/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`);
}

/** Streamer master info: data.info = { uname, face, ... }. */
export async function fetchMasterInfo(uid) {
    return fetchBili(`/live_user/v1/Master/info?uid=${encodeURIComponent(uid)}`);
}
