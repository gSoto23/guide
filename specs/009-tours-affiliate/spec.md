# Feature Specification: Tours and Experiences (Affiliate)

**Feature Branch**: `009-tours-affiliate`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "009 Tours and experiences (affiliate) (PRD F09, FR-09.1 to FR-09.3; FR-05.5 and PRD §6.3 commerce rules; policies PC-07 disclosure, PC-08 opt-in, PC-10 no unsolicited promotion in OTA threads; open questions OQ-08 host share of affiliate commissions and OQ-34 affiliate program accounts). Guests see an "Experiences" page in the guest guide (spec 004) with curated tours and activities near the property from affiliate partners, initially Viator and Civitatis (GetYourGuide later). Each experience shows a title, a photo, a short description, the duration, a price from (in the partner's currency), the rating when the partner provides it, the partner's name, and a commission disclosure. Tapping an experience opens the partner's page in a new tab through a Guidesk click redirect on the guide origin that adds the affiliate tracking; the click is counted per property, experience, and partner with no personal data (for analytics in spec 010). No booking or payment inside Guidesk (a later phase). Experiences are chosen by the property's city, region, and country (spec 002) from the partner's catalog: through a partner's affiliate content feed or API where Guidesk has access, otherwise from a Guidesk-curated list per destination; results are cached per destination and refreshed daily, so the guide never waits on a partner when a guest opens it. At most 12 experiences per property, grouped by category (for example tours, food and drink, outdoor and adventure, water, culture, day trips), in the guest's language when the partner provides it. Hosts (members who can edit the guide) manage the page per property in the portal: turn it on or off, hide categories, hide single experiences, pin their own recommendations from the guide (spec 003 recommendations) at the top, and preview it; a workspace default (on or off, hidden categories) applies to every property that has no override. The disclosure is always visible at the top of the page and on each card (Spanish and English: Guidesk may earn a commission if you book, at no extra cost to you); pinned host recommendations keep their own benefit disclosure (spec 004). Decide OQ-08 here: no commission share for hosts during the pilot; the disclosure names Guidesk. OQ-34: the founder joins the affiliate programs; affiliate IDs and partner API keys are deployment configuration; without them the page shows only pinned host recommendations, or is hidden when there are none; a fixtures partner adapter serves synthetic data locally and in tests. The guide chat (specs 005 and 007) may point guests who ask about tours or things to do to the Experiences page, but it never lists affiliate products itself and never sends unsolicited offers in this spec; copilot drafts for booking platforms (spec 006) never include affiliate links (PC-10). Partner content is untrusted: text is shown as plain text, links go only to allowlisted partner domains over HTTPS, and images load without revealing the guest's page. The page meets the guest guide's performance budget (spec 004, LCP 2.5 s on a mid-range phone on 4G, small JavaScript) and WCAG 2.2 AA, in Spanish and English. Edge cases: a property without a city, no partner coverage for the destination, a partner outage (show the cached list, else hide), an experience the partner removed (dropped at the next refresh), mixed currencies, and a guest language the partner doesn't offer. Out of scope: in-app booking, commission reconciliation reports, revenue sharing, other partners (Booking.com, insurance), and unsolicited offers in the chat."

**Sources**: [PRD F09](../../docs/product/prd.md#f09--tours-and-experiences-affiliate) · [PRD §6.3 commerce rules](../../docs/product/prd.md) · [UX flow 8](../../docs/ux/user-flows.md#8-tour-affiliate-click-with-disclosure) · [Screens G-07, G-14, H-28, X-02](../../docs/ux/screens.md) · [Monetization partners](../../docs/research/monetization-partners.md) · [Platform policies PC-07, PC-08, PC-10, PC-11](../../docs/research/platform-policies.md) · [Security SEC-02, SEC-11, SEC-13, SEC-14, SEC-20](../../docs/architecture/security.md#4-controls) · [Open questions OQ-08, OQ-34](../../docs/open-questions.md) · [Spec 002](../002-property-onboarding/spec.md) · [Spec 003](../003-guide-builder/spec.md) · [Spec 004](../004-guest-guide/spec.md) · [Spec 005](../005-guide-chat/spec.md) · [Spec 006](../006-host-inbox/spec.md)

## Clarifications

### Session 2026-11-18

Answered with the recommended option under the founder's standing instruction to run all phases on
2026-11-18. Each answer can be changed by the founder; the spec follows the answer below until then.

- Q: Where do experiences appear in the guest guide? → A: In Explore (screen G-07), a tab of the guide's
  navigation next to the guide and the chat. Explore shows the host's own tips first (the
  recommendations of the published guide, spec 003, with their benefit disclosures), then "Experiences
  near {city}" grouped by category. Tapping an experience opens its detail (G-14); "Book on {partner}"
  opens the partner's site in a new tab. With no tips and no experiences, the tab is hidden.
- Q: What does "pin their own recommendations" mean? → A: The host's tips always appear above partner
  experiences, in the order the host gave them in the guide. Hosts reorder or remove tips in the guide
  editor (spec 003), and they appear in Explore once published; Explore adds no separate pin list.
- Q: Do hosts share the commission (OQ-08)? → A: Not during the pilot. The disclosure names Guidesk:
  "Guidesk may earn a commission if you book, at no extra cost to you." A host share can come later
  with its own disclosure text ("Your host and Guidesk may earn a commission").
- Q: Where does the list of experiences come from? → A: From each partner's catalog for the property's
  destination (city, region, country), through the partner's affiliate content access where Guidesk
  has it, otherwise from a short list per destination that Guidesk curates. Lists are refreshed in the
  background for destinations with published guides and kept only as long as each partner allows
  (Viator: search results for at most 1 hour, so its lists refresh at least hourly), so opening the
  guide never waits on a partner.
- Q: Who changes the Explore settings? → A: Owners and admins, who edit guides (spec 003); agents can
  view them. A workspace default (experiences on or off, hidden categories) applies to every property
  without its own settings; a property can follow the default or set its own and hide single
  experiences. Changes apply at once, without republishing the guide.
- Q: What if Guidesk has no affiliate account for a partner yet (OQ-34)? → A: That partner's
  experiences are not shown. With no partner available, Explore shows the host's tips only, or is
  hidden when there are none. Local development and tests use synthetic partner data.
- Q: May the assistant offer experiences? → A: When a guest asks about tours or things to do in the
  guide chat, the reply may point to Explore. In this spec the assistant never lists partner
  experiences itself and sends no unsolicited offers; copilot drafts for booking platforms never
  mention or link partner experiences (PC-10).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Guests discover experiences near the property (Priority: P1)

Lucía is staying in Sámara. She opens Explore in the guide and sees her host's tips first, then
"Experiences near Sámara": a canopy tour, a catamaran trip, a cooking class, each with a photo, the
duration, a price from, the rating, the partner's name, and the note that Guidesk may earn a
commission. She opens the catamaran trip, reads what is included, and taps "Book on Viator"; the
partner's page opens in a new tab and she books there.

**Why this priority**: It is the feature's value for guests and Guidesk's first revenue from guests
(business model: tour commissions), with no payment handling.

**Independent Test**: Publish a guide for a property in a destination with synthetic partner data, open
Explore from a phone, open an experience, tap "Book on {partner}", and confirm that the partner URL
opens in a new tab with the affiliate tracking, that the disclosure is on the list and the detail, and
that one click is counted.

**Acceptance Scenarios**:

1. **Given** a published guide for a property whose destination has experiences, **When** a guest opens
   Explore, **Then** the host's tips appear first and up to 12 experiences follow, grouped by category,
   each with a title, a photo (or a category illustration when there is none), the duration, a price
   from with its currency, the rating when known, the partner's name, and the disclosure.
2. **Given** an experience card, **When** the guest opens it, **Then** the detail shows the description,
   what is included when the partner provides it, the duration, the price from, the partner's name, and
   the disclosure next to "Book on {partner}".
3. **Given** the detail, **When** the guest taps "Book on {partner}", **Then** the partner's page for
   that experience opens in a new tab with Guidesk's affiliate tracking, the guide's address and any
   stay link token are not sent to the partner, and one click is counted for the property, the
   experience, and the partner.
4. **Given** a guest reading in Spanish, **When** a partner provides Spanish text, **Then** cards and the
   detail use it; otherwise they show the partner's text in English with a note that the experience is
   described in English.
5. **Given** a guest offline, **When** they open Explore after having opened it before, **Then** the
   cards they saw stay readable and "Book on {partner}" says it needs a connection.

---

### User Story 2 - Hosts choose what their guests see (Priority: P1)

Ana manages three cabins. In the portal she opens a property's Explore settings, sees the same list her
guests see, hides the "Water" category because the beach is far, hides a tour she doesn't recommend,
and previews the result. In the workspace settings she sets a default for every property: experiences
on, nightlife hidden.

**Why this priority**: Hosts must stay in control of what appears in their guide (FR-09.2); without it,
some hosts would turn the guide's commerce off entirely.

**Independent Test**: As an owner, hide a category and an experience on one property and set a workspace
default, then open the guest guide of that property and of another property and confirm that each
shows the right experiences without republishing.

**Acceptance Scenarios**:

1. **Given** an owner or admin, **When** they open a property's Explore settings, **Then** they see
   whether experiences are on, the categories with on or off switches, each experience with a hide
   switch, the host's tips that will appear first, and a preview of what guests see.
2. **Given** a host hides a category or an experience, **When** a guest opens Explore, **Then** that
   category or experience no longer appears, without republishing the guide.
3. **Given** a workspace default (experiences on or off, hidden categories), **When** a property follows
   the default, **Then** its Explore follows it; **When** a property sets its own settings, **Then** the
   default no longer changes it until the host chooses to follow the default again.
4. **Given** a host turns experiences off for a property, **When** a guest opens Explore, **Then** only
   the host's tips appear, and with no tips the Explore tab is hidden.
5. **Given** an agent (spec 001 role), **When** they open the Explore settings, **Then** they can see
   them but not change them.

---

### User Story 3 - Disclosures and safe links on every offer (Priority: P1)

Every experience a guest sees carries a clear commission disclosure, every link goes only to a known
partner site, and nothing about the guest travels to the partner beyond what the partner's own page
collects.

**Why this priority**: Disclosure is a platform policy (PC-07) and a legal requirement; the redirect is
an attack surface (open redirect, tracking) that must be safe from the first release.

**Independent Test**: Render Explore and the detail in both languages and check the disclosure on the
page and on every card; call the click address with a forged destination and with an unknown or hidden
experience and confirm that no request leaves for a non-partner site.

**Acceptance Scenarios**:

1. **Given** Explore with experiences, **When** it renders, **Then** the disclosure appears once at the
   top of the experiences and on every card and detail, in the guest's language, and hosts cannot turn
   it off.
2. **Given** a click address, **When** it is called for an experience that is hidden, removed, or not
   shown for that property, or with any destination added to the address, **Then** the guest lands on
   Explore and is never sent to an address that is not a stored partner page.
3. **Given** a partner description with markup, scripts, or links, **When** it is shown, **Then** it
   appears as plain text and nothing in it runs or links anywhere.
4. **Given** a host tip with a declared benefit (spec 003), **When** it appears in Explore, **Then** it
   keeps its own benefit disclosure (spec 004).

---

### User Story 4 - The list stays fresh without slowing the guide (Priority: P2)

Guidesk refreshes the experiences of each destination that has published guides in the background, as
often as each partner requires: new experiences appear, removed ones disappear, prices and ratings
update. When a partner is briefly down, guests still see the last list for as long as that partner
allows it to be kept.

**Why this priority**: Freshness keeps prices and links correct; isolation from partners keeps the
guide fast and available, which matters more than the offers.

**Independent Test**: With synthetic partner data, run the refresh, change the partner data (remove an
experience, change a price), run it again, and confirm the guide reflects it; make the partner fail and
confirm the guide still shows the last list while it may be kept, then without that partner, always
within its budget.

**Acceptance Scenarios**:

1. **Given** published guides in a destination, **When** the refresh runs, **Then** each partner's
   experiences for that destination are stored with their category, language versions, price, rating,
   photo, and partner link, and experiences the partner no longer lists are dropped.
2. **Given** a partner that fails or times out, **When** the refresh runs, **Then** the last stored
   list stays in use only until the time that partner allows content to be kept (for Viator, 1 hour
   after it was fetched), after which that partner's experiences are no longer shown, and the failure
   is logged without guest data.
3. **Given** a guest opens Explore, **When** the experiences are read, **Then** no partner is contacted
   during the guest's request.
4. **Given** a property whose destination changed (spec 002 edit), **When** the next refresh runs or the
   host opens the settings, **Then** experiences follow the new destination.

---

### User Story 5 - The assistant points guests to Explore (Priority: P3)

When Lucía asks the guide chat "¿Qué tours hay por aquí?", the assistant answers with the host's tips it
knows and points her to Explore for tours, with a link to it.

**Why this priority**: Useful but optional: guests find Explore on their own, and offers in the chat
need the stricter rules of PRD §6.3, which a later spec covers.

**Independent Test**: In the guide chat of a property with experiences, ask about tours and confirm the
reply includes a link to Explore, no partner experience or partner link, and passes the chat's checks.

**Acceptance Scenarios**:

1. **Given** a property with Explore visible, **When** a guest asks about tours, activities, or things
   to do, **Then** the reply may include a link to Explore and never names a partner experience or
   includes a partner link.
2. **Given** a property with Explore hidden, **When** a guest asks the same, **Then** the reply doesn't
   mention Explore.
3. **Given** a copilot draft for a booking platform (spec 006), **When** the guest asks about tours,
   **Then** the draft answers from the host's tips without a benefit and contains no Explore or partner
   link (PC-10).

### Edge Cases

- A property without a city or with an address the partners don't recognize: no partner experiences;
  Explore shows the host's tips, or is hidden.
- A destination no partner covers: same as above; the settings screen explains that no experiences are
  available for this destination yet.
- Two partners list the same tour: both may appear; the limit of 12 and the per-category balance keep
  the list short.
- Experiences in different currencies (for example USD and EUR): each shows its own currency; no
  conversion.
- A price or availability that changed since the last refresh: the partner's page is the source of
  truth; the card says "from" and the detail notes that the price is confirmed on the partner's site.
- A guest on a stay link: Explore is the same for property and stay links and never shows stay data.
- A guest taps the same experience many times, or a bot calls the click address: the guest is
  redirected each time; repeated clicks from one device count once per day and automated callers are
  not counted.
- Every experience in a category hidden: the category disappears.
- An unpublished or removed guide or property: Explore follows the guide's unavailable page (spec 004).
- The Guidesk affiliate account for a partner is removed from the deployment: that partner's
  experiences stop showing at once; stored click counts remain.
- A host tip that points to a partner experience page with the host's own affiliate code: it is a host
  tip with the benefit the host declared (spec 003), shown as such.

## Requirements *(mandatory)*

### Functional Requirements

**Explore in the guest guide**

- **FR-001**: The guest guide MUST offer an Explore entry in its navigation (a tile on the guide home)
  when the property has host tips or visible experiences, and MUST hide it when it has neither.
- **FR-002**: Explore MUST show the host's tips first (the recommendations of the published guide, in
  the guide's order, with their benefit disclosures), then the property's experiences grouped by
  category, at most 12 experiences.
- **FR-003**: Each experience card MUST show a title, a photo or a category illustration, the duration
  when known, the price from with its currency, the rating and number of reviews when the partner
  provides them, the partner's name, and the commission disclosure.
- **FR-004**: The experience detail MUST show the description, what is included when provided, the
  duration, the price from with a note that the partner's site confirms the price, the partner's name,
  and the disclosure next to "Book on {partner}".
- **FR-005**: Explore MUST show partner text in the guest's language when the partner provides it, and
  otherwise the partner's English text with a note saying so.
- **FR-006**: Explore MUST work offline for what the guest already saw, with "Book on {partner}"
  disabled and a note that it needs a connection.

**Clicks and links**

- **FR-007**: "Book on {partner}" MUST go through a Guidesk click address on the guide origin that
  redirects to the stored partner page for that experience with Guidesk's affiliate tracking, opening
  in a new tab.
- **FR-008**: The click address MUST redirect only to the stored partner page of an experience shown
  for that property; for any other experience, a hidden or removed one, or any address supplied by the
  caller, it MUST send the guest to Explore instead.
- **FR-009**: Leaving for a partner MUST NOT send the guide's address, the stay link token, or any guest
  data to the partner (no referrer).
- **FR-010**: The system MUST count clicks per property, per experience, per partner, and per day, at
  most once per device per experience per day, excluding callers that identify themselves as automated,
  and MUST NOT store network addresses, browser details, location, or guest identifiers with the counts.
- **FR-011**: The system MUST count Explore opens per property and per day under the same rules, for
  analytics (spec 010).

**Disclosure**

- **FR-012**: The commission disclosure MUST appear at the top of the experiences, on every card, and on
  every detail, in Spanish and English, and MUST NOT be removable by hosts.
- **FR-013**: During the pilot the disclosure MUST name Guidesk as the party that may earn a commission
  (OQ-08); hosts receive no commission share.

**Experience data**

- **FR-014**: The system MUST select a property's experiences from each available partner's catalog for
  the property's destination (city, region, and country from spec 002), through the partner's affiliate
  content access where Guidesk has it, or otherwise from a list per destination curated by Guidesk.
- **FR-015**: The system MUST refresh the experiences of each destination with published guides in the
  background, often enough that each partner's content is never shown longer than that partner allows
  it to be kept (Viator: 1 hour), adding new experiences, updating prices, ratings, and photos, and
  dropping experiences the partner no longer lists.
- **FR-016**: When a partner fails, the system MUST keep using its last stored list only until that
  partner's keeping limit and then stop showing that partner's experiences until a refresh succeeds;
  Guidesk's curated entries have no such limit.
- **FR-017**: Opening the guide or Explore MUST NOT contact any partner during the guest's request.
- **FR-018**: The system MUST sort and balance experiences so that no single category fills the list,
  preferring higher-rated experiences, and MUST apply the property's hidden categories and experiences
  before the limit of 12.
- **FR-019**: A partner MUST be used only when its affiliate account is configured for the deployment
  (OQ-34); without one, its experiences are not shown.
- **FR-020**: Experiences MUST use the categories tours, food and drink, outdoor and adventure, water,
  culture, day trips, and other, mapped from each partner's own categories.

**Host settings**

- **FR-021**: Owners and admins MUST be able to set a workspace default for Explore: experiences on or
  off, and hidden categories. Experiences are on by default with no hidden categories.
- **FR-022**: Owners and admins MUST be able to set a property to follow the workspace default or to use
  its own settings (experiences on or off, hidden categories), and to hide single experiences on that
  property.
- **FR-023**: The property's Explore settings MUST show the experiences guests would see, the host's tips
  that appear first, and a preview, and MUST explain when no experiences are available for the
  destination.
- **FR-024**: Agents MUST be able to view the Explore settings and MUST NOT change them.
- **FR-025**: Changes to Explore settings MUST apply to the guest guide without republishing, within 1
  minute.

**Assistant and copilot**

- **FR-026**: When a guest asks about tours, activities, or things to do and Explore is visible, the
  guide chat MAY include a link to Explore; it MUST NOT name partner experiences, include partner links,
  or send unsolicited offers.
- **FR-027**: Copilot drafts for booking platforms (spec 006) MUST NOT mention Explore or partner
  experiences or include their links (PC-10).

**Quality**

- **FR-028**: Explore and the experience detail MUST meet the guest guide's budget (spec 004: largest
  content shown within 2.5 seconds on a mid-range phone on 4G), load photos lazily at reserved sizes, and
  embed no partner widgets or scripts.
- **FR-029**: Explore, the detail, and the settings screens MUST meet WCAG 2.2 AA and be available in
  Spanish and English.

### Key Entities *(include if feature involves data)*

- **Partner**: An affiliate partner (Viator, Civitatis; later GetYourGuide) with its allowed web
  domains and whether the deployment has its affiliate account.
- **Destination**: A city, region, and country that properties share; holds each partner's last refresh
  time and status.
- **Experience**: A partner's product for a destination: partner product ID, category, title and
  description per language, what is included, duration, price from and currency, rating and review
  count, photo, partner page address, and when it was last seen.
- **Explore settings**: The workspace default and each property's own settings: experiences on or off,
  hidden categories, follows the default or not, and hidden experiences (per property).
- **Explore counts**: Per property, per day: Explore opens, and clicks per experience and partner. No
  personal data.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Explore and the experience detail show their largest content within 2.5 seconds on a
  mid-range phone on 4G, and adding Explore keeps the guide within its JavaScript budget (spec 004).
- **SC-002**: In tests, 100% of experience cards and details show the disclosure in both languages, and
  0 click addresses send a guest anywhere other than a stored partner page.
- **SC-003**: A guest reaches the partner's page in at most two taps from Explore, and the Guidesk click
  step adds less than 0.3 seconds at p95.
- **SC-004**: A host's change to Explore settings shows in the guest guide within 1 minute, without
  republishing.
- **SC-005**: When every partner fails, the guide still opens within its budget with the last stored
  experiences or without them; no guide error is caused by a partner.
- **SC-006**: Click and open counts contain no personal data, and each tap from one device counts at
  most once per experience per day.
- **SC-007**: In the pilot, at least 20% of stays with an opened guide open Explore, and at least 10% of
  those click an experience (pilot targets to tune, business assumption A-04).
- **SC-008**: Explore, the detail, and the settings screens pass automated accessibility checks (WCAG
  2.2 A and AA) with zero violations.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature adds an integration with outside catalogs, partner content shown to guests, and a redirect
on the guide origin.

### Threats (STRIDE)

- **S**: A crafted link uses Guidesk's click address to send guests to a phishing site (open redirect).
- **T**: Partner content carries scripts, markup, or links; a forged request changes a property's Explore
  settings.
- **R**: A host disputes which experiences their guide showed.
- **I**: The stay link token or guide address leaks to partners through the referrer; partner keys leak;
  click counts identify guests.
- **D**: A partner outage or slow response makes the guide slow; bots inflate click counts.
- **E**: An agent changes Explore settings; a member of another workspace reads or changes them.

### Controls Applied

- **SEC-02**: Partner pages open with no referrer, so stay link tokens and guide addresses never reach
  partners.
- **SEC-11**: Partner text is shown as plain text; links go only to allowlisted partner domains over
  HTTPS; no partner scripts or widgets run in the guide; partner photos load without referrer.
- **SEC-13**: Affiliate IDs and partner keys are deployment secrets with the least access the partner
  offers; partner calls happen only in background jobs with timeouts.
- **SEC-14**: Explore settings and counts follow tenant isolation; cross-tenant tests cover every new
  route.
- **SEC-16**: Changes to Explore settings are recorded in the security log with who and when.
- **SEC-20**: Counts hold no personal data; no guest data is sent to partners.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given a click address with an added destination or an unknown, hidden, or other
  property's experience, when a guest follows it, then they land on Explore and no redirect leaves for a
  non-partner address.
- **AC-SEC-002**: Given partner text containing HTML, script, or a link, when Explore shows it, then it
  appears as plain text and nothing runs or links.
- **AC-SEC-003**: Given a guest on a stay link, when they open a partner page, then the partner receives
  no referrer and no stay token.
- **AC-SEC-004**: Given an agent or a member of another workspace, when they try to change Explore
  settings, then the change is refused (403 for the agent, 404 for the other workspace) and the attempt
  is logged.
- **AC-SEC-005**: Given a partner that hangs or fails, when guests open the guide, then the guide answers
  within its budget and no guest request waits on the partner.
- **AC-SEC-006**: Given many clicks from one device or from automated callers, when they are counted,
  then they count at most once per device per experience per day and automated callers are not counted.

### Platform Policies

- **PC-07**: Every experience carries the commission disclosure at the point of offer; host tips keep
  their benefit disclosure.
- **PC-08**: Experiences are optional links; nothing in the guide, including access to the property,
  depends on them.
- **PC-10**: No unsolicited offers in booking platform threads: copilot drafts never include partner
  experiences or links, and the guide chat only points to Explore when asked.
- **PC-11**: No guest data is used for marketing or shared with partners.
- **PC-02**: The guide stays optional; Explore adds nothing guests must do.

## Assumptions

- Specs 002 to 007 are in place: properties with city, region, and country; published guides with
  recommendations and benefit answers; the guest guide with its navigation, offline cache, and counts;
  the guide chat; and the copilot.
- The founder joins the Viator and Civitatis affiliate programs and provides the affiliate IDs and any
  content access keys as deployment configuration (OQ-34, a founder gate). Until then, deployments show
  host tips only; local development and tests use synthetic partner data.
- Partner terms allow showing their product content (titles, photos, prices, ratings) with affiliate
  links; the plan confirms each partner's terms before its content is shown, and a partner whose terms
  don't allow it is limited to the curated list with Guidesk-written text.
- Bookings and commissions happen on the partners' sites; reconciling commissions, revenue sharing, and
  in-guide booking are later phases.
- The disclosure wording is a proposal for the legal review (OQ-35).
- The limits (12 experiences, the refresh frequency, how long each partner's content is kept) follow
  the partners' terms and are pilot values to tune within them.
- Unsolicited offers in the guide chat (PRD §6.3: at most one per conversation per day) come in a later
  spec with their own evals.
