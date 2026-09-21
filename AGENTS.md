# AGENTS.md — biliStreamMonitor

Chrome MV3 extension (plain JS, no build step): a service worker polls Bilibili's
live APIs and files streamers into five exclusive alert-source buckets
(medal wall / custom room / marked-favorite / marked-like / every other follow).
Badge counts and desktop notifications are two independent channels over those
buckets — "who I follow" and "who may interrupt me" are deliberately separate.

## Hard constraints

- **No build step, no dependencies.** ES modules with `"type": "module"` in the
  service worker; icons are vendored under `vendor/fontawesome/` (no CDN).
- `shared/scope.js` is the single source of truth for bucketing and scope
  predicates — never re-derive "which bucket is this streamer in" elsewhere.
  The v3.0 audit already had to fix one round of that logic drifting across
  three copies.
- `npm test` (`node --test`) is the gate; it covers the modules that actually
  break (`shared/scope.js` etc.). Run it before pushing.
- Minimal permissions: cookies / storage / alarms / notifications, no
  `<all_urls>`. `PRIVACY.md` documents the data flow endpoint by endpoint —
  update it whenever a new endpoint or permission appears.
- Docs are zh-Hant except `PRIVACY.md` (English, it is the disclosure document).

## Layout

- `background/` — service worker: poller, notifier.
- `popup/` — the popup UI (cards, settings matrix).
- `shared/` — api / constants / scope / merge / storage / i18n, used by both.
- `docs/api.md` — Bilibili live API reconnaissance (endpoint shapes and limits).
  Written before the v3.0 restructure; file paths in it are old, the endpoints
  are still current.
- `scripts/screenshots.mjs` — regenerates the README screenshots.

## Conventions

- Commits: Conventional Commits, English. i18n keys change in all three locales
  (`en`, `zh_CN`, `zh_TW`) together.
