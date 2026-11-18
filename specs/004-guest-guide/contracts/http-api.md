# HTTP API Contract: Guest Guide

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions and common errors**: [feature 001 contract](../../001-workspace-accounts/contracts/http-api.md#conventions) ·
[feature 003 contract](../../003-guide-builder/contracts/http-api.md)

Two groups of routes:

- **Guest routes** under `/api/v1/guest`, reached only through the guide origin (research R2). No
  member session; the guest session is the `__Host-guidesk_guest` cookie (`guidesk_guest` on local
  HTTP). The origin hook accepts the guide origin here and nowhere else.
- **Share routes** under `/api/v1/workspaces/{workspaceId}/properties/{propertyId}/share`, with the
  conventions of features 001 to 003 (problem+json, `404` for other workspaces, `step_up_required`,
  `429` with `Retry-After`).

Shapes are Zod schemas in `packages/contracts/src/guest.ts` and `packages/contracts/src/share.ts`.

## Guest routes

### Headers on every guest response

- `X-Robots-Tag: noindex, nofollow`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options:
  nosniff`, `Cross-Origin-Resource-Policy: same-origin`.
- `Cache-Control: no-store` unless a route below says otherwise (SEC-04).

### Errors

| HTTP | `code` | When |
|---|---|---|
| 404 | `unavailable` | Unknown, replaced, or unpublished link; property archived or deleted; workspace not `active`. Same body for every case (FR-011, FR-054) |
| 403 | `forbidden` | Wrong origin, or a state-changing call without the guide origin (AC-SEC-011) |
| 401 | `no_session` | A session route without a working session cookie |
| 409 | `not_in_window` | Reveal before or after the stay window. Body: `{state, opensAt?}` |
| 409 | `verification_required` | Reveal on a property that requires a code, from a device not verified |
| 422 | `invalid_code` | Wrong confirmation code. Body: `{attemptsLeft}` |
| 423 | `verification_locked` | The stay is locked. Body: `{retryAfterSeconds}`; header `Retry-After` |
| 429 | `rate_limited` | Per-IP, exchange, or reveal limit. Header `Retry-After` |

### `GET /api/v1/guest/guides/{publicId}?lang={es|en}`

The public guide for one language (research R11). Cacheable:
`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400`.

`200` `GuestGuide`:

```json
{
  "publicId": "k3v7…26 chars",
  "language": "en",
  "languages": ["es", "en"],
  "primaryLanguage": "es",
  "propertyName": "Casa Colibrí",
  "timeZone": "America/Costa_Rica",
  "country": "CR",
  "emergencyNumber": "911",
  "facts": { "checkInTime": "15:00", "checkoutTime": "11:00", "maxGuests": 4, "address": "…" },
  "publishedAt": "2026-11-17T20:00:00Z",
  "sections": [
    {
      "id": "uuid",
      "kind": "arrival",
      "title": null,
      "items": [
        {
          "id": "uuid",
          "kind": "text",
          "language": "en",
          "translated": true,
          "doc": { "type": "doc", "content": [] }
        },
        {
          "id": "uuid",
          "kind": "image",
          "media": { "url": "/api/v1/guest/media/{publicId}/{mediaId}/medium", "width": 1200, "height": 800, "alt": "…" }
        },
        {
          "id": "uuid",
          "kind": "recommendation",
          "recommendation": { "name": "…", "url": "https://…", "benefit": true }
        }
      ]
    }
  ],
  "lockedFields": [
    { "id": "uuid", "kind": "lockbox_code", "label": "Lockbox code", "set": true }
  ],
  "wifi": { "network": "CasaColibri", "password": "…public value or null…" }
}
```

- `translated: false` marks an item shown in its source language (FR-015).
- `lockedFields` never carries a value. `wifi.password` is present only when the host made it public
  (FR-018).
- `404 unavailable` for every unavailable case.

### `GET /api/v1/guest/media/{publicId}/{mediaId}/{variant}`

`variant` is one of the stored variants (`small`, `medium`, `large`, `poster`, `video`). `302` to a
presigned GET on the media bucket (5 minutes), `Cache-Control: public, max-age=60`. `404 unavailable`
when the media is not in the guide's published version.

### `POST /api/v1/guest/stay-sessions`

Exchanges a stay token for a device session (research R5). Body `{token}` (JSON) or
`token=…` (form, no-script fallback). Limits: 20 per IP per hour.

- `200` (JSON) or `303 Location: {guideUrl}` (form) with
  `Set-Cookie: __Host-guidesk_guest=…; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=…`:
  `{ "guideUrl": "/g/{publicId}", "notice": null | "ended" | "device_limit" }`.
  - `notice: "ended"`: the link stopped (revoked, replaced, cancelled stay, window closed); no cookie.
  - `notice: "device_limit"`: 10 devices already; no cookie.
- `404 unavailable`: unknown token, or the property's guide is unavailable.

### `GET /api/v1/guest/session?publicId={publicId}`

The device's state for this guide (research R6). `200` `GuestSession`:

```json
{
  "state": "public | before | inside | ended",
  "stay": { "checkInDate": "2026-12-12", "checkoutDate": "2026-12-15", "checkInTime": "15:00", "checkoutTime": "11:00" },
  "opensAt": "2026-12-12T06:00:00Z",
  "closesAt": "2026-12-15T19:00:00Z",
  "codeRequired": true,
  "verified": false,
  "lockedUntil": null
}
```

`stay` is present for `before` and `inside` only; no guest name or channel (FR-028). A session of
another property's stay answers `state: "public"`.

### `POST /api/v1/guest/verify`

Body `{publicId, code}`. `204` and the device is verified; `422 invalid_code` with `attemptsLeft`;
`423 verification_locked`; `401 no_session`; `409 not_in_window` (research R8).

### `POST /api/v1/guest/reveals`

Body `{publicId, fieldId}`. `200` `{ "value": "2704" }` with `Cache-Control: no-store` and
`Pragma: no-cache`. Errors: `401 no_session`, `409 not_in_window`, `409 verification_required`,
`404 unavailable` (field not in the published guide), `429 rate_limited` (30 per session per hour).

### `POST /api/v1/guest/opens`

Body `{publicId, kind: "property" | "stay"}`. `204`. Ignored for automated user agents. Limit 60 per
IP per hour (silently ignored above it).

## Share routes

Role columns: **O** owner, **A** admin, **Ag** agent. **SU** = re-authenticated within 10 minutes.

| Method and path (relative to `/share`) | O | A | Ag | SU | Notes |
|---|---|---|---|---|---|
| `GET /` | ✓ | ✓ | ✓ | | `ShareOverview`; agents get no `stays` and no `settings` |
| `GET /qr.svg`, `GET /qr.png` | ✓ | ✓ | ✓ | | QR of the property link; `Content-Disposition: attachment; filename="{property}-guide-qr.{ext}"` |
| `POST /property-link/regenerate` | ✓ | ✓ | | | Body `{confirm: true}`. Returns the new `propertyLink` |
| `PATCH /settings` | ✓ | ✓ | | | Body `{requireConfirmationCode: boolean}` |
| `POST /stays/{stayId}/link` | ✓ | ✓ | | ✓ | Creates the stay link if none is active and returns `{url, confirmationCode?}`; records `guide.stay_link_copied` |
| `POST /stays/{stayId}/link/regenerate` | ✓ | ✓ | | ✓ | Replaces the active link; returns the new `{url, confirmationCode?}` |
| `POST /stays/{stayId}/link/revoke` | ✓ | ✓ | | | `204` |
| `POST /stays/{stayId}/message` | ✓ | ✓ | | ✓ when `withValues` | Body `{language: "es" | "en", withValues: boolean}`. Returns `{text}` |

Feature-specific errors:

| HTTP | `code` | When |
|---|---|---|
| 409 | `guide_not_published` | Stay links, messages, and QR codes before the first publish |
| 409 | `stay_not_eligible` | Stay cancelled, hidden, or its window closed |
| 409 | `workspace_pending_deletion` | Any write while the workspace is pending deletion |

### `ShareOverview`

```json
{
  "published": true,
  "propertyLink": { "url": "https://guide…/g/k3v7…", "createdAt": "…" },
  "opensLast30Days": 34,
  "templates": { "es": "…", "en": "…" },
  "settings": { "requireConfirmationCode": false },
  "stays": [
    {
      "stayId": "uuid",
      "checkInDate": "2026-12-12",
      "checkoutDate": "2026-12-15",
      "channel": "Airbnb",
      "mayBeBlock": false,
      "link": {
        "status": "not_created | active | device_limit | revoked | ended",
        "devices": 2,
        "firstOpenedAt": "…",
        "valuesShown": 1,
        "lockedUntil": null,
        "lastCopiedAt": "…"
      }
    }
  ]
}
```

- `stays`: the property's stays whose window has not closed, not hidden, sorted by check-in date
  (FR-041). Cancelled stays with a link appear once with status `ended` until their window would
  have closed.
- The stay link URL and confirmation code are never in the overview; they come only from the
  step-up routes above.
