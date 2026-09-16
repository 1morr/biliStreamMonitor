# Privacy

BiliStreamMonitor runs entirely inside your browser. There is no server behind
it, no account, and no build step — the source in this repository is what runs.
Everything below is a statement about code you can read here; file references
point at the exact place.

## What it reads

- **One cookie: `DedeUserID` on `https://www.bilibili.com`.** `shared/api.js`
  calls `chrome.cookies.get({ url: 'https://www.bilibili.com', name:
  'DedeUserID' })` and reads no other cookie anywhere in the extension. That
  value is your own numeric Bilibili user id. It is used as the `target_id`
  query parameter of the medal-wall request and for nothing else — it is not
  written to storage and not sent to any host other than Bilibili.
- **Your Bilibili session, implicitly.** The API calls in `shared/api.js` use
  `fetch(url, { credentials: 'include' })`, so Chrome attaches the cookies it
  already holds for `bilibili.com` — the same ones bilibili.com receives when
  you browse it yourself. That is what makes "your follow list" mean *yours*.
  Those cookies are sent by the browser to Bilibili and to no one else.

## Which endpoints it calls

All API calls go to `https://api.live.bilibili.com` (`API_BASE` in
`shared/constants.js`); `shared/api.js` contains every call site:

| Endpoint | When |
|---|---|
| `/xlive/web-ucenter/user/MedalWall` | every refresh cycle |
| `/room/v1/Room/get_status_info_by_uids` | every cycle, for the uids currently in scope |
| `/xlive/web-ucenter/user/following` | only when **All other follows** is ticked, or when you open the "everything live" view |
| `/room/v1/Room/get_info` | hovering a live card, and adding a custom room |
| `/live_user/v1/Master/info` | resolving a custom room's streamer name |

Two other kinds of Bilibili traffic:

- **Images.** Avatars and stream covers come from the `hdslb.com` CDN.
  Notification icons are fetched with `credentials: 'omit'` and
  `referrerPolicy: 'no-referrer'` (`background/notify.js`), and the popup's
  `<img>` tags carry `referrerpolicy="no-referrer"` (`popup/cards.js`,
  `popup/settings.js`) — so those image requests carry no cookies and no
  referrer.
- **The hover preview.** In live-player mode the popup embeds
  `https://www.bilibili.com/blackboard/live/live-activity-player.html` in an
  iframe (`popup/preview.js`), only while you are hovering a live card.

`manifest.json` declares exactly two host permissions, `https://*.bilibili.com/*`
and `https://*.hdslb.com/*`. No other host appears anywhere in the code.

## Where the data goes

Only to your own machine and to Bilibili.

- **Local storage only.** Settings, marks, hidden list, custom rooms and the
  last known stream states live in `chrome.storage.local` (`shared/storage.js`).
  `chrome.storage.sync` is not used anywhere, so nothing is uploaded to your
  Google account or copied to your other devices.
- **Export is a plain file save.** The export button builds a JSON `Blob` and
  triggers a normal browser download (`popup/settings.js`); the file goes
  wherever you save it. It contains settings only — custom rooms, marks, hidden
  list, alert scope, view mode, refresh interval, preview options, appearance —
  because `exportConfig` copies a fixed `SETTINGS_KEYS` allowlist and
  deliberately leaves runtime state out (`shared/storage.js`).
- **The content script is narrow.** It runs on one URL pattern, the Bilibili
  live-activity player page (`manifest.json` → `content_scripts.matches`), and
  acts only on `postMessage` events whose `event.origin` is this extension's own
  id, which it uses to sync mute and volume (`content_script.js`).

## What is not collected

- No analytics, telemetry, crash or usage reporting. There is no `sendBeacon`,
  no `WebSocket`, no reporting endpoint in the codebase.
- No third-party servers. The author receives nothing — there is nowhere for it
  to be sent to.
- No remote code. The icons in the popup are an inline SVG sprite rather than a
  CDN stylesheet (`popup/popup.html`), and `manifest.json` declares no
  `externally_connectable` and loads no remote script.

## Revoking access

- **Cut off site access:** `chrome://extensions` → BiliStreamMonitor →
  **Details** → **Site access**. Without access to `bilibili.com` the extension
  can no longer query anything.
- **Remove it:** `chrome://extensions` → **Remove**. Chrome discards the
  extension together with its `chrome.storage.local` area; a JSON file you
  exported yourself stays where you saved it.
- The `cookies` permission is granted at install time and Chrome offers no way
  to revoke it on its own — uninstalling is how you take it back.
