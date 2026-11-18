# Guest App Contract: Guest Guide

**Feature**: [spec.md](../spec.md) · **Research**: [R3](../research.md#r3-guest-app-rendering),
[R9](../research.md#r9-offline-and-caching), [R10](../research.md#r10-guest-app-routes-and-language),
[R15](../research.md#r15-security-headers-for-the-guest-app)

The guest app (`apps/guide`) serves HTML pages, static files, and the service worker on the guide
origin. `/api/v1/guest/*` on the same origin goes to the API (contracts/http-api.md).

## Pages

| Path | Cache-Control | Content |
|---|---|---|
| `/` | `public, s-maxage=3600` | "Guides open from your host's link", in the browser's language |
| `/g/{publicId}` | `private, no-store` | `302` to `/g/{publicId}/{lang}` (cookie `guidesk_lang`, else `Accept-Language`) |
| `/g/{publicId}/{lang}` | public guide (below) | Guide home (`G-01`): property name, stay card slot, section tiles, Emergency, language switch |
| `/g/{publicId}/{lang}/{sectionId}` | public guide | Section page (`G-02`, `G-03` for Arrival) |
| `/g/{publicId}/{lang}/emergency` | public guide | Emergency (`G-11`): local number and the Emergency section |
| `/s/{token}` | `no-store` | Exchange page (research R5); never looks the token up |
| `/offline` | `public, max-age=86400` | Offline fallback for pages never opened |
| `/sw.js` | `no-cache` | Service worker, scope `/` |
| `/manifest.webmanifest` | `public, max-age=86400` | Name "Guidesk guide", icons, `display: standalone`, `start_url: /` |
| `/assets/{name}.{hash}.{js,css,svg,png}` | `public, max-age=31536000, immutable` | Script, styles, icons |

"Public guide" caching: `public, max-age=0, s-maxage=60, stale-while-revalidate=300,
stale-if-error=86400`. An unavailable guide answers `404` with the unavailable page (`G-13`) and
`public, s-maxage=60`.

A language the guide does not publish answers `302` to the primary language's page. An unknown
section answers `404` with the unavailable page.

## Headers on every response

- `Content-Security-Policy` as in research R15 (`script-src 'self'`, no inline script or style).
- `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options:
  nosniff`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` with every feature off,
  `Strict-Transport-Security` on HTTPS.

## Page structure the browser script relies on

- `<html lang data-public-id data-lang data-offline-at="">`.
- Locked fields: `<div class="locked" data-field-id data-kind>` with `data-` attributes holding the
  localized texts for every state (`data-text-public`, `data-text-before`, `data-text-ended`,
  `data-text-offline`, `data-text-show`, `data-text-showing`, `data-text-error`, `data-text-verify`,
  `data-text-locked`, `data-text-viewed`). Without the script, the public text shows.
- Stay card slot: `<section id="stay-card" hidden data-…>` filled from `GET /api/v1/guest/session`.
- Notice slot for "This stay link has ended" and "device limit" (read once from `sessionStorage`).
- Offline banner: `<div id="offline-banner" hidden data-text>`.

## Browser script (budget 15 KB gzip)

1. Reads `/api/v1/guest/session` (no-store) and updates the stay card and every locked field.
2. Show code: `POST /api/v1/guest/reveals`; shows the value large with a Copy button and
   `aria-label` spelling it character by character; clears it after 5 minutes hidden.
3. Confirmation form (`G-04`): `POST /api/v1/guest/verify`; countdown on `423`.
4. Language switch: sets `guidesk_lang` before following the link.
5. Open count: `POST /api/v1/guest/opens` once per link per day (`localStorage` date).
6. Registers `/sw.js`; shows the offline banner when `data-offline-at` is set.

## Service worker rules

| Request | Strategy |
|---|---|
| Navigation to `/g/…` | Network first (4 s), then cache; store the response if `200` and not `no-store`; mark cached copies with `data-offline-at` |
| Navigation elsewhere | Network, falling back to `/offline` |
| `/assets/…` | Cache first |
| `/api/v1/guest/media/…` | Cache first by request URL; store opaque or `200` responses |
| Any other `/api/v1/guest/…` | Network only, never stored |
| `404` from the network for `/g/{publicId}/…` | Delete that guide's cached pages and media |
