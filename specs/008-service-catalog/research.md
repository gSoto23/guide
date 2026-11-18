# Research: Service Catalog and Host Add-on Requests

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-18

Decisions for spec 008, building on specs 002 to 007 and 009.

## R1. Catalog storage

- **Decision:** an `extra` table per property: names and descriptions as `{ es, en }` with a source
  language (missing translations fall back to it, as guide items do), price `numeric(10,2)` with an
  ISO 4217 currency from a supported list (USD, CRC, MXN, EUR, COP, GTQ), `lead_time_hours` (0 to 720),
  `weekdays` (ISO day numbers, default all), `needs_date`, `needs_time`, `date_range` (`stay` or
  `before_arrival`), `max_per_stay` (1 to 10), `pre_approved`, `turnover` (`early_check_in`,
  `late_checkout`, or none), `visible`, `position`, and a `version`. Copying to other properties
  inserts new rows; suggestions are static texts in the portal catalog, not rows.
- **Rationale:** FR-001 to FR-006; per-property rows match the rest of the product; copying keeps
  managers fast without a second level of settings.
- **Alternatives:** a workspace catalog with property assignment (more screens and override rules for
  the pilot's small catalogs).

## R2. Request rules

- **Decision:** a pure domain function checks a request against the extra, the stay, the property's
  time zone, the time, the stay's other requests, and the property's other stays. The requested
  moment is the requested date at the requested time (or 00:00 local when the extra has no time);
  `before_arrival` allows today to the check-in date, `stay` allows the check-in to the checkout date;
  the weekday must be offered; the moment minus the lead time must be after now; quantity plus the
  stay's waiting and confirmed quantity for the extra must not pass `max_per_stay`; turnover:
  `early_check_in` fails if another active stay of the property checks out on this stay's check-in
  date, `late_checkout` if another checks in on this stay's checkout date. The function returns the
  first failing rule as a code with a guest text per language. The expiry time is the moment minus the
  lead time, or 48 hours after the request when the extra has no date.
- **Rationale:** FR-010, FR-011, FR-018; testable without a database.

## R3. Guest routes and the stay session

- **Decision:** guest routes under `/api/v1/guest` (guide origin, spec 004):
  - `GET /guides/{publicId}/extras?lang=` is public (cacheable 60 s): visible extras.
  - `GET /extras/requests?publicId=` lists the stay's requests (`no-store`).
  - `POST /extras/requests` creates a request.
  - `POST /extras/requests/{id}/cancel` cancels a waiting request.
  The last three need the stay session cookie for that property (`GuestSessions.device`), a lock
  state of `before` or `inside`, and verification when the stay requires the code; the stay always
  comes from the session (AC-SEC-001, AC-SEC-002). Limits: 10 waiting and 20 created per stay per day,
  and an identical request (same extra, date, time) within 60 seconds is refused.
- **Rationale:** FR-008, FR-009, FR-013, FR-024; reuses spec 004's session and window.

## R4. Member routes

- **Decision:** under `/api/v1/workspaces/{id}`:
  - Catalog: `GET /properties/{pid}/extras`, `POST` (create), `PUT /{extraId}` (edit with
    `version`), `DELETE /{extraId}`, `PUT /properties/{pid}/extras/order`,
    `POST /{extraId}/copy {propertyIds}`. Writes need `properties.manage` (owners, admins).
  - Requests: `GET /service-requests?status=&propertyId=&before=` with waiting first, by requested
    moment, offset pagination of 50; `POST /service-requests/{id}/confirm`, `/decline
    {reasonCode, reasonText?}`, `/cancel {reasonCode, reasonText?}`. These need `conversations.handle`.
    Answers update only when the status is still the expected one (first wins); each is logged.
- **Rationale:** FR-015 to FR-020; same capabilities as guides and conversations.

## R5. Alerts and expiry

- **Decision:** a per-minute worker job `service-request.tick`:
  1. Expires waiting requests whose `expires_at` passed.
  2. For requests with `notified_at` null (waiting or confirmed), when the property isn't in quiet
     hours (spec 007), queues one email per contact (template `service_request.new`) and one
     `notification.push` per contact (kind `service_request`, IDs only), then sets `notified_at`.
  Contacts and quiet hours come from spec 007's resolved settings. Email and push texts carry the
  property name, the extra's name, and the requested date and time: host content, never the guest's
  note.
- **Rationale:** FR-015, FR-018, SC-003; one small job instead of hooks in the request route, so quiet
  hours and retries are handled in one place.

## R6. Guest pages

- **Decision:** the guest app adds `/g/{publicId}/{lang}/extras` (list) and `/extras/{extraId}` (detail
  and form), server-rendered from the public route and cached like other guide pages; a tile on the
  guide home when there are visible extras. The page script loads the stay's requests and shows
  statuses, the form (date, time, quantity, note), and Cancel when a session allows it; otherwise the
  note explains how to request. Offline, Request and Cancel are disabled. The script stays within the
  guide's 15 KB budget.
- **Rationale:** FR-007, FR-008, FR-012, FR-025; personal state never in cached HTML (spec 004 R9).

## R7. Portal

- **Decision:** `/properties/{id}/extras` (catalog with suggestions, form, copy, order),
  `/requests` (all requests, filters, actions), a header link "Requests", and a card on the property
  page. Client components import only types from contracts (bundle budget).
- **Rationale:** FR-001 to FR-005, FR-016, FR-017; screens H-27 and H-23.

## R8. Assistant

- **Decision:** `KnowledgeInput` gains `extras` (names, price, currency) and `extrasUrl` for the guide
  chat; the knowledge adds an "## Extras" block listing them with the link. Answer rule 14 allows naming
  them and sharing the link when the guest asks about a service, never other prices or requests. The
  copilot passes none. New eval cases cover a service question with and without extras.
- **Rationale:** FR-021, FR-022, PC-10.

## R9. Counts, security log, retention

- **Decision:** `service_request_daily (property, day, status, count)` is incremented on creation and
  on each status change. Security events: `extras.changed` (scope and flags) and
  `service_request.answered` (status, IDs only). Retention: requests are deleted 12 months after
  their stay's checkout, like conversations (spec 005); daily counts follow the other counts.
- **Rationale:** FR-020, FR-026, SEC-16, SEC-20.

## R10. Founder gates and implementation notes

- **Gates:** the legal review of extras texts and early check-in and late checkout as extras (OQ-35);
  a staging check on a phone with a real stay link.
- **Notes:** filled in during implementation.
