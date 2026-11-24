# Feature Specification: Stay Calendar and Guest Details

**Feature Branch**: `018-stay-calendar`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "018 Stay calendar and guest details (founder request 2026-11-24). Hosts need a calendar of their reservations, and in the same place they need to see which extras each reservation bought. A tour partner (Localbird) may be integrated later, so tours booked by a guest should be able to appear on the stay too. Hosts also want a more personal treatment, but calendar feeds (iCal) carry no guest name: there must be a way to link a reservation to its guest without a PMS. Read-only calendar of the stays Guidesk already knows (calendar feeds, PMS imports, stays added by hand) for all properties and for one property, with a stay view that brings together dates, guest, stay link, conversations, and extras with their payment state. Hosts can name the guest of any stay; the Airbnb reservation code is kept so the host can find the matching thread; the name is used on the host side (calendar, inbox, requests, copilot drafts, stay message) and never on the guest guide (founder decision 2026-11-20). Out of scope: changing availability, prices, or bookings on the platforms; partner tour bookings (a later spec once a partner reports bookings per stay)."

**Sources**: [PRD §2 non-goals and F02](../../docs/product/prd.md) ·
[Spec 002 FR-022, FR-030, FR-052, FR-053 (stays)](../002-property-onboarding/spec.md) ·
[Spec 004 FR-028, FR-039 (stay card, stay message)](../004-guest-guide/spec.md) ·
[Spec 006 (inbox, copilot)](../006-host-inbox/spec.md) · [Spec 008 (add-on requests)](../008-service-catalog/spec.md) ·
[Spec 013 (payments)](../013-payments-checkout/spec.md) ·
[Business model §3](../../docs/product/business-model.md#3-commission-model-hypothesis) ·
[OQ-38 Localbird, OQ-39 Airbnb feed contents](../../docs/open-questions.md)

## Clarifications

### Session 2026-11-24

Answered with the recommended option under the founder's standing instruction to run the Spec Kit
phases without stopping. Each answer can be changed by the founder; the spec follows the answer below
until then.

- Q: Does Guidesk become a booking calendar (a PMS)? → A: No. The calendar is a read-only view of the
  stays Guidesk already knows from calendar feeds, PMS imports, and stays added by hand (spec 002). It
  never changes availability, prices, blocks, or bookings on Airbnb, Booking.com, Vrbo, or a PMS (PRD
  §2 non-goal). Stays added by hand keep being added and edited as in spec 002.
- Q: Which views? → A: "All properties" (one row per property, stays as bars across the days) and one
  property (a month grid). On phones both become an agenda: days in order with the stays that arrive,
  stay, or leave that day. Owners, admins, and agents can open the calendar.
- Q: What does the stay view show? → A: Dates and times in the property's time zone, channel and
  source, the guest's name and number of guests when known, the booking reference, the stay link's
  state (created, opened, on how many devices, codes viewed), the stay's conversations with any open
  escalation, and the stay's add-on requests with their state, amount, and payment state, plus the
  total of confirmed and paid add-ons for the stay.
- Q: How does a stay get a guest name without a PMS? → A: Owners and admins can type the guest's name
  and number of guests on any stay, including stays from a calendar feed or a PMS (this amends spec 002
  FR-022 and FR-053 for these two fields only). Refreshes never overwrite what the host typed. For
  Airbnb feeds, Guidesk keeps the reservation code found in the entry's reservation link as the booking
  reference, so the host can find the matching Airbnb thread and copy the name from there; the
  reservation link itself and the partial phone number are still not kept (OQ-39 verifies the feed
  format).
- Q: Does the guest guide show the guest's name? → A: No. The founder's 2026-11-20 decision stands
  (spec 004 FR-028): a forwarded stay link must not reveal who is staying. The name is used on the host
  side only: calendar, stay view, inbox, requests, copilot drafts, and the stay message the host
  copies and sends from the booking platform. Push notifications and emails also leave it out, because
  they show on lock screens and in shared inboxes.
- Q: Can the guest give their name? → A: Guidesk does not ask guests for their name. When a guest
  writes their name in the chat, the host can save it on the stay with one action from the
  conversation. The assistant may use a name the guest wrote in that same conversation, as it does
  today; it never reads the name saved on the stay.
- Q: Tours booked through a partner (Localbird, Viator, Civitatis)? → A: Out of scope. Explore counts
  opens and clicks per property per day and does not know which stay a click came from. The stay view
  has a "Services" area that lists the host's add-ons now; tours appear there only when a partner
  integration reports bookings per stay, which is a later spec once a partnership exists (OQ-38).
- Q: How far back and ahead? → A: Any month can be opened. The calendar shows the stays Guidesk keeps:
  upcoming stays as imported (PMS up to 365 days ahead), and past stays until spec 002's retention
  removes them. Guest names follow the Confidential retention rule.

### Session 2026-11-24 (plan)

- Q: Can copilot drafts greet the guest by name now? → A: Not in this spec. A copilot run has no stay
  today (the host pastes a booking-platform message), so using the name needs a stay picker on the
  copilot screen and a prompt change with evals. FR-020 moves to a later spec ([research R5](research.md)).
- Q: Who may confirm or decline a request from the stay view? → A: The same members as on the
  Requests screen today (spec 008: members who handle conversations, agents included), so the two
  screens never disagree ([research R6](research.md)). Only guest details are limited to owners and
  admins.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every stay in a calendar (Priority: P1)

A host with several properties opens "Calendario" and sees this month's stays for all properties at
once: one row per property, each stay as a bar from check-in to checkout with the guest's name (or the
channel, such as "Huésped de Airbnb"), the number of guests, and small marks for an opened stay link,
an open escalation, and add-on requests waiting for an answer. They move to next month, jump back to
today, and filter to one property. On a phone they see the same stays as a day-by-day agenda.

**Why this priority**: Hosts asked for one place to see their reservations. It turns the stays Guidesk
already imports into the host's daily operating view, which every other story builds on.

**Independent Test**: A workspace with two properties, one with a calendar feed and one with stays
added by hand, opens the calendar and sees every stay of the month on the right days in each
property's time zone, on desktop and on a phone.

**Acceptance Scenarios**:

1. **Given** a workspace with stays from a calendar feed, a PMS, and stays added by hand, **When** an
   owner opens the calendar, **Then** every active stay of the visible month appears on its property's
   row from its check-in day to its checkout day, with its channel.
2. **Given** a stay that starts in one month and ends in the next, **When** either month is open,
   **Then** the stay appears in both, cut at the month edge with a mark that it continues.
3. **Given** a feed entry marked "may be a block", **When** the calendar shows it, **Then** it looks
   different from a confirmed stay (for example outlined) and says "Puede ser un bloqueo"; a hidden one
   does not appear.
4. **Given** a cancelled stay, **When** the calendar is open, **Then** it does not appear unless the
   member turns on "Mostrar canceladas", and then it appears crossed out.
5. **Given** a phone-sized screen, **When** the member opens the calendar, **Then** it shows an agenda
   by day (arrivals, stays in progress, departures) instead of a grid, with no horizontal page scroll.
6. **Given** an agent, **When** they open the calendar, **Then** they see the stays and guest names but
   no stay links or codes.
7. **Given** a property whose stays overlap, **When** the calendar shows them, **Then** both appear
   and carry the overlap notice from spec 002.

---

### User Story 2 - One stay with its guest, conversations, and extras (Priority: P1)

The host taps a stay and sees everything about it in one place: dates and times, channel, guest name
and number of guests, booking reference, whether the stay link was opened and the codes were viewed,
the conversations of that stay with any open escalation, and every add-on the guest requested: name,
date, quantity, price, state (waiting, confirmed, declined, cancelled, expired), and payment state
(paid, refunded, disputed) with the stay's total.

**Why this priority**: The founder wants to see in the calendar which extras each reservation bought.
Revenue per stay is Guidesk's growth metric (PRD G4), and today requests and stays live on separate
screens.

**Independent Test**: A stay with two add-on requests (one confirmed and paid, one declined) and a
conversation with an open escalation shows both requests with their states and amounts, the total of
the paid one, and a link to the conversation.

**Acceptance Scenarios**:

1. **Given** a stay with add-on requests, **When** the host opens the stay, **Then** each request
   appears with its name, requested date and quantity, price and currency, request state, and payment
   state, newest first.
2. **Given** a stay with confirmed and paid requests, **When** the stay view is open, **Then** it shows
   the stay's total of confirmed add-ons and, separately, the total paid through Guidesk checkout,
   each in its currency.
3. **Given** a request waiting for an answer, **When** a member who may answer requests (spec 008)
   opens the stay, **Then** they can confirm or decline it from the stay view as on the Requests
   screen.
4. **Given** a stay with a conversation, **When** the host opens the stay, **Then** the conversation is
   listed with its last message time and any open escalation reason, and opens in the inbox.
5. **Given** an owner or admin, **When** they open a stay, **Then** they see the stay link's state and
   can copy the stay link and the stay message (with the recent sign-in rules of spec 004); an agent
   sees the state only.
6. **Given** a stay with no requests and no conversation, **When** it opens, **Then** the stay view
   says so and suggests sharing the stay link.
7. **Given** the calendar, **When** a stay has confirmed add-ons, **Then** its bar shows a small mark
   with the number of add-ons, so the host sees which stays bought extras without opening them.

---

### User Story 3 - Name the guest of any stay (Priority: P2)

A host whose stays come from an Airbnb calendar feed sees "Huésped de Airbnb · HMABC12345" on a stay.
They open Airbnb, find the thread with that reservation code, and type the guest's name ("Ana") and
the number of guests (2) on the stay. From then on the calendar, the inbox, and the requests show
"Ana". The next feed refresh keeps the name.

**Why this priority**: Without a PMS, the host has no other way to know who is behind a stay in
Guidesk, and personal treatment starts with knowing the guest's name.

**Independent Test**: A stay from a calendar feed gets a name and number of guests from the host,
keeps them after a feed refresh, and loses the name when the host removes it on request.

**Acceptance Scenarios**:

1. **Given** a stay from an Airbnb feed whose entry has a reservation link, **When** Guidesk reads the
   feed, **Then** the stay keeps the reservation code as its booking reference and nothing else from
   the link or the description (no link, no phone digits).
2. **Given** any stay, **When** an owner or admin adds or edits the guest's name and number of guests,
   **Then** the stay shows them and records who changed them and when.
3. **Given** a stay whose name was typed by the host, **When** a feed or PMS refresh runs, **Then** the
   name and number of guests stay as the host typed them.
4. **Given** a stay from a PMS with a name, **When** the host corrects the name, **Then** the host's
   name wins over later PMS refreshes.
5. **Given** a guest who asks for their data to be deleted, **When** the host removes the name,
   **Then** the name is gone and no refresh brings it back (spec 002 FR-053).
6. **Given** a conversation where the guest wrote their name, **When** an owner or admin chooses "Guardar
   como nombre del huésped" on that message's name, **Then** the stay of that conversation takes the
   name they confirm.
7. **Given** an agent, **When** they open a stay, **Then** they see the name but cannot change it.

---

### User Story 4 - Personal touches on the host side (Priority: P2)

Once a stay has a name, the host's tools use it: the inbox shows "Ana · Casa Brisa · 12–15 dic", the
Requests screen shows who asked for the airport pickup, copilot drafts for the booking-platform chat
can start with "Hola Ana", and the stay message the host copies starts with a greeting with the name.
The guest guide, push notifications, and emails never show it.

**Why this priority**: This is the personal treatment the founder asked for, delivered where the host
writes to the guest, without breaking the decision that the guide shows no names.

**Independent Test**: A stay named "Ana" shows the name in the inbox, requests, and stay message; the
guest guide opened with its stay link and the push notification for a new request show no name.

**Acceptance Scenarios**:

1. **Given** a named stay, **When** its guest writes in the chat, **Then** the inbox lists the
   conversation with the guest's name, the property, and the dates.
2. **Given** a named stay, **When** the guest requests an add-on, **Then** the Requests screen shows the
   name; the push notification and email say only the property and the add-on.
3. **Given** a named stay, **When** an owner or admin copies the stay message (spec 004 FR-039), **Then**
   it starts with a greeting with the name in the chosen language; without a name it starts with a
   general greeting.
4. **Given** a named stay, **When** the guest opens the guide with the stay link, **Then** the stay card
   still shows no name (spec 004 FR-028), and the assistant's context has no name from the stay.

---

### Edge Cases

- A month with more than 40 stays in one property row, or 100 properties: the calendar stays readable
  (rows scroll inside the calendar, not the page) and loads within the target (SC-002).
- A property in another time zone than the member: days follow the property's time zone; the stay view
  also shows the member's time when it differs.
- A stay added by hand with its own check-in time: the bar and the stay view use the stay's times.
- A property removed or archived: its stays leave the calendar with it.
- A feed entry without a reservation link, or a feed from Booking.com or Vrbo: no booking reference;
  the stay shows the channel only.
- The Airbnb feed format changes and no code is found: the stay is still created; only the booking
  reference is missing (OQ-39).
- A name longer than 120 characters or with only spaces: refused with a message.
- Two members edit the same stay's name at once: the last save wins and both changes are recorded.
- A request whose stay was cancelled: it stays on the cancelled stay's view with its state.
- Payments off (staging and the pilot without a provider): payment state reads "Pago fuera de
  Guidesk" or nothing, and totals show confirmed add-ons only.
- Offline: the calendar shows the last loaded month with an offline notice; edits wait for the network.
- An agent opens a stay whose link was never created: they see "Sin enlace todavía" and no action.

## Requirements *(mandatory)*

### Functional Requirements

**Calendar**

- **FR-001**: Owners, admins, and agents MUST be able to open a calendar of the workspace's stays from
  the main navigation, with an "All properties" view and a view for one property.
- **FR-002**: The "All properties" view MUST show one row per active property and each stay as a bar
  from its check-in day to its checkout day; the property view MUST show a month grid. Both MUST open on
  the current month in the property's time zone and let the member move by month and return to today.
- **FR-003**: On screens narrower than 768 px, both views MUST show an agenda by day listing arrivals,
  stays in progress, and departures, with no horizontal page scroll.
- **FR-004**: Each stay MUST show the guest's name when known, otherwise the channel ("Huésped de
  Airbnb", "Directo"); the number of guests when known; and marks for: stay link opened, open
  escalation, add-on requests waiting, and the number of confirmed add-ons.
- **FR-005**: Stays marked "may be a block" MUST look different from confirmed stays and say so;
  hidden stays MUST NOT appear; cancelled stays MUST appear only when the member turns on "Show
  cancelled", crossed out.
- **FR-006**: The calendar MUST let the member filter by property and by channel; the filter MUST be
  kept for that member on that device.
- **FR-007**: The calendar MUST be read-only for stays from feeds and PMS: it MUST NOT offer to create,
  move, resize, or block dates on any booking platform or PMS. "Add stay" MUST open the existing manual
  stay form (spec 002 FR-052).

**Stay view**

- **FR-008**: Selecting a stay MUST open a stay view with: dates and times in the property's time zone
  (and the member's when different), channel and source, guest name and number of guests when known,
  booking reference with Copy, and overlap and "may be a block" notices.
- **FR-009**: The stay view MUST show the stay link's state: not created, created, opened (first open
  time and number of devices), codes viewed (count), revoked or ended. Owners and admins MUST be able
  to copy the stay link and the stay message under spec 004's rules (FR-022, FR-039, FR-040); agents
  MUST see the state only.
- **FR-010**: The stay view MUST list the stay's conversations with the last message time and any open
  escalation reason, each opening in the inbox.
- **FR-011**: The stay view MUST list every add-on request of the stay (spec 008), newest first, with
  the add-on name in the member's language, requested date and time, quantity, price and currency,
  request state, and payment state when a payment exists (spec 013).
- **FR-012**: The stay view MUST show the total of confirmed add-ons and the total paid through Guidesk
  checkout, per currency, and MUST NOT add amounts in different currencies together.
- **FR-013**: Members who may answer requests on the Requests screen (spec 008, agents included) MUST
  be able to confirm or decline a waiting request from the stay view, with the same rules, messages,
  and records.
- **FR-014**: The stay view MUST have a "Services" area holding the add-on requests; it MUST be able to
  hold partner bookings in a later spec without changing the stay view's layout.

**Guest details**

- **FR-015**: Owners and admins MUST be able to add, edit, and remove the guest's name (1 to 120
  characters, trimmed) and number of guests (0 to 500) on any stay, whatever its source. Each change
  MUST be recorded in the security log with who made it and when, without the name itself.
- **FR-016**: A name or number of guests typed by a member MUST be marked as entered by the host, and
  later feed or PMS refreshes MUST NOT change it. Removing a name on request MUST keep working as in
  spec 002 FR-053, and no refresh MUST restore it.
- **FR-017**: When reading an Airbnb calendar feed entry that has a reservation link, Guidesk MUST keep
  the reservation code from that link as the stay's booking reference. It MUST NOT keep the link, the
  phone digits, or any other text from the entry (amends spec 002 FR-022 for the code only).
- **FR-018**: In a conversation tied to a stay, owners and admins MUST be able to select a name the
  guest wrote and save it as the stay's guest name after confirming it. Guidesk MUST NOT ask guests for
  their name and MUST NOT extract names from messages automatically.

**Using the name**

- **FR-019**: When a stay has a name, the inbox list and conversation header, the Requests screen, and
  the stay view MUST show it next to the property and dates.
- **FR-020**: (Later spec.) Copilot drafts for a named stay may greet the guest by name once the
  copilot can be linked to a stay; not built here (plan clarification).
- **FR-021**: The stay message (spec 004 FR-039) MUST start with a greeting that uses the stay's name
  when it has one, and a general greeting otherwise, in the chosen language.
- **FR-022**: The guest guide, the guest assistant's context, push notifications, and emails MUST NOT
  include the name saved on a stay (spec 004 FR-028; founder decision 2026-11-20).

**Quality**

- **FR-023**: The calendar and stay view MUST be available in Spanish and English, meet WCAG 2.2 AA
  (keyboard navigation through days and stays, stays announced with dates, guest, and marks; marks not
  conveyed by color alone), and stay within the portal budget of 175 KB of JavaScript per route.
- **FR-024**: The calendar MUST respect workspace isolation and roles exactly as the stays list does
  (spec 002), and MUST read only the months it shows.

### Key Entities

- **Stay** (spec 002): gains who set the guest name and number of guests (feed, PMS, or host) and when,
  and keeps the Airbnb reservation code as its booking reference. Guest name stays Confidential.
- **Stay view**: not stored; brings together a stay, its stay link state (spec 004), conversations
  (spec 005/006), add-on requests (spec 008), and payment orders (spec 013).
- **Calendar filter**: a member's per-device choice of properties, channels, and "show cancelled".

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host finds a given stay and sees which add-ons it bought in under 15 seconds from the
  calendar, in a moderated test with pilot hosts.
- **SC-002**: The calendar shows a month for 50 properties with 400 stays within 1 second at p95 on the
  API, and its page meets the portal budgets (LCP ≤ 2.5 s, CLS ≤ 0.1, accessibility ≥ 0.95).
- **SC-003**: 100% of add-on requests appear on their stay's view with the same state as on the Requests
  screen.
- **SC-004**: 0 guest names appear in the guest guide, in the guest assistant's context, in push
  notifications, or in emails (checked by tests).
- **SC-005**: Host-typed names survive 100% of feed and PMS refreshes in tests.
- **SC-006**: In the pilot, at least half of active hosts open the calendar weekly (measured after
  launch; a product signal, not a release gate).

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

### Threats (STRIDE)

- **S**: A member of another workspace reads stays or names through the calendar endpoint.
- **T**: An agent edits a guest name.
- **R**: A name change cannot be traced to a member.
- **I**: A forwarded stay link, a lock-screen notification, or a shared mailbox reveals who is
  staying; a feed's partial phone number is stored; names reach logs.
- **D**: A very large month (many properties, many stays) slows the API.
- **E**: The calendar exposes stay links or codes to agents.

### Controls Applied

- Workspace isolation and row-level security on every read, as for the stays list (spec 002).
- Role checks: guest details for owners and admins only; request answers as on the Requests screen
  (spec 008); stay links and stay messages under spec 004's recent sign-in rule.
- Security log entries for name changes and removals, without the name.
- Names stay off the guest guide, assistant context, push notifications, and emails (FR-022); logs and
  error reports scrub them (Confidential class, security.md).
- From a feed entry only the reservation code is kept (FR-017); no link, phone digits, or description.
- Month-bounded queries with indexes on property and dates; pagination of rows for large workspaces.

### Abuse Cases (Acceptance Criteria)

- A request for another workspace's calendar returns 404.
- An agent's request to change a guest name returns 403 and changes nothing.
- A feed entry with a phone number in its description stores no digits.

### Platform Policies

- Guidesk does not change data on Airbnb, Booking.com, Vrbo, or a PMS (read-only, PRD §2).
- Reading the reservation code from the host's own Airbnb export link uses data the host shared with
  Guidesk for their own listing; no scraping or credentials.

## Assumptions

- Airbnb's export feed still includes a reservation link with the reservation code in each reserved
  entry, and a partial phone number in the description (third-party documentation; OQ-39 checks it
  against a real feed before planning). Booking.com and Vrbo feeds carry no guest data.
- Add-on requests and payment orders already carry their stay (specs 008 and 013); conversations
  started with a stay link already carry their stay (spec 005).
- Explore keeps counting opens and clicks per property per day; per-stay tour attribution needs a
  partner that reports bookings with a reference Guidesk gives it (OQ-38, Localbird first).
- Guest-name retention follows the Confidential class (12 months after checkout, to be confirmed by
  OQ-35); this spec does not change it.
- Payments may stay off during the pilot; the stay view then shows request states and confirmed
  totals only.
