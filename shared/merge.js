// Shared module: normalize + merge mode streamer list with custom rooms (single source of truth)
import { normalizeImageUrl } from './api.js';

/**
 * Normalize a streamer entry into the canonical Streamer shape (see shared/api.js typedef).
 * Tolerates legacy field names from storage schema v1:
 *   streamer_name -> uname, streamer_icon/target_icon -> face,
 *   live_status -> liveStatus, medal_name -> medalName, medal_level -> medalLevel,
 *   _custom -> isCustom. Idempotent for entries already in the new shape.
 */
export function normalizeStreamer(raw) {
  if (!raw) return null;
  const roomId = Number(raw.roomId) || parseRoomIdFromLink(raw.link) || 0;
  return {
    uid: Number(raw.uid),
    roomId,
    uname: raw.uname ?? raw.streamer_name ?? '',
    face: normalizeImageUrl(raw.face ?? raw.streamer_icon ?? raw.target_icon ?? ''),
    liveStatus: raw.liveStatus ?? raw.live_status ?? 0,
    title: raw.title ?? '',
    cover: normalizeImageUrl(raw.cover ?? ''),
    area: raw.area ?? '',
    medalName: raw.medalName ?? raw.medal_name ?? null,
    medalLevel: raw.medalLevel ?? raw.medal_level ?? null,
    isCustom: Boolean(raw.isCustom ?? raw._custom ?? false)
  };
}

function parseRoomIdFromLink(link) {
  const m = /live\.bilibili\.com\/(\d+)/.exec(link || '');
  return m ? Number(m[1]) : 0;
}

/**
 * Merge mode list (medal wall / following) with custom rooms.
 * Mode list takes priority on uid conflicts; custom entries are flagged isCustom.
 * Hidden (deleted) filtering stays with the consumers (render / badge / notify),
 * matching the original behavior.
 */
export function mergeStreamers(streamers, customStreamers) {
  const primary = (streamers || []).map(normalizeStreamer).filter(Boolean);
  const seen = new Set(primary.map(s => String(s.uid)));
  const customs = (customStreamers || [])
    .filter(c => !seen.has(String(c.uid)))
    .map(c => {
      const n = normalizeStreamer(c);
      if (n) n.isCustom = true;
      return n;
    })
    .filter(Boolean);
  return [...primary, ...customs];
}
