# Research: Stay Calendar and Guest Details

**Feature**: [spec.md](spec.md) · **Date**: 2026-11-24

The code these decisions touch was mapped on 2026-11-24: stays API (`apps/api/src/stays`), feed
parsing (`apps/sandbox/src/feed-reader/parse.ts`, `packages/integrations/src/sandbox/protocol.ts`,
`packages/domain/src/properties/feeds.ts`), feed and PMS writes (`apps/worker/src/jobs/calendar-refresh.ts`,
`apps/api/src/calendar-feeds/calendar-feeds.service.ts`, `apps/worker/src/jobs/csv.ts`,
`apps/worker/src/jobs/pms-common.ts`), the request-side stay trigger (migration `0017`), stay links
(`apps/api/src/share`), requests and payments (`apps/api/src/extras`, `apps/api/src/payments`), inbox
and conversations, the copilot, the stay message (`packages/domain/src/guest/messages.ts`), and the
portal shell (`apps/portal/components/shell/destinations.ts`).

## R1. Calendar API: one bounded read for a range

- **Decision**: `GET calendar?from&to[&propertyId][&channel][&cancelled]` returns the workspace's
  active properties (id, name, time zone) and the stays that overlap the range (at most 62 days),
  each with its marks: stay link opened (`stay.guide_opened_at`), an open escalation (a
  `needs_host` conversation of the stay), add-on requests waiting, and confirmed add-ons. One query
  with grouped sub-counts; a new index on `conversation(stay_id)`. Any member may read it (the stays
  list already allows agents); stay links and codes are never part of it.
- **Rationale**: SC-002 (50 properties, 400 stays, ≤ 1 s); RLS keeps workspaces apart as for the
  stays list.
- **Rejected**: one request per property (50 round trips); reusing `GET stays` (one property, no
  upper bound, no marks).

## R2. Stay view API

- **Decision**: `GET stays/{stayId}` returns the stay (with guest details and who set them), its
  property, the stay link state (the same fields the Share screen computes, for one stay), its
  conversations (status, escalation reason, last message), its add-on requests in the Requests
  screen's shape, and totals per currency (confirmed add-ons; paid through checkout). Any member;
  copying links and messages stays on the Share screen's routes with their rules.
- **Rationale**: FR-008 to FR-012 from one read; reuse of the existing services keeps one source of
  truth for request and payment states.

## R3. Guest details on any stay

- **Decision**: new columns `stay.guest_details_source` (`feed` | `pms` | `host`, null when nothing
  is known), `guest_details_by` (member), `guest_details_at`. `PUT stays/{stayId}/guest` sets the
  name (1–120, trimmed, or null to clear) and the number of guests (0–500 or null) for owners and
  admins (`properties.manage`), marks the source `host`, and writes `stay.guest_details_changed`
  (stay ID and which fields changed; never the name). A removed name (spec 002 FR-053) cannot be set
  again.
- The check `stay_ical_no_guest_data` becomes: feed stays may hold a booking reference, and a name or
  number of guests only when the source is `host`. The request-side trigger (`stay_guard_request_changes`)
  allows owners and admins to change the name, the number of guests, and the source columns on feed
  and PMS stays, and still refuses everything else.
- PMS refreshes (`applyReservations`) keep writing dates, channel, and reference, but leave the name
  and number of guests alone when the source is `host` (FR-016).
- **Rejected**: a separate "host notes" table (two names to reconcile everywhere the name shows).

## R4. Airbnb reservation code from the feed

- **Decision**: the sandbox parser reads each VEVENT's `URL` and `DESCRIPTION` only to find the
  first match of the existing `BOOKING_REFERENCE` pattern (`HM` + 8 characters) and returns it as
  `reference` (or null). The wire schema (`feedEntrySchema`, both sides) gains `reference`. Feed
  inserts and refreshes write it to `booking_reference`; nothing else from the entry leaves the
  parser (no link, no phone digits). OQ-39 confirms the format with a real export; if Airbnb drops
  the code, the field stays empty.
- **Rationale**: FR-017 with the smallest change to the isolated reader.

## R5. Names on the host side

- **Decision**: `InboxItem`, `ConversationSummary`, and `ConversationDetail` gain `stayId` and
  `guestName` (from the stay); the Requests screen already shows the stay's name. The conversation
  screen offers owners and admins "Guardar nombre del huésped" (a short form) when the conversation
  has a stay. Push and email texts stay as they are (no name).
- **Decision**: the stay message (`stayMessage` in the domain) takes an optional guest name and
  greets with it ("¡Hola, Ana! …", "Hi Ana! …"); the file's rule changes from "never guest data" to
  "the guest's name only, for the host to send".
- **Decision (scope)**: copilot drafts do not get the name in this spec. A copilot run has no stay
  today (`copilot_run` has no stay column; the request is only the pasted message), so naming the
  guest needs a stay picker and a prompt change with evals. Deferred; spec FR-020 becomes "later".
- **Guest side unchanged**: the assistant's context never reads the stay's name (FR-022); tests
  check it.

## R6. Who may answer requests from the stay view

- **Decision**: the same roles as the Requests screen today (spec 008: members who handle
  conversations, agents included). The spec's "owners and admins only" and its abuse case are
  corrected to follow spec 008, so the two screens never disagree.

## R7. Portal

- **Decision**: a new destination "Calendario" (`/{locale}/calendar`): in the desktop sidebar and
  under "Más" on phones (the bottom bar stays at four columns). Views: "Todas las propiedades" (rows
  per property, stays as bars on a CSS grid of days) and one property (a month grid); below 768 px
  an agenda by day. The stay view is its own page (`/{locale}/calendar/stays/{stayId}`), so it works
  on phones and can be linked from the inbox and requests. Filters (properties, channels, show
  cancelled) stay per device in `localStorage`. No new dependency; dates use `Intl` with the
  property's time zone.
- **Rationale**: FR-001 to FR-007; the 175 KB route budget.

## R8. Retention

- **Decision**: host-typed names follow the existing guest-name retention (`GUEST_NAME_MONTHS`, 12
  months after checkout); the source columns are cleared with the name.
