# HTTP API: Service Catalog and Host Add-on Requests

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

Conventions as in specs 004 to 009.

## Guest routes (guide origin)

### `GET /api/v1/guest/guides/{publicId}/extras?lang=es|en`

Public, `s-maxage=60`. `200 { "extras": [GuestExtra] }`, visible extras in order:

```json
{
  "id": "uuid",
  "name": "Recogida en el aeropuerto",
  "description": "…",
  "language": "es",
  "price": 85,
  "currency": "USD",
  "leadTimeHours": 24,
  "needsDate": true,
  "needsTime": true,
  "dateRange": "before_arrival",
  "weekdays": [1, 2, 3, 4, 5, 6, 7],
  "maxPerStay": 1,
  "turnover": null
}
```

`GuestGuide.extras: { visible: boolean }` is added to the guide response.

### `GET /api/v1/guest/extras/requests?publicId=`

Stay session required. `no-store`. `200 { "canRequest": boolean, "reason": null | "no_session" |
"ended" | "verify", "requests": [GuestServiceRequest] }` where each request has `id`,
`extraId`, `name`, `price`, `currency`, `requestedDate`, `requestedTime`, `quantity`, `status`,
`reasonCode`, `reasonText`, `createdAt`. Without a session: `canRequest: false`, `reason:
"no_session"`, no requests.

### `POST /api/v1/guest/extras/requests`

Body `{ publicId, extraId, date?: "YYYY-MM-DD", time?: "HH:MM", quantity, note? }`. Stay session
required. `201` with the request (status `waiting` or `confirmed`). Errors: `401 no_session`, `409
verification_required`, `409 not_requestable` (window), `422 rule_failed { rule }` with `rule` in
`date_range`, `weekday`, `lead_time`, `max_per_stay`, `turnover`, `needs_date`, `needs_time`, `429
too_many_requests`, `409 duplicate`.

### `POST /api/v1/guest/extras/requests/{id}/cancel`

Body `{ publicId }`. Stay session of the request's stay required. `200` with the request; `409
not_waiting` when it isn't waiting.

## Member routes

### Catalog

- `GET /properties/{pid}/extras` → `{ extras: [MemberExtra], currencies: [..] }` (any member).
- `POST /properties/{pid}/extras` with an `ExtraInput` → `201 MemberExtra` (`properties.manage`).
- `PUT /properties/{pid}/extras/{extraId}` with `ExtraInput & { version }` → `200`; `409
  extra_changed`.
- `DELETE /properties/{pid}/extras/{extraId}` → `204`.
- `PUT /properties/{pid}/extras/order { ids: [uuid] }` → `200`.
- `POST /properties/{pid}/extras/{extraId}/copy { propertyIds: [uuid] }` → `200 { copied: n }`.

`ExtraInput`: `sourceLanguage`, `name { es?, en? }`, `description { es?, en? }`, `price`, `currency`,
`leadTimeHours`, `weekdays`, `needsDate`, `needsTime`, `dateRange`, `maxPerStay`, `preApproved`,
`turnover`, `visible`.

### Requests

- `GET /service-requests?status=waiting|confirmed|closed|all&propertyId=&before=` → `{ items:
  [MemberServiceRequest], next }`, waiting first by requested moment (any member). Each item adds the
  property name, the stay's dates, and the note.
- `POST /service-requests/{id}/confirm` → `200` (`conversations.handle`); `409 not_waiting`.
- `POST /service-requests/{id}/decline { reasonCode, reasonText? }` → `200`; `409 not_waiting`.
- `POST /service-requests/{id}/cancel { reasonCode, reasonText? }` → `200`; `409 not_confirmed`.

Another workspace's IDs: `404`, logged.
