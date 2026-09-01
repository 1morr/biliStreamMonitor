// Regenerate the README screenshots from entirely fabricated data.
// No Bilibili account, no network access, and no real streamer names or uids:
// every avatar is a generated gradient and every API call is stubbed, so the
// output can be committed to a public repo without leaking anything.
//
//   npm run screenshots        # writes docs/images/{popup,settings}.png
import { chromium } from 'playwright';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import zlib from 'node:zlib';
import os from 'node:os';

const ext = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3]);
// The throwaway browser profile must not land next to the committed PNGs.
const profile = path.join(os.tmpdir(), 'bsm-screenshot-profile');
mkdirSync(out, { recursive: true });

// Invented streamers. Names are deliberately generic English/roman so nothing
// resembles a real Bilibili account.
const AREAS = ['Just Chatting', 'Valorant', 'Minecraft', 'Music', 'Art', 'Variety'];
const NAMES = [
  'Aurora Lab', 'Pixel Kitchen', 'Night Owl Radio', 'Studio Nine', 'Cobalt',
  'Paper Lantern', 'Quiet Hours', 'Moss & Stone', 'Rainy Window', 'Tin Robot',
  'Field Notes', 'Slow Motion', 'Blue Hour', 'Ninth Wave', 'Paper Crane',
];
const TITLES = [
  'building the thing, day 12',
  'ranked until we win one',
  'late night listening',
  'redstone contraption from scratch',
  'sketching requests',
  'catching up on the backlog',
  'first playthrough, no spoilers please',
  'lo-fi and homework',
];

function streamer(i, { live, medal, custom }) {
  return {
    uid: 100000 + i,
    roomId: 20000 + i,
    uname: NAMES[i % NAMES.length],
    face: `https://i0.hdslb.com/demo/face${i % 6}.png`,
    liveStatus: live ? 1 : 0,
    title: live ? TITLES[i % TITLES.length] : '',
    cover: `https://i0.hdslb.com/demo/cover${i % 6}.png`,
    area: AREAS[i % AREAS.length],
    medalName: medal ? ['STUDIO', 'AURORA', 'LANTERN', 'COBALT'][i % 4] : null,
    medalLevel: medal ? [21, 18, 14, 9, 6][i % 5] : null,
    isCustom: !!custom,
  };
}

const streamingInfo = [
  streamer(0, { live: true, medal: true }),
  streamer(1, { live: true, medal: true }),
  streamer(2, { live: true, custom: true }),
  streamer(3, { live: true }),
  streamer(4, { live: true }),
  streamer(5, { live: true, medal: true }),
  streamer(6, { live: false, medal: true }),
  streamer(7, { live: false, custom: true }),
  streamer(8, { live: true }),
  streamer(9, { live: false, medal: true }),
  streamer(10, { live: true, medal: true }),
  streamer(11, { live: true }),
];

const seed = {
  streamingInfo,
  streamerStates: { 100003: 'favorite', 100011: 'favorite', 100004: 'like', 100008: 'like' },
  customStreamers: [
    { uid: 100002, roomId: 20002, uname: NAMES[2] },
    { uid: 100007, roomId: 20007, uname: NAMES[7] },
  ],
  alertScope: {
    badge: { medal: true, custom: true, fav: true, like: true, rest: false },
    notify: { medal: false, custom: true, fav: true, like: false, rest: false },
  },
  viewMode: 'alert',
  appearance: { width: 620, height: 470, avatarSize: 64, gapX: 12, gapY: 14,
                cardPaddingX: 8, cardPaddingY: 8, fontSize: 13 },
  lastError: null,
  refreshInterval: 60,
  previewMode: 'thumbnail',
  lastUpdate: Date.now(),
  seedSignature: 'demo',
};

// 1x1 coloured PNGs stand in for avatars and covers, so nothing is fetched.
const SWATCHES = ['4C6EF5', 'F76707', '37B24D', 'AE3EC9', '1098AD', 'E8590C'];
function pngFor(hex) {
  // Minimal solid-colour PNG generated on the fly via a data URL canvas is not
  // available outside a page, so use a tiny fixed PNG and let CSS size it.
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  // Build a 1x1 PNG.
  const N = 64;
  const rows = [];
  for (let y = 0; y < N; y++) {
    const row = [0];
    for (let x = 0; x < N; x++) {
      const t = (x + y) / (2 * N);          // diagonal ramp
      const k = 0.75 + 0.45 * t;
      row.push(Math.min(255, Math.round(r * k)),
               Math.min(255, Math.round(g * k)),
               Math.min(255, Math.round(b * k)), 255);
    }
    rows.push(Buffer.from(row));
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crcTable = pngFor.crc || (pngFor.crc = (() => {
      const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t;
    })());
    let crc = 0xffffffff;
    for (const byte of td) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    const c = Buffer.alloc(4); c.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(64, 0); ihdr.writeUInt32BE(64, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  locale: 'en-US',
  viewport: { width: 620, height: 470 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--lang=en-US'],
});

// Every image request resolves to a local swatch; nothing leaves the machine.
await context.route(/hdslb\.com/, (route) => {
  const m = /(?:face|cover)(\d)/.exec(route.request().url());
  route.fulfill({ contentType: 'image/png', body: pngFor(SWATCHES[m ? +m[1] : 0]) });
});
await context.route(/api\.live\.bilibili\.com|api\.bilibili\.com/, (route) =>
  route.fulfill({ json: { code: 0, data: {} } }));

let [sw] = context.serviceWorkers();
if (!sw) sw = await context.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
console.log('extension id:', extId);

// Stop the refresh cycle before seeding. Otherwise the install-time cycle races
// us, fails against the stubbed API, and overwrites the fixture with an error
// state — which is exactly what the first attempt at this screenshot captured.
await sw.evaluate(async () => {
  await chrome.alarms.clearAll();
});
await new Promise((r) => setTimeout(r, 1500));

await sw.evaluate(async (data) => {
  await chrome.alarms.clearAll();
  await chrome.storage.local.clear();
  await chrome.storage.local.set(data);
}, seed);

const page = await context.newPage();
await page.goto(`chrome-extension://${extId}/popup/popup.html`);
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(out, 'popup.png') });
console.log('wrote popup.png');

// Open the settings panel via its gear button.
const gear = page.locator('#settings-btn, .settings-btn, [id*="setting"]').first();
if (await gear.count()) {
  await gear.click({ force: true });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(out, 'settings.png') });
  console.log('wrote settings.png');
} else {
  console.log('WARN: settings button not found; selector needs updating');
}

await context.close();
