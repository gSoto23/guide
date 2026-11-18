# Feature Specification: Service Catalog and Host Add-on Requests

**Feature Branch**: `008-service-catalog`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "008 Service catalog and host add-ons (PRD F08, FR-08.1 to FR-08.3; FR-05.5; UX flow 7 and screens G-08, G-09, H-23, H-27; policies PC-03, PC-06, PC-07, PC-08, PC-10). Hosts define add-ons ("extras") per property with a name, description, price, currency, lead time, and availability rules (days of the week, a date or a time when the guest must choose one, how many per stay, and the same-day turnover rule for early check-in or late checkout). Guests with a stay link see the property's extras in the guest guide (an Extras page), open one, pick a date and time when it needs them, add an optional note, and request it. The host confirms or declines with a reason; extras the host marked as pre-approved are confirmed at once when the rules pass; requests nobody answers expire when the lead time passes; guests can cancel a request while it waits. The guest sees each request's status in the guide. No payment happens in Guidesk in this spec: a confirmed request tells the guest that the host will arrange payment with them (checkout is spec 013). Members get an alert for each new request through the escalation contacts, email, and push of specs 006 and 007, respecting quiet hours, and handle requests from a Requests screen in the portal. The guide chat may point guests who ask about services to the Extras page; copilot drafts never offer extras (PC-10). Extras are always optional and never change the reservation or include fees mandatory for the stay (PC-06, PC-08); guests are never asked for contact data (PC-03). Out of scope: payment and checkout, taxes and fees, refunds (spec 013); analytics dashboards (spec 010); requests created by the assistant; third-party providers."

**Sources**: [PRD F08](../../docs/product/prd.md#f08--service-catalog-and-host-add-ons) · [UX flow 7](../../docs/ux/user-flows.md#7-add-on-request-host-confirmation-and-tilopay-hosted-checkout) · [Screens G-08, G-09, H-23, H-27](../../docs/ux/screens.md) · [Platform policies PC-03, PC-06, PC-07, PC-08, PC-10](../../docs/research/platform-policies.md) · [Security SEC-01, SEC-02, SEC-07, SEC-14, SEC-16, SEC-20](../../docs/architecture/security.md#4-controls) · [Spec 002](../002-property-onboarding/spec.md) · [Spec 004](../004-guest-guide/spec.md) · [Spec 005](../005-guide-chat/spec.md) · [Spec 006](../006-host-inbox/spec.md) · [Spec 007](../007-agent-settings/spec.md) · [Spec 009](../009-tours-affiliate/spec.md)

## Clarifications

### Session 2026-11-18

Answered with the recommended option under the founder's standing instruction to run all phases on
2026-11-18. Each answer can be changed by the founder; the spec follows the answer below until then.

- Q: Who can request an extra? → A: A guest on a stay link (spec 004) from the moment the link works
  until checkout, after the confirmation code when the stay requires one. The request belongs to that
  stay, so the host knows who asked without any contact data. Visitors on the property link see the
  extras and a note to open the link from their booking messages to request one.
- Q: Does Guidesk take payment? → A: Not in this spec. A confirmed request says "Your host will
  arrange payment with you". The price shown is the host's price; no taxes or fees are added. Checkout,
  taxes, fees, and refunds come with spec 013.
- Q: Where do extras live? → A: Per property. Hosts can copy an extra to other properties of the
  workspace. The empty catalog suggests common extras (airport pickup, extra cleaning, grocery
  stocking, late checkout) as prefilled starting points.
- Q: Which availability rules exist? → A: A lead time (how long before the requested date and time
  the request must arrive), the days of the week it is offered, whether the guest picks a date (within
  the stay, or before arrival for arrival extras) and a time, how many per stay, and an optional
  turnover rule: early check-in is only possible when no other stay checks out that day; late checkout
  only when no other stay checks in that day.
- Q: What does pre-approval do? → A: When the host marks an extra as pre-approved and the request
  passes every rule, it is confirmed at once; otherwise it waits for the host.
- Q: When does a request expire? → A: When its requested date and time minus the lead time passes
  without an answer; for extras without a date, 48 hours after the request. Nothing is charged in any
  case.
- Q: Who handles requests and who edits the catalog? → A: Members who handle conversations (owners,
  admins, agents) confirm, decline, or cancel requests; owners and admins edit the catalog, as they
  edit the guide.
- Q: How are members told? → A: Each new request alerts the property's escalation contacts (spec
  007) by email and push (spec 006), at once, or at the end of quiet hours when it arrives during
  them. Pre-approved requests alert too, so the host can prepare.
- Q: May the assistant offer extras? → A: When a guest asks about a service, the guide chat may point
  to the Extras page. It never creates requests, never sends unsolicited offers, and copilot drafts
  never mention extras (PC-10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hosts build a catalog of extras (Priority: P1)

Ana opens her property's Extras in the portal, picks the suggested "Airport pickup", sets $85 USD,
a 24-hour lead time, "guest picks a date and time", and saves it. She adds "Late checkout until 2 pm",
$25, with the turnover rule, and copies the airport pickup to her other cabin.

**Why this priority**: Without a catalog there is nothing to request; it is also where the host
controls what can be sold and under which rules.

**Independent Test**: As an owner, create, edit, hide, reorder, copy, and delete extras on a property
and confirm the list and validations; as an agent, confirm the catalog is read-only.

**Acceptance Scenarios**:

1. **Given** a property without extras, **When** an owner opens Extras, **Then** suggested extras are
   offered as prefilled starting points and nothing is shown to guests until one is saved and visible.
2. **Given** the extra form, **When** the owner saves a name, a description, a price with a currency,
   a lead time, and rules, **Then** the extra is listed with a summary of its rules.
3. **Given** invalid input (no name, a negative price, an unknown currency, a lead time over 30 days,
   more than 10 per stay), **When** the owner saves, **Then** the form shows what to fix and saves
   nothing.
4. **Given** an extra, **When** the owner hides, reorders, copies it to other properties, or deletes
   it, **Then** guests see the change at once and waiting requests for a deleted extra stay visible to
   the host and guest with their original details.
5. **Given** an agent, **When** they open the catalog, **Then** they can see it but not change it.

---

### User Story 2 - Guests request an extra (Priority: P1)

Emily opens her stay link, taps "Servicios extra", opens "Airport pickup", reads the price, the lead
time, and "Offered by your host", picks Friday at 4:30 pm, adds "We are 4 with 2 suitcases", and
taps Request. She sees "Waiting for your host".

**Why this priority**: It is the guest's side of the feature and the reason hosts build a catalog.

**Independent Test**: With a stay link, open Extras, request an extra that needs a date and time,
confirm the status shows, and confirm the property link only shows the list with a note.

**Acceptance Scenarios**:

1. **Given** a property with visible extras, **When** a guest opens the guide, **Then** an Extras entry
   leads to the list: name, price and currency (or "Free"), a short description, and "Offered by your
   host".
2. **Given** a guest on a stay link, **When** they open an extra and request it with a valid date,
   time, and quantity, **Then** the request is stored for that stay with the extra's details and price
   at that moment, and the guest sees "Waiting for your host".
3. **Given** a date outside the allowed range, a day the extra isn't offered, a time inside the lead
   time, more than allowed per stay, or a turnover conflict, **When** the guest requests, **Then** the
   request is refused with a plain explanation and nothing is stored.
4. **Given** a visitor on the property link, or a stay link outside its window, **When** they open an
   extra, **Then** they see it without a Request button and a note on how to request it.
5. **Given** a pre-approved extra and a request that passes every rule, **When** the guest requests
   it, **Then** it is confirmed at once and shows "Confirmed: your host will arrange payment with
   you".
6. **Given** a waiting request, **When** the guest cancels it, **Then** it shows "Cancelled" and the
   host is not asked to answer it any more.

---

### User Story 3 - Hosts confirm or decline requests (Priority: P1)

Ana gets an email and a push: "New request: Airport pickup, Friday 4:30 pm, Casa Colibrí". She opens
Requests in the portal, sees the stay dates and Emily's note, and confirms. When Emily opens the
guide, the request says Confirmed.

**Why this priority**: A request without an answer is worse than no catalog; this closes the loop.

**Independent Test**: Create a request, confirm the contacts are alerted, confirm and decline requests
from the Requests screen, and confirm the guest sees each status.

**Acceptance Scenarios**:

1. **Given** a new request, **When** it is stored, **Then** the property's escalation contacts get an
   email and a push with the extra, the requested date and time, and the property, and no guest text.
2. **Given** a request during the property's quiet hours, **When** it is stored, **Then** the alert
   waits until the quiet hours end.
3. **Given** the Requests screen, **When** a member opens it, **Then** waiting requests come first (the
   soonest requested date first), filterable by property and status, each with the extra, the stay
   dates, the requested date and time, the quantity, the price, and the guest's note.
4. **Given** a waiting request, **When** a member confirms it, **Then** it becomes Confirmed for the
   guest; **When** a member declines it with a reason, **Then** the guest sees "Not available" with the
   reason and "nothing was charged".
5. **Given** a confirmed request, **When** a member cancels it with a reason, **Then** the guest sees
   "Cancelled by your host" with the reason.
6. **Given** two members answering the same request, **When** both act, **Then** the first answer wins
   and the second sees the current status.

---

### User Story 4 - Requests expire and stay tidy (Priority: P2)

Requests nobody answered in time expire on their own, so guests aren't left waiting and hosts aren't
asked to confirm something that can no longer happen.

**Why this priority**: Keeps statuses honest without the host doing anything.

**Independent Test**: Create a request close to its lead time, move time past it, run the expiry, and
confirm the request shows Expired for both sides and can no longer be confirmed.

**Acceptance Scenarios**:

1. **Given** a waiting request whose requested time minus the lead time has passed, **When** the expiry
   runs, **Then** the request becomes Expired and the guest sees that nothing was charged.
2. **Given** a waiting request for an extra without a date, **When** 48 hours pass without an answer,
   **Then** it expires.
3. **Given** an expired request, **When** a member tries to confirm it, **Then** the action is refused.

---

### User Story 5 - The assistant points guests to Extras (Priority: P3)

When Emily asks the guide chat "¿Pueden recogernos en el aeropuerto?", the assistant answers that her
host offers an airport pickup and links to Extras.

**Why this priority**: Helpful, but guests find Extras on their own; offers in chat need the stricter
rules of PRD §6.3.

**Independent Test**: In the guide chat of a property with extras, ask about a service and confirm the
reply may link to Extras, names only the host's extras, and creates no request; in the copilot, confirm
no extra is offered.

**Acceptance Scenarios**:

1. **Given** a property with visible extras, **When** a guest asks about a service, **Then** the reply
   may name the host's matching extra and link to Extras, and never states a price different from the
   catalog or creates a request.
2. **Given** a copilot draft for a booking platform, **When** the guest asks about a service, **Then**
   the draft doesn't offer or link extras (PC-10).

### Edge Cases

- An extra edited after a request: the request keeps the name, price, and currency it had when made.
- An extra deleted or hidden while requests wait: they stay valid; the host can still answer them.
- A stay cancelled or removed (spec 002): its waiting requests are cancelled and its guest link stops
  working; the host sees why.
- A stay whose dates change: waiting requests outside the new dates are flagged for the host.
- The same guest taps Request twice: the second identical request within a minute is refused as a
  duplicate.
- A guest's note with a phone number, email, or link: it is shown to the host as plain text; the form
  says not to include contact details and Guidesk never asks for them.
- A price of 0: shown as "Free".
- Different currencies on one property: each extra shows its own.
- The property has no time zone: dates and times use the property's country default, and the host is
  asked to set it.
- The guest guide is offline: the list stays readable; Request and Cancel say they need a connection.

## Requirements *(mandatory)*

### Functional Requirements

**Catalog**

- **FR-001**: Owners and admins MUST be able to create, edit, hide, reorder, and delete extras per
  property, each with a name (1 to 80 characters), a description (up to 500), a price (0 to 100,000,
  two decimals), a currency (ISO 4217 from a supported list), a lead time (0 to 720 hours), and rules.
- **FR-002**: The rules MUST include: the days of the week it is offered (default every day), whether
  the guest picks a date and whether they also pick a time, the date range (during the stay, or from
  booking until check-in for arrival extras), the most per stay (1 to 10), pre-approval, and an
  optional turnover rule (early check-in or late checkout).
- **FR-003**: Owners and admins MUST be able to copy an extra to other properties of the workspace.
- **FR-004**: The empty catalog MUST offer suggested extras in Spanish and English as prefilled forms.
- **FR-005**: Agents MUST be able to view the catalog and MUST NOT change it.
- **FR-006**: Extras MUST support Spanish and English names and descriptions, showing the source
  language when a translation is missing.

**Guest requests**

- **FR-007**: The guest guide MUST show an Extras entry when the property has visible extras, and list
  them with name, price and currency or "Free", a short description, and "Offered by your host".
- **FR-008**: Only a guest on a valid stay link, inside its window and verified when the stay requires
  it, MUST be able to request or cancel; other visitors see the extras without Request and with a note.
- **FR-009**: A request MUST record the stay, the extra, the requested date and time when required,
  the quantity, an optional note (up to 300 characters), and the extra's name, price, and currency at
  that moment.
- **FR-010**: The system MUST refuse requests that break a rule (date range, day of the week, lead
  time, most per stay, turnover), explaining which in the guest's language, and store nothing.
- **FR-011**: A request that passes every rule for a pre-approved extra MUST be confirmed at once;
  others MUST wait for the host.
- **FR-012**: Guests MUST see their stay's requests with status: waiting, confirmed, not available
  (with the reason), cancelled, cancelled by your host (with the reason), or expired, each saying that
  nothing was charged where it applies, and confirmed ones saying the host will arrange payment.
- **FR-013**: Guests MUST be able to cancel a waiting request.
- **FR-014**: The guide MUST never ask guests for phone numbers, emails, or documents, and the note
  field MUST say not to include contact details (PC-03).

**Host handling**

- **FR-015**: Each new request MUST alert the property's escalation contacts by email and push, without
  guest text, at once or when the property's quiet hours end.
- **FR-016**: The portal MUST offer a Requests screen with waiting requests first (soonest requested
  date first), filters by property and status, and each request's details and note.
- **FR-017**: Members who handle conversations MUST be able to confirm or decline a waiting request
  (with a reason from a list plus optional text) and cancel a confirmed one (with a reason); the first
  answer wins.
- **FR-018**: Waiting requests MUST expire when the requested date and time minus the lead time passes,
  or 48 hours after the request for extras without a date; expired requests can't be confirmed.
- **FR-019**: Cancelling or removing a stay MUST cancel its waiting requests, telling the host why.
- **FR-020**: Confirming, declining, and cancelling MUST be recorded with who and when.

**Assistant and copilot**

- **FR-021**: When a guest asks about a service, the guide chat MAY name the host's matching extras and
  link to Extras; it MUST NOT state other prices, create requests, or send unsolicited offers.
- **FR-022**: Copilot drafts MUST NOT offer or link extras (PC-10).

**Policy and quality**

- **FR-023**: Extras MUST always be optional, MUST NOT change the reservation's dates, nights, or
  guests, and MUST NOT be used for fees mandatory for the stay (PC-06, PC-08).
- **FR-024**: The system MUST limit requests to 10 waiting per stay and 20 per stay per day, and refuse
  identical requests within a minute.
- **FR-025**: The Extras pages MUST meet the guest guide's budget (spec 004) and WCAG 2.2 AA; the
  catalog and Requests screens MUST meet WCAG 2.2 AA; all texts in Spanish and English.
- **FR-026**: The system MUST count requests per property, per day, and per status, with no personal
  data, for analytics (spec 010).

### Key Entities *(include if feature involves data)*

- **Extra**: A property's add-on: names and descriptions per language, price and currency, lead time,
  rules, pre-approval, visibility, and order.
- **Service request**: A stay's request for an extra: requested date and time, quantity, note, the
  extra's name, price, and currency at that moment, status, reason, who answered and when, and whether
  the contacts were alerted.
- **Request counts**: Per property, per day, and per status. No personal data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host adds an extra from a suggestion in under 2 minutes.
- **SC-002**: A guest on a stay link requests an extra in under 1 minute and three taps from the guide
  home.
- **SC-003**: Contacts are alerted within 60 seconds of a request outside quiet hours.
- **SC-004**: In tests, 100% of requests that break a rule are refused with an explanation, and 0
  requests are possible without a valid stay link session.
- **SC-005**: The Extras pages show their largest content within 2.5 seconds on a mid-range phone on
  4G; the Requests screen loads in under 1 second for 1,000 requests.
- **SC-006**: In the pilot, at least 25% of stays with an opened guide request an extra (business
  assumption A-04), measured with the counts.
- **SC-007**: The Extras pages, the catalog, and the Requests screen pass automated accessibility
  checks (WCAG 2.2 A and AA) with zero violations.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature adds guest writes tied to stay links, guest-written notes shown to hosts, and alerts.

### Threats (STRIDE)

- **S**: A visitor without a stay link, or with another stay's link, requests or cancels extras.
- **T**: A guest changes the price, the extra, or the stay in the request; a note carries markup or
  links.
- **R**: A member denies declining a request; a guest denies requesting.
- **I**: A guest reads another stay's requests; alerts or logs expose guest notes.
- **D**: Request floods alert hosts repeatedly.
- **E**: An agent edits the catalog; a member of another workspace answers requests.

### Controls Applied

- **SEC-01, SEC-02**: Requests and cancellations need the stay link session (cookie) inside its
  window, and the confirmation code when the stay requires it; the stay comes from the session, never
  from the request body.
- **SEC-07**: Per-stay limits and duplicate refusal; alerts once per request.
- **SEC-14**: RLS on every new table; cross-tenant tests for every new route.
- **SEC-16**: Confirm, decline, and cancel are logged with who and when; catalog changes are logged.
- **SEC-20**: Notes are kept with the request and deleted with it; alerts, push payloads, logs, and
  counts carry no guest text.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given no stay session, another property's session, or a session outside its window,
  when someone requests or cancels, then it is refused and nothing is stored.
- **AC-SEC-002**: Given a request body with a price, a currency, or a stay, when it is stored, then the
  stored values come from the catalog and the session only.
- **AC-SEC-003**: Given a note with HTML, a script, or a link, when the host or guest sees it, then it
  is plain text and nothing runs.
- **AC-SEC-004**: Given a member of another workspace or an agent, when they change the catalog or
  answer another workspace's requests, then they get 404 (other workspace) or 403 (agent editing the
  catalog), logged.
- **AC-SEC-005**: Given a stay link of one stay, when it lists requests, then it sees only its stay's.
- **AC-SEC-006**: Given more than the per-stay limits, when the guest requests, then the requests are
  refused and no extra alert is sent.

### Platform Policies

- **PC-03**: No contact data is requested; the note asks guests not to include any.
- **PC-06**: Extras never change the reservation or carry mandatory fees; payment stays between host
  and guest until checkout (spec 013) and never through links Guidesk produces.
- **PC-07**: Extras say "Offered by your host"; no commission is involved in this spec.
- **PC-08**: Extras are opt-in; nothing in the guide depends on them.
- **PC-10**: Copilot drafts never offer extras; the guide chat only answers a guest's question.

## Assumptions

- Specs 002 to 007 and 009 are in place: stays, stay links and sessions, the guest guide, the guide
  chat, the inbox with push, escalation contacts and quiet hours, and Explore.
- Early check-in and late checkout may be requested, but selling them through Guidesk checkout waits
  for the legal review (OQ-35, spec 013); in this spec the host agrees payment with the guest.
- The supported currencies start with USD, CRC, MXN, EUR, COP, and GTQ, and can grow.
- The thresholds (48-hour expiry, 10 waiting and 20 per day per stay, 300-character notes) are pilot
  values to tune.
- Requests are kept with their stay's conversations and deleted 12 months after checkout (spec 005
  retention).
