# Feature Specification: Guest Guide

**Feature Branch**: `004-guest-guide`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "004 Guest guide (PRD F04, FR-04.1 to FR-04.6; security controls SEC-01 to SEC-04; open questions OQ-20 and OQ-28; UX gap 1). Guests of a property open its published guide (spec 003) as a mobile-first web app (PWA) from a link or a QR code, with no app download and no guest account (FR-04.1, PC-02). The guide shows the last published version of the property's guide, never drafts, in the guest's language detected automatically from the browser and switchable between Spanish and English, falling back to the source language for untranslated items (FR-04.3); core facts and locked-field values are resolved at view time (spec 003 FR-052). Two kinds of links (SEC-01): a per-property link and QR that show only public content, with every locked field shown as a placeholder (except a Wi-Fi password the host made public, spec 003 FR-021); and a per-stay link for a specific booking that unlocks the locked fields for a verified guest only inside the stay window, and shows placeholders before and after (FR-04.4). The per-stay token is random (at least 128 bits), never reused, revocable, and expires at checkout plus the buffer; on first visit it is exchanged for an HttpOnly, Secure, SameSite=Lax cookie scoped to the guide origin and the browser is redirected to a clean URL, with Referrer-Policy no-referrer and noindex (SEC-02). Guest verification (OQ-20, decided in this spec): the reservation-scoped link itself plus an optional short confirmation the host can require, with brute-force protection (SEC-03). Sensitive responses are never cached (SEC-04); whether a verified guest may save the access steps for offline use is decided here (OQ-28). Content already viewed remains available offline. A portal Share screen per property: property link, printable QR code (PNG and SVG), per-stay link, and a ready-to-paste OTA message in Spanish and English with the access instructions as text (FR-04.5, PC-01, PC-02); revoke and regenerate links. Commission disclosures (FR-04.6, PC-07). Friendly unavailable page. Fast on slow mobile connections (LCP 2.5 s on 4G), WCAG 2.2 AA, view counts only, no guest personal data (PC-03), its own origin (SEC-11), media through short-lived signed URLs. Out of scope: in-guide chat (005), inbox (006), service requests and payments (008, 013), tours (009), analytics dashboards (010), in-platform OTA messaging (012)."

**Sources**: [PRD F04](../../docs/product/prd.md#f04--guest-guide-web-app) · [UX flow 3, sharing the guide](../../docs/ux/user-flows.md) · [UX flow 4, guest opens the guide](../../docs/ux/user-flows.md#4-guest-opens-the-guide-verifies-and-reveals-the-door-code) · [Screens G-01 to G-05, G-11 to G-13, H-16](../../docs/ux/screens.md) · [UX gap 1](../../docs/ux/README.md#gaps-found-while-designing) · [Architecture flow 5.3](../../docs/architecture/overview.md#53-revealing-sensitive-information) · [Security controls SEC-01 to SEC-04, SEC-11, SEC-16](../../docs/architecture/security.md#4-controls) · [Platform policies](../../docs/research/platform-policies.md#design-constraints) · [Open questions OQ-20, OQ-28](../../docs/open-questions.md) · [Spec 001](../001-workspace-accounts/spec.md) · [Spec 002](../002-property-onboarding/spec.md) · [Spec 003](../003-guide-builder/spec.md)

## Clarifications

### Session 2026-11-17

Answered by Claude with the recommended option, under the founder's standing authorization of
2026-11-17. Each answer can be changed by the founder; the spec follows the answer below until
then.

- Q: How is a guest verified before a code is shown (OQ-20): the stay link alone, a code the guest
  types, or the last digits of the guest's phone? → A: Holding a working stay link verifies the
  guest. Owners and admins may also require a confirmation code per property: Guidesk generates a
  6-character code per stay link, shown on the Share screen and in the stay message, entered once
  per device. Phone digits are rejected (spec 002 does not keep them, SEC-03 needs 6 characters,
  PC-03). The property link never unlocks codes.
- Q: May a verified guest save the arrival steps with the code for offline use until checkout
  (OQ-28)? → A: No, not in the MVP. Public pages already viewed stay readable offline; the code
  field asks for a connection and points to the booking messages, where the stay message can carry
  the code (FR-04.5). Revisit with pilot data.
- Q: When does the stay window open and close? → A: From 00:00 on the check-in day to 2 hours
  after the checkout time on the checkout day, in the property's time zone, following the stay's
  current dates.
- Q: Who may copy stay links, given that a stay link shows codes to whoever opens it? → A: Owners
  and admins only, after a recent sign-in (as for revealing a code), and each copy is recorded.
  Agents see the property link, the template, and the QR code, never stay links.
- Q: On how many devices may one stay link be opened? → A: Up to 10 devices per stay link; later
  devices get the public guide and a note to ask the host for a new link.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open the guide from the property link or the QR code (Priority: P1)

Ana published the guide for Casa Colibrí (spec 003). On the Share screen she copies the property
link and the ready-made scheduled message, adds the message to her Airbnb scheduled messages (sent
after a booking is confirmed), and prints the QR poster for the kitchen wall. Emily, a guest from
Toronto, taps the link on her phone. The guide opens in English because her phone is in English,
with no app to install and no account to create. She sees the property name, the tiles
for Arrival, Wi-Fi, House rules, and the rest in the host's order, check-in at 3:00 pm, and the
address with a "Open in Maps" button. The Wi-Fi password shows because Ana made it public; the
lockbox code in Arrival shows a lock and "Codes appear only with your stay link. Your access
details are also in your booking messages." A restaurant Ana recommends carries the note "Your
host may receive a benefit from this business." Emily switches to Spanish to show her friend, and
the choice is remembered on her phone.

**Why this priority**: This is the guest-facing product. Without it the published guide (spec 003)
reaches nobody, and the agent (spec 005) has no place to live. The property link alone already
answers the most common questions (Wi-Fi, house rules, checkout) without exposing any code.

**Independent Test**: For a property with a published guide in Spanish and English, an owner copies
the property link and downloads the QR code; a phone browser in English opens the link (or scans
the QR) and sees the published content in English with every locked field as a placeholder, can
switch to Spanish, and never sees draft content; unpublishing the guide makes the same link show
the unavailable page.

**Acceptance Scenarios**:

1. **Given** a property with a published guide, **When** an owner or admin opens its Share screen,
   **Then** they see the property link with Copy and Open actions, a QR code they can download as
   PNG and SVG and print as a poster, and a scheduled-message template in Spanish and English that
   contains the property link and steps for adding it to the platform's scheduled messages.
2. **Given** the property link, **When** a guest opens it on a phone, **Then** the guide home shows
   the property name, the visible sections of the last published version in the
   host's order, and the current check-in and checkout times, with no sign-in, download, or form.
3. **Given** a browser whose preferred language is English and a guide published in Spanish and
   English, **When** the guest opens the guide, **Then** it shows in English; **When** the guest
   switches to Spanish, **Then** every page shows in Spanish and the choice is kept on that device.
4. **Given** a browser whose preferred languages are neither Spanish nor English, **When** the guest
   opens the guide, **Then** it shows in the guide's primary language, and the language switch is
   available.
5. **Given** a content item that has no translation in the guest's language, **When** the guest
   views its section, **Then** the item shows in the language it was written in, with a short note
   that it is not translated yet.
6. **Given** a section with a locked field (door, gate, lockbox, or alarm code, or a Wi-Fi password
   that is not public), **When** a guest views it from the property link, **Then** the field shows
   a placeholder with its label ("Lockbox code"), a lock, the reason ("Codes appear only with your
   stay link"), and the reminder that access details are also in the booking messages; the value is
   not anywhere in the page or its data.
7. **Given** a Wi-Fi password the host made public (spec 003 FR-021), **When** a guest views Wi-Fi
   from the property link, **Then** the network name and password show with Copy actions.
8. **Given** a recommendation for which the host answered "yes" to the benefit question (spec 003),
   **When** a guest views it, **Then** a disclosure appears next to it, in the guest's language,
   saying the host may receive a commission or other benefit from that business.
9. **Given** the host edits the draft after publishing, **When** a guest opens the guide, **Then**
   they see the published version only; **Given** the host changes the check-in time in the property
   details or a locked field value, **When** a guest opens the guide, **Then** the new time shows
   (and, for verified guests in the window, the new value) without republishing.
10. **Given** the guide is unpublished, the property is archived or deleted, the workspace is pending
    deletion, or the property link was regenerated, **When** someone opens the old link, **Then** they
    see a friendly page saying the guide is not available and to check their booking messages, with
    no property details.
11. **Given** a guest on any page, **When** they tap Emergency in the top bar, **Then** they see the
    guide's Emergency section and the local emergency number for the property's country.
12. **Given** a search engine or a link preview service, **When** it fetches any guide page, **Then**
    the page is marked not to be indexed and the address is not sent to other sites when the guest
    follows a link.

---

### User Story 2 - Send each booking a stay link that unlocks the codes during the stay (Priority: P1)

Ana's calendar feed (spec 002) lists Emily's stay from Friday 12 December to Monday 15 December.
On the Share screen, under Upcoming stays, Ana taps "Copy stay link" for that stay (she confirms her
sign-in first, because the link unlocks codes) and pastes it in Emily's Airbnb thread. Emily opens
it on Wednesday: the address bar changes to the guide's clean address, the home shows her stay card
(Fri 12 Dec 3:00 pm to Mon 15 Dec 11:00 am), and the lockbox code says "Available from Fri 12 Dec
(Sámara time)". On Friday at 9:40 pm she opens the guide from her home screen, taps Arrival, taps
"Show code", and sees 2 7 0 4 in large digits with a copy button and "Your host can see when the
code was viewed." On Monday afternoon the code is hidden again: "Your stay has ended." Ana sees on
the stay row that the link was opened on 2 devices and the code was viewed once.

**Why this priority**: Arrival is when guests need the guide most, and the code is the one thing
they cannot get from the public link. SEC-01 and FR-04.4 make the stay link the only way to show
restricted values to guests, so the access promise of the product depends on this story.

**Independent Test**: For a property with a published guide, a lockbox code locked field, and a
stay, an owner copies the stay link; a phone opens it before the stay (placeholder with the unlock
date), during the stay (Show code reveals the value, logged), and after checkout plus the buffer
(placeholder, "This stay link has ended"); the owner revokes the link and the same phone loses the
unlock on its next request.

**Acceptance Scenarios**:

1. **Given** a property with stays from a calendar feed, a PMS import, or manual entry (spec 002),
   **When** an owner or admin opens the Share screen, **Then** they see the stays whose checkout plus
   the buffer has not passed, each with its dates, channel, and stay link status (Not copied yet,
   Active, Opened on N devices, Revoked, Ended), and Copy stay link, Revoke, and Regenerate actions.
2. **Given** an owner or admin without a recent sign-in, **When** they copy or regenerate a stay
   link, **Then** they are asked to confirm their sign-in first (as for revealing a code), and the
   copy is recorded with who did it and when.
3. **Given** a stay link, **When** a guest opens it for the first time on a device, **Then** the
   link is exchanged for a session on that device and the browser moves to the guide's clean address
   without the token; reloading, sharing the clean address, or opening the guide from the home screen
   never shows the token again.
4. **Given** a guest with a stay session before the check-in day, **When** they view a locked field,
   **Then** it shows a placeholder with the date and time it becomes available, in the property's
   time zone (and in the phone's time zone when it differs).
5. **Given** a guest with a stay session inside the stay window, **When** they tap "Show code",
   **Then** the value appears in large characters with a Copy action, screen readers read it
   character by character, and the reveal is recorded for the host's reveal history.
6. **Given** a guest inside the stay window, **When** they view a section, **Then** locked values are
   not shown until they tap "Show code", so a code is never on screen by accident.
7. **Given** a stay session after checkout plus the buffer, **When** the guest opens the guide,
   **Then** locked fields show "Your stay has ended", the stay card is gone, and the public content
   remains.
8. **Given** an expired, revoked, or regenerated stay link, or a stay that was cancelled or deleted,
   **When** anyone opens the old link, **Then** they see the public guide with a short note "This
   stay link has ended" and no stay details; devices that already had a session lose the unlock on
   their next request.
9. **Given** a stay whose dates change in the calendar feed or the PMS, **When** the guest opens the
   guide, **Then** the stay card and the stay window follow the new dates without a new link.
10. **Given** a stay link already opened on 10 devices, **When** an 11th device opens it, **Then**
    that device gets the public guide with a note to ask the host for a new link, and the host sees
    the limit reached on the stay row.
11. **Given** a stay marked "may be a block" or hidden (spec 002), **When** the host views Upcoming
    stays, **Then** hidden stays are not listed and "may be a block" stays are labeled so, with
    their stay link available.
12. **Given** an agent of the workspace, **When** they open the Share screen, **Then** they can copy
    the property link, the scheduled-message template, and the QR code, but they see no stay links,
    stay messages, or Revoke and Regenerate actions.

---

### User Story 3 - Ask guests for a confirmation code before showing codes (Priority: P2)

Marta manages twelve apartments for owners who worry that a forwarded link could open the door.
In the property's sharing settings she turns on "Ask for a confirmation code". Each stay now shows
a 6-character code next to its stay link, and the stay message includes it on its own line. A guest
who opens the stay link and taps "Show code" first sees "Enter the confirmation code from your
booking messages" (`G-04`), types it once, and is not asked again on that device. Someone who got
hold of the forwarded link tries random codes; after 5 wrong tries the stay is paused for 15 minutes
with a countdown, and Marta gets an alert.

**Why this priority**: The stay link alone meets SEC-01 for most hosts. Managers and owners with
higher-value properties want a second factor against forwarded or leaked links, but the guide works
without it.

**Independent Test**: An owner turns on the confirmation code for a property; a guest with a stay
session inside the window is asked for the code before the first reveal, a correct code unlocks the
device, 5 wrong codes lock the stay for 15 minutes and alert the owners and admins, and turning the
setting off removes the step for new reveals.

**Acceptance Scenarios**:

1. **Given** an owner or admin, **When** they turn on "Ask for a confirmation code" for a property,
   **Then** every current and future stay link of that property gets its own code of 6 characters
   from an alphabet without look-alike characters, shown next to its stay link on the Share screen.
2. **Given** confirmation is required and a guest with a stay session inside the window, **When**
   they tap "Show code" for the first time on that device, **Then** they are asked for the
   confirmation code, with where to find it ("in your booking messages") and the reminder that access
   details are also there.
3. **Given** the correct code, **When** the guest submits it, **Then** the device is verified for
   the rest of the stay, the value is shown, and the guest is not asked again on that device.
4. **Given** wrong codes, **When** a device, a network address, or the stay reaches 5 failures within
   15 minutes, **Then** further attempts for that stay are refused for 15 minutes (doubling for each
   later lockout of the same stay, up to 24 hours), the guest sees a countdown and the booking
   messages fallback, and the owners and admins of the workspace get an alert.
5. **Given** a stay link that is regenerated, **When** confirmation is required, **Then** the stay
   also gets a new confirmation code and earlier verified devices must verify again.
6. **Given** a guest with a stay session before the window or after it, **When** they view a locked
   field, **Then** they are not asked for the code (nothing can be shown yet).

---

### User Story 4 - Deliver the access instructions through the booking thread too (Priority: P2)

Using the guide is optional for guests (PC-01, PC-02), so Ana wants the essentials in the Airbnb
thread as well. For Emily's stay she taps "Copy stay message", picks English, and gets a short
message with the stay link, the check-in time, the address, the arrival steps from her published
guide as plain text, and, because she ticked "Include access codes" after confirming her sign-in,
the lockbox code and the Wi-Fi password. She pastes it into the thread. For the scheduled message
that goes to every booking, she uses the template with the property link, which never carries codes.

**Why this priority**: It is a platform policy requirement (FR-04.5) and the fallback that keeps
guests from being locked out when they cannot or will not open the guide, but hosts can already
write this message themselves, so it ranks after the links.

**Independent Test**: For a stay of a property whose published Arrival section has steps and a
lockbox code, an owner copies the stay message in Spanish and in English, with and without access
codes; the text has the stay link, times, address, and steps, includes the code only when chosen
after a recent sign-in, and the copy with codes appears in the reveal history.

**Acceptance Scenarios**:

1. **Given** a stay, **When** an owner or admin chooses "Copy stay message" and a language (Spanish
   or English), **Then** they get plain text with a greeting, the stay link, the check-in and
   checkout times, the address, the arrival steps of the published Arrival section in that language,
   the Wi-Fi network, the confirmation code when one is required, and a closing line, ready to paste.
2. **Given** "Include access codes" is ticked, **When** the host copies the message, **Then** they
   must have a recent sign-in, the message includes the values of the locked fields that Arrival and
   Wi-Fi reference, and the copy is recorded in the property's reveal history as an export.
3. **Given** "Include access codes" is not ticked, **When** the host copies the message, **Then**
   each locked field is replaced by its label and "(shown in your stay link)".
4. **Given** the scheduled-message template, **When** it is copied, **Then** it contains the
   property link and no codes, stay links, or stay details, and its wording meets PC-05 and PC-06
   (no links before booking confirmation, nothing that moves the booking or payment off-platform).
5. **Given** a message text, **When** it is generated, **Then** it uses only the published guide and
   the property's current core facts, never draft content, and it has no guest name or other guest
   data.

---

### User Story 5 - Keep the guide readable with a weak or no connection (Priority: P3)

Emily's phone loses signal at the gate on Friday night. The arrival steps and photos she opened at
the airport still show, with a banner "Offline, saved copy from 6:12 pm". The lockbox code is not
saved on her phone: the code field says "Connect to the internet to show the code. Your access
details are also in your booking messages." She opens her Airbnb messages, where Ana's stay message
has the code.

**Why this priority**: Rural Costa Rica has weak coverage and guests often arrive at night on mobile
data. Offline reading improves the experience, but the booking-messages fallback (US4) already keeps
guests from being locked out.

**Independent Test**: A phone opens the guide home, Arrival, and Wi-Fi online, goes offline, and
can still open those pages with their images and the offline banner; a section never opened shows
"Not saved for offline use"; a locked value revealed online is not present in any offline storage
of the device.

**Acceptance Scenarios**:

1. **Given** a guest who opened the home and some sections online, **When** the connection drops,
   **Then** those pages and the images they showed still open, with a banner giving the time of the
   saved copy.
2. **Given** a section the guest never opened, **When** they open it offline, **Then** they see
   "This page isn't saved for offline use" and the booking-messages reminder.
3. **Given** a verified guest inside the window who revealed a code online, **When** they go offline,
   **Then** the code field says "Connect to the internet to show the code" with the booking-messages
   fallback, and no locked value is kept in the device's offline storage.
4. **Given** the guide was republished or unpublished while the guest was offline, **When** the
   device is online again and the guest opens the guide, **Then** the saved copy is replaced by the
   current version or, if unpublished, removed and the unavailable page shown.
5. **Given** a slow mobile connection, **When** a guest opens the guide for the first time, **Then**
   text appears before photos, photos and videos load at reserved sizes so the page does not jump,
   and videos show a poster image and load only when played.

---

### User Story 6 - Know that guests open the guide, without tracking them (Priority: P3)

Ana wants to know whether guests use the guide before she spends more time on it. The Share screen
shows "Opened 34 times in the last 30 days" for the property link, and each stay row shows whether
its stay link was opened and on how many devices. Nothing tells her who the guests are, and Guidesk
keeps no guest identifiers.

**Why this priority**: The counts feed the analytics of spec 010 and the pilot metrics, but guests
get no value from them, so they come last.

**Independent Test**: Opening the property link on two devices and a stay link on one device, on
two days, produces the expected counts per property, per day, per link type, and per stay, and the
stored records contain no network address, device fingerprint, or guest identifier.

**Acceptance Scenarios**:

1. **Given** a guest opens the guide, **When** the home loads, **Then** one open is counted for that
   property, day, and link type (property link or stay link), at most once per device per day.
2. **Given** a stay link, **When** its devices open the guide, **Then** the stay row shows whether it
   was opened, on how many devices, when it was first opened, and how many times a code was shown.
3. **Given** the counts, **When** they are stored, **Then** they hold no network address, browser
   details, location, or guest identifier, and the per-day counts per property are kept for later
   analytics (spec 010).
4. **Given** a search engine, link preview service, or monitoring check, **When** it fetches a guide
   page, **Then** it is not counted when it identifies itself as automated.

---

### Edge Cases

- **Guide published in one language only:** no language switch is shown; the guide shows in that
  language whatever the browser prefers.
- **Section hidden or empty in the published version:** it does not appear as a tile or page.
- **Locked field referenced in the published version but deleted or not set:** guests see the label
  with "Ask your host" instead of a placeholder that never unlocks; the host saw a publish warning
  (spec 003 FR-050).
- **Host changes a lockbox code during the stay:** the next "Show code" shows the new value (FR-052
  of spec 003); a code already on screen does not change until the guest taps "Show code" again.
- **Host makes the Wi-Fi password public, or locks it again:** the change applies on the next page
  load for every link type.
- **Overlapping stays (spec 002 marks them):** each stay has its own link and window; a device with
  two stay sessions for the same property uses the one whose window contains the current time, or
  the most recent one.
- **Same-day turnover:** the leaving guest's window ends at checkout plus the buffer and the arriving
  guest's window starts at 00:00 on the check-in day; both can see codes during that overlap, which
  the host controls by changing codes between stays.
- **Check-in date far in the future:** the stay link works now and shows the unlock date; it never
  expires before checkout plus the buffer.
- **Stay link opened in a link preview (OTA app, messaging app):** the preview fetch does not count
  as a device and does not consume the token, because exchanging the token needs the guest's browser
  to accept the session.
- **Browser with cookies blocked:** the stay link still shows the public guide and explains that
  codes need cookies enabled, with the booking-messages fallback.
- **Guest opens the property link on a device that already has a stay session for that property:**
  the stay session still applies (it belongs to the device, not the address).
- **Property link regenerated while posters are printed:** the old QR shows the unavailable page;
  the Share screen warns before regenerating that printed posters stop working.
- **Clock skew on the guest's phone:** the window is decided by Guidesk's time in the property's
  time zone, never the phone's clock.
- **Property time zone changes after links are sent:** windows are recalculated in the new time
  zone.
- **Guide restored from an older version (spec 003):** guests see it only after it is published.
- **Very long guide (many custom sections, many photos):** the home loads only the tiles and the
  first section's text; other sections load when opened.
- **Guest scans the QR code inside the house with no signal:** the page cannot load; the poster
  carries the Wi-Fi network name and a line telling guests that the guide also arrived in their
  booking messages.
- **Stay with no check-in or checkout time of its own:** the property's times apply (spec 002).
- **Workspace or property restored within 30 days:** links work again, unless they were regenerated
  or their stays ended.
- **Confirmation code typed with lower case or spaces:** case and spaces are ignored.
- **Host turns off "Ask for a confirmation code" mid-stay:** devices that were never verified can show
  codes on their next reveal; codes stop being shown on the Share screen and in new stay messages.

## Requirements *(mandatory)*

### Functional Requirements

**Opening the guide**

- **FR-001**: Guests MUST be able to open a property's guide from a link or a QR code in a phone or
  desktop browser, with no app download, account, sign-in, or form (FR-04.1, PC-02).
- **FR-002**: The guide MUST be served from its own web origin, separate from the portal, the API,
  and user content (SEC-11).
- **FR-003**: The guide MUST show only the last published version of the property's guide (spec 003
  FR-052): its visible sections in the published order and each section's published content items.
  Drafts, unreviewed items, hidden sections, and earlier versions MUST NOT be served.
- **FR-004**: Core facts (check-in and checkout times, address, maximum guests) and locked field
  values MUST be resolved when the guest views the guide, not frozen in the published version.
- **FR-005**: The guide home MUST show the property name, a tile for each visible section in
  order with Arrival first, the check-in and checkout times, and an Emergency entry reachable from every page.
- **FR-006**: The address MUST offer "Open in Maps" and "Open in Waze" actions; Wi-Fi network names
  and public passwords MUST offer Copy actions.
- **FR-007**: The Emergency entry MUST show the guide's published Emergency section and the local
  emergency number for the property's country when Guidesk knows it (911 for Costa Rica).
- **FR-008**: Each recommendation for which the host declared a commission, discount, or other
  benefit (spec 003 FR-014) MUST show a disclosure next to it in the guest's language (FR-04.6,
  PC-07). The guide MUST show no offers, ads, or recommendations that the host did not publish.
- **FR-009**: Text formatting, images, and short videos MUST render as published, with links opening
  in a new context, never sending the guide's address to the destination. Content MUST be shown as
  sanitized formatted text; no stored markup or script from content may run.
- **FR-010**: Media MUST be served through short-lived signed addresses or a content delivery network
  from the user-content origin, sized for phones, with location metadata removed (spec 003).
- **FR-011**: When the guide is unpublished, the property is archived or deleted, the workspace is
  pending deletion or deleted, or the link is unknown, the guide MUST show a friendly unavailable
  page in the guest's language that reveals no property details and reminds the guest that their
  booking messages have the essentials. The response MUST NOT reveal which of these cases applies.
- **FR-012**: Every guide response MUST be marked not to be indexed by search engines, and the guide
  MUST tell browsers not to send its address as the referrer to other sites (SEC-02).

**Language**

- **FR-013**: The guide MUST choose its language from the browser's preferred languages among the
  guide's published languages (Spanish, English); when none matches, it MUST use the guide's primary
  language, the first of the property's guide languages (spec 002 FR-003) (FR-04.3).
- **FR-014**: Guests MUST be able to switch between the guide's published languages from every page;
  the choice MUST be remembered on that device and win over the browser's preference.
- **FR-015**: A content item with no published translation in the shown language MUST appear in the
  language it was written in, with a short note in the shown language. The guide's own labels,
  placeholders, and messages MUST always be in the shown language.
- **FR-016**: Dates and times MUST show in the property's time zone with its name; when the device's
  time zone differs, the device's time MUST also show.

**Links**

- **FR-017**: Each property with a guide MUST have one property link, identified by a random value of
  at least 128 bits, never sequential or derived from other identifiers (SEC-01, SEC-02).
- **FR-018**: The property link and the QR code MUST show public content only: every locked field
  MUST appear as a placeholder, except a Wi-Fi password the host made public (spec 003 FR-021).
- **FR-019**: Owners and admins MUST be able to regenerate the property link after a warning that the
  old link and printed QR codes stop working; the old link MUST then show the unavailable page.
- **FR-020**: Each stay of the property (spec 002: calendar feed, PMS import, or manual entry) that is
  not hidden MUST be able to have one stay link, identified by a random value of at least 128 bits,
  created when the host first copies it, never reused for another stay (SEC-01).
- **FR-021**: A stay link MUST stop working at the end of its stay window, when the host revokes or
  regenerates it, and when its stay is cancelled, hidden, or deleted. A stopped stay link MUST open
  the public guide with the note "This stay link has ended" and no stay details.
- **FR-022**: Only owners and admins MAY copy, regenerate, or revoke stay links and copy stay
  messages. Copying or regenerating a stay link MUST require a recent sign-in (within 10 minutes,
  SEC-05) and MUST be recorded with who did it and when. Agents MUST NOT see stay links.
- **FR-023**: On the first visit from a device, a stay link MUST be exchanged for a session on that
  device and the browser redirected to the guide's address without the token (SEC-02). The session
  MUST be held in a cookie that scripts cannot read, sent only over HTTPS, limited to the guide
  origin, and not sent on requests from other sites except top-level navigation.
- **FR-024**: A stay session MUST end when its stay link stops working (FR-021); a device with an
  ended session MUST lose any unlock on its next request.
- **FR-025**: A stay link MUST create sessions on at most 10 devices; further devices MUST get the
  public guide with a note to ask the host for a new link.
- **FR-026**: The guide MUST treat a request that only previews a link (an OTA or messaging app
  fetching it to build a preview) so that it neither creates a device session nor counts as a view.

**Stay window and showing codes**

- **FR-027**: The stay window MUST start at 00:00 on the stay's check-in day and end 2 hours after
  the stay's checkout time on the checkout day, in the property's time zone, using the stay's own
  times when set and the property's times otherwise (spec 002). It MUST follow the stay's current
  dates when they change.
- **FR-028**: A guest with a stay session MUST see a stay card with the stay's dates and check-in and
  checkout times, and no guest name or other guest data.
- **FR-029**: Locked field values MUST be shown only to a guest whose stay session is inside the
  stay window and who meets the property's verification (FR-033), and only after the guest taps
  "Show code" for that field (FR-04.4).
- **FR-030**: Before the window, a locked field MUST show when it becomes available; after the window
  it MUST show "Your stay has ended"; from the property link it MUST show that codes appear only with
  the stay link. Every locked state MUST repeat that access details are also in the booking messages.
- **FR-031**: A shown value MUST appear in large characters with a Copy action, MUST be read character
  by character by screen readers, and MUST say that the host can see when the code was viewed.
- **FR-032**: Each value shown to a guest MUST be recorded in the property's reveal history (spec 003)
  with the stay, the locked field, the device session, and the time, and no guest personal data
  (SEC-16). Reveals MUST be limited to 30 per device session per hour.

**Verification (OQ-20)**

- **FR-033**: Holding a stay link that is working MUST verify the guest by default. Owners and admins
  MUST be able to turn on "Ask for a confirmation code" per property; when on, a device MUST enter its
  stay's confirmation code once before the first value is shown (FR-04.4, SEC-03).
- **FR-034**: Confirmation codes MUST be generated by Guidesk, 6 characters long, from an alphabet
  without look-alike characters, one per stay link, replaced when the stay link is regenerated, and
  compared ignoring case and spaces, in constant time.
- **FR-035**: Wrong confirmation codes MUST be limited per device session, per network address, and
  per stay: after 5 failures within 15 minutes, attempts for that stay MUST be refused for 15 minutes,
  doubling for each later lockout of the same stay up to 24 hours. The owners and admins MUST be
  alerted at each lockout, and the guest MUST see a countdown and the booking-messages fallback.
- **FR-036**: The property link MUST NOT be able to unlock codes by any verification (UX gap 1): the
  guide MUST NOT ask guests for booking codes, phone digits, names, emails, or documents (PC-03,
  PC-04).

**Sharing in the portal**

- **FR-037**: Each property MUST have a Share screen with: the property link (Copy, Open), the QR code
  (download as PNG and SVG, and a printable poster with the property name, the Wi-Fi network name, and
  a line saying the poster opens the public guide and codes are in the booking messages), the
  scheduled-message template, and the upcoming stays with their stay links.
- **FR-038**: The scheduled-message template MUST exist in Spanish and English, contain the property
  link and no codes or stay details, include steps for adding it to Airbnb, Booking.com, and Vrbo
  scheduled messages set to send after the booking is confirmed (PC-05), and pass the PC-06 check.
- **FR-039**: For each stay, owners and admins MUST be able to copy a stay message in Spanish or
  English with the stay link, check-in and checkout times, address, published arrival steps as plain
  text, Wi-Fi network, the confirmation code when required, and the reminder that the guide is
  optional (FR-04.5, PC-01).
- **FR-040**: The stay message MUST include locked field values only when the host ticks "Include
  access codes" and has a recent sign-in; such a copy MUST be recorded in the reveal history as an
  export (SEC-05, SEC-16). Otherwise each locked field MUST appear as its label with "(shown in your
  stay link)".
- **FR-041**: The Share screen MUST list stays whose stay window has not ended, sorted by check-in
  date, with dates, channel, the "may be a block" label when it applies, and the stay link status:
  Not copied yet, Active, Opened on N devices, Device limit reached, Revoked, or Ended.
- **FR-042**: The Share screen MUST show the reminder "Keep your check-in instructions in your platform
  messages too. The guide is optional for guests." (PC-01, PC-02).
- **FR-043**: When the guide has never been published, the Share screen MUST say so and link to
  publishing; when the property has no stays and no calendar, it MUST explain how to connect a
  calendar or add a stay by hand (spec 002).
- **FR-044**: Agents MUST be able to view the Share screen, copy the property link and the
  scheduled-message template, and download the QR code; they MUST NOT see stays' links or messages,
  confirmation codes, or the regenerate, revoke, and confirmation settings.

**Offline and performance**

- **FR-045**: Pages and images the guest has viewed MUST remain readable offline on that device, with
  a banner giving the time of the saved copy (FR-04.2). Pages never viewed MUST say they are not
  saved for offline use.
- **FR-046**: Locked field values and responses that carry them MUST NOT be cached by the browser,
  the offline store, any shared cache, or the content delivery network (SEC-04). Offline, a locked
  field MUST say "Connect to the internet to show the code" with the booking-messages fallback
  (OQ-28 decision: no offline saving of codes).
- **FR-047**: When the device is online, a saved copy MUST be replaced by the current published
  version, or removed when the guide is no longer available.
- **FR-048**: The first page MUST show text before images, reserve space for images and videos so the
  layout does not shift, and load videos only when played, showing a poster first.

**View counts**

- **FR-049**: The guide MUST count guide opens per property, per day, and per link type, at most once
  per device per day, and per stay link: devices, first opened time, and values shown.
- **FR-050**: View counts MUST NOT store network addresses, browser details, location, or guest
  identifiers, and MUST exclude requests that identify themselves as automated.
- **FR-051**: The Share screen MUST show the property link's opens in the last 30 days and each stay
  link's opened state, devices, first opened time, and values shown.

**Roles, safeguards, and lifecycle**

- **FR-052**: Only owners and admins MAY turn the confirmation code on or off, regenerate the property
  link, and revoke or regenerate stay links; each change MUST be recorded in the security log.
- **FR-053**: Guide requests MUST be rate limited per network address so the guide cannot be scraped
  or link values guessed at scale; refused requests MUST get a plain "Try again in a moment" page.
- **FR-054**: Responses for unknown, stopped, and working tokens MUST NOT differ in a way that reveals
  whether a token ever existed, beyond the "This stay link has ended" note for tokens of the guide's
  own property opened from a device that held them.
- **FR-055**: Stay links and their sessions, confirmation codes, and failure counters MUST be deleted
  30 days after their stay window ends; per-day open counts MUST be kept for analytics (spec 010)
  without any per-device data.
- **FR-056**: Restoring a property or workspace within 30 days (specs 001 and 002) MUST make its
  working links open the guide again.

### Key Entities *(include if feature involves data)*

- **Property link**: The public address of a property's guide. Holds the property, a random
  identifier of at least 128 bits, its status (active or replaced), who regenerated it and when.
  One active per property.
- **Stay link**: The per-stay address that unlocks codes. Holds the stay, a hash of its random token
  (the token itself is shown to the host only when copied), its status (active, revoked, replaced,
  ended), the confirmation code when required (stored so it can be shown to the host, compared in
  constant time), who created, copied, revoked, or regenerated it and when, and the device count.
- **Stay session**: One device's session from a stay link. Holds the stay link, a hash of the session
  cookie, when it was created and last used, whether the device passed the confirmation code, and
  when it ends. No network address or device details.
- **Verification attempt counter**: Recent wrong confirmation codes per stay, per device session, and
  per network address (kept only for the 15-minute window), the lockout end, and the lockout count
  for the backoff.
- **Guest reveal**: A record in the property's reveal history that a value was shown to a guest: the
  stay, the locked field, the stay session, and the time. Also covers host exports of stay messages
  with codes.
- **Guide open count**: Opens per property, per day, and per link type, and per stay link (devices,
  first opened, values shown). Counts only.
- **Sharing settings**: Per property: whether a confirmation code is required.
- **Published guide view**: What the guest sees, assembled at view time from the published version
  (spec 003), the property's current core facts, the shared blocks it publishes with, the locked
  fields (placeholders or values), and benefit disclosures.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a mid-range phone over a simulated 4G connection, the guide home's main content is
  visible within 2.5 seconds on a first visit, layout shift stays at or below 0.1, and the first visit
  downloads at most 150 KB of compressed code and styles before images.
- **SC-002**: Opening a section from the home takes under 1 second on the same connection after the
  first visit, and under 300 milliseconds for a page already saved offline.
- **SC-003**: The guide meets WCAG 2.2 AA on every guest screen (automated checks with zero violations
  and a manual screen reader pass on the reveal flow).
- **SC-004**: In tests, no locked value appears in the property link's pages, the offline store, any
  cacheable response, logs, view counts, or the security log metadata; values appear only in reveal
  responses to sessions inside their window and in host exports.
- **SC-005**: 100% of stay links stop unlocking within 1 minute of revocation, regeneration, stay
  cancellation, or the end of the window.
- **SC-006**: A host copies a stay link or a stay message in under 30 seconds from opening the Share
  screen, on a phone.
- **SC-007**: In the pilot, at least 60% of stays whose host sent a stay link have it opened before
  check-in, and no guest is blocked from entering because of the guide (no support case where the
  only copy of the code was the guide).
- **SC-008**: Guessing tokens or confirmation codes is impractical: 128-bit links, and at most 5
  wrong codes per stay per 15 minutes with growing lockouts, verified by an automated abuse test.
- **SC-009**: The guide serves 200 guide opens per second with the home answered in under 300
  milliseconds at the 95th percentile, and a reveal in under 500 milliseconds at the 95th percentile.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature shows restricted data (locked field values) to unauthenticated guests, creates
bearer links and device sessions, and is the public face of every workspace.

### Threats (STRIDE)

- **S**: A former guest, or anyone who got a forwarded stay link, opens it to see the door code
  outside the stay or as someone else.
- **S**: An attacker guesses property links, stay links, or confirmation codes.
- **S**: An agent or a stolen host session copies a stay link to see a code without the reveal
  step-up of spec 003.
- **T**: Content in a published guide carries a script or a link that runs code in the guide.
- **T**: Another site frames the guide to trick guests (clickjacking), or makes requests with the
  guest's session.
- **R**: A host and a guest dispute whether and when the code was viewed.
- **I**: A token leaks through the address bar, browser history, the referrer, logs, link previews,
  or a search engine.
- **I**: A code is cached by the content delivery network, the offline store, or a shared browser,
  and shown to the next guest or a stranger.
- **I**: The guide reveals drafts, unreviewed items, guest names, stay dates to the wrong person, or
  which workspace or property a link belongs to when it is unavailable.
- **I**: View counts become a way to track guests.
- **D**: Bots scrape guides or flood verification and reveals.
- **E**: A guest session reaches the portal or the API's host routes.

### Controls Applied

- **SEC-01**: Two link types (FR-017 to FR-021): the property link shows public content only; stay
  links are random 128-bit tokens, one per stay, ending at the end of the stay window, revocable.
- **SEC-02**: The stay token is exchanged for a host-only, `HttpOnly`, `Secure`, `SameSite=Lax`
  cookie and a redirect to a clean address (FR-023); `Referrer-Policy: no-referrer` and
  `X-Robots-Tag: noindex` on every response (FR-012); tokens never logged.
- **SEC-03**: Optional confirmation codes of 6 characters, constant-time comparison, limits per
  device, network address, and stay, 15-minute lockout with backoff, host alert (FR-033 to FR-035).
- **SEC-04**: `Cache-Control: no-store` on every response that carries a value; the offline store
  keeps public pages only; no offline saving of codes (FR-046).
- **SEC-05**: Copying or regenerating stay links and exporting codes in stay messages need a recent
  sign-in (FR-022, FR-040).
- **SEC-06**: Values are decrypted only by the reveal service of spec 003, for a session that passes
  the window and verification checks.
- **SEC-07** (denial of wallet, adapted): rate limits on guide requests, reveals, and verification
  (FR-032, FR-035, FR-053).
- **SEC-10**: Media from the user-content origin through short-lived signed addresses (FR-010).
- **SEC-11**: Own origin, nonce-based Content Security Policy, `frame-ancestors 'none'`, `nosniff`,
  restrictive `Permissions-Policy`, HSTS (FR-002, FR-009); guest sessions have no access to host
  routes.
- **SEC-14**: Guide reads resolve the workspace from the link server-side; RLS applies to every
  table the guide reads.
- **SEC-16**: Guest reveals, host exports, link copies, revocations, regenerations, and lockouts are
  recorded (FR-022, FR-032, FR-040, FR-052).
- **SEC-20**: No guest personal data asked or stored; counts only (FR-036, FR-049, FR-050).

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given a property link, when anyone loads any guide page or data from it, then no
  locked value (other than a public Wi-Fi password) is in any response.
- **AC-SEC-002**: Given a stay link whose window has ended, or that was revoked, regenerated, or
  belongs to a cancelled stay, when it or a session created from it requests a value, then the
  request is refused and the guest sees the ended state.
- **AC-SEC-003**: Given a stay session before the check-in day, when it requests a value directly
  (not through the page), then the request is refused.
- **AC-SEC-004**: Given confirmation is required, when a session requests a value without having
  passed the code, then it is refused; when 5 wrong codes arrive for a stay within 15 minutes from
  different devices or addresses, then the stay locks for 15 minutes and the owners and admins are
  alerted.
- **AC-SEC-005**: Given random property link and stay link values, when 10,000 are tried, then none
  opens a guide, the attempts are rate limited, and responses do not reveal whether a value ever
  existed.
- **AC-SEC-006**: Given a stay link opened, when the response is inspected, then it redirects to an
  address without the token, sets the session cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, and
  no domain wider than the guide origin, and the token appears in no log line.
- **AC-SEC-007**: Given any response carrying a value, when it is inspected, then it has
  `Cache-Control: no-store`, and after a reveal the offline store contains no value.
- **AC-SEC-008**: Given an agent, when they request stay links, stay messages, confirmation codes, or
  the sharing settings through the API, then they are refused and the refusal is logged.
- **AC-SEC-009**: Given an owner without a recent sign-in, when they copy a stay link or a stay
  message with codes, then they are asked to confirm their sign-in first.
- **AC-SEC-010**: Given published content with markup, a script, or a `javascript:` link that got
  past earlier checks, when the guide renders it, then nothing runs and the link is not active.
- **AC-SEC-011**: Given another site, when it frames the guide or posts to a guide action with the
  guest's cookie, then the browser refuses the frame and the action is refused.
- **AC-SEC-012**: Given links of an unpublished guide, a deleted property, or a workspace pending
  deletion, when the old links are opened, then the unavailable page shows with no property name
  or workspace detail.
- **AC-SEC-013**: Given a guest stay session cookie, when it is sent to the API's host routes or the
  portal, then it grants nothing.
- **AC-SEC-014**: Given the view counts and reveal records, when they are inspected, then they contain
  no network address, browser details, or guest identifier.
- **AC-SEC-015**: Given a guide session of one property, when it requests data of another property or
  another workspace's stay, then it is refused as not found.

### Platform Policies

- **PC-01** and **PC-02**: The guide stays optional; the stay message and the scheduled-message
  template carry the essentials through the OTA thread (FR-038 to FR-040); every locked state
  repeats the booking-messages fallback; access never depends on opening the guide.
- **PC-03** and **PC-04**: Guests are never asked for contact data, booking codes, or documents;
  verification uses only Guidesk-generated codes (FR-036).
- **PC-05**: The scheduled-message template tells hosts to send it after the booking is confirmed
  and contains no pre-booking link (FR-038).
- **PC-06**: Templates and stay messages contain nothing that moves the booking or payment
  off-platform (FR-038, US4).
- **PC-07**: Benefit disclosures appear next to recommendations (FR-008).

## Assumptions

- OQ-20 is decided as: the stay link is the verification, with an optional Guidesk-generated
  confirmation code per stay. The last four digits of the guest's phone were rejected: spec 002
  (FR-022) does not keep them, SEC-03 requires codes of at least 6 characters, and asking guests
  for phone data conflicts with PC-03. Hosts who deliver the guide only through OTA scheduled
  messages share the property link with everyone and copy a stay link per booking when they want
  guests to see codes in the guide (UX gap 1 stays open for PMS-driven delivery in a later spec).
- OQ-28 is decided as: no offline saving of codes in the MVP. Guests keep the code through the stay
  message in their booking thread (US4) or by copying it. The decision is revisited with pilot data.
- The 2-hour buffer after checkout and the 00:00 start on the check-in day are pilot defaults; per
  property settings can come later.
- The guide's domain is not final (OQ-11); the plan uses a separate guide origin per stage.
- Disclosure and template wording are proposals for the legal review (OQ-35); the Spanish register
  is "tú" in neutral Latin American Spanish, as in the portal.
- The local emergency number list starts with the pilot countries (Costa Rica first) and grows later.
- The in-guide chat (spec 005) adds the Ask entry and the chat screen later; this feature leaves room
  for it in the navigation but shows no chat entry. Explore, Extras, and tours (specs 008, 009) are
  not shown.
- Host notifications for lockouts use the alert channel of spec 003 (owner alerts for the reveal
  limit).
- Analytics dashboards (spec 010) read the per-day counts later; this feature only stores them and
  shows the totals on the Share screen.
- Installing the guide as a home screen app is allowed by the browser but not prompted.
