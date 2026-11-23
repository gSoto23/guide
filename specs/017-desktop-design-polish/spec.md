# Feature Specification: Desktop Design and Usability Polish

**Feature Branch**: `017-ui-ux-polish`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "017 Desktop design and usability polish. Source: docs/ux/ui-ux-audit-2026-11.md (high- and medium-impact findings H1–H11, M1–M10). The founder's verdict: the product is designed for phones, which is right, but on a desktop it shows the same thing stretched; they want a real desktop design that carries the brand, with care for aesthetics and usability. Keep the phone design as it is (it was accepted), and from 600 px and 1024 px change the shape of the same components: buttons size to their label, filters in one toolbar row, tabs as a segmented control, cards with an edge, badges never stretch, option cards with icons and a chosen state, the workspace menu above the navigation, two-column property overview, guide builder actions hierarchy and checklist rows, request cards in a grid with a facts grid and status colors by meaning, inbox rows with icons and localized dates, settings index as icon cards, add-property options as a grid of icon cards, short form fields side by side, the shell rendered immediately with a loading skeleton, the editor toolbar as a compact row (also broken on phones), the public home feature grid with icons, and the guest guide on desktop as a card on an arena backdrop with three tile columns. Constraints: CSS and server-rendered markup only (no new client JavaScript; portal routes stay within 150 KB), the CSP (no inline styles), WCAG 2.2 AA in light and dark, Spanish and English texts, no cut text, no third-party assets. Out of scope: inbox split view, settings sub-navigation, emails, QR poster print layout."

**Sources**: [UI/UX audit 2026-11](../../docs/ux/ui-ux-audit-2026-11.md) · [Design system](../../docs/ux/design-system.md) (§4 layout, §5 components, §6 accessibility) ·
[Brand guide](../../docs/brand/README.md) · [Screens](../../docs/ux/screens.md) · Spec 015 (shell, icons, illustrations, no cut text) · Spec 016 (photos, avatars)

## Clarifications

### Session 2026-11-23

Answered with the recommended option under the founder's standing instruction to run all phases;
the founder can change any of them.

- Q: Where does the desktop shape start? → A: Two steps, matching the design system's breakpoints:
  from 600 px buttons size to their label and filters share one row; from 1024 px (where the sidebar
  already appears) pages use two columns and grids. Under 600 px nothing changes except the fixes of
  User Story 2, which were broken on phones too.
- Q: Should requests become a table on desktop? → A: No. A grid of compact cards: the same markup on
  phones and desktop, readable by screen readers as a list, and no sideways scrolling at 200% zoom.
- Q: Which colors mark request status? → A: By meaning, with the existing tokens: waiting uses the
  warning color, confirmed the success color, and declined, cancelled, and expired stay neutral.
  Text always names the status; color only repeats it.
- Q: Does the property overview move the cover photo? → A: Yes. The property's name and actions lead;
  from 1024 px the photo, its edit controls, and the summary cards move to a side column. On phones the
  order stays: photo, name, actions, facts, cards.
- Q: Are the inbox split view and a settings sub-navigation part of this feature? → A: No. Both need
  new client behavior or routes; they are recorded in the audit as later work.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Wide screens look designed, not stretched (Priority: P1)

A property manager works at a laptop all day. Buttons are as wide as their label, filters sit in one
row above the list, tabs look like one control with a clear current choice, cards have a visible edge,
and badges stay the size of their text. The pages read like a desktop product while keeping the
brand's warm palette.

**Why this priority**: These shared components appear on every screen; changing them fixes most of
the "stretched phone" impression at once (audit causes 1, 2, and 5).

**Independent Test**: Open the inbox, requests, properties, property overview, guide, settings, and a
form at 1280 px. No button, select, search field, or badge spans the content width; filters share one
row; the current tab is obvious; cards have a border. At 375 px the same screens look as they did
before this feature.

**Acceptance Scenarios**:

1. **Given** a screen at least 600 px wide, **When** any portal page shows a button outside the
   auth panel, **Then** the button is as wide as its label plus padding, never the full content width.
2. **Given** a screen narrower than 600 px, **When** the host opens a form, **Then** its primary
   button still spans the column, as today.
3. **Given** the inbox or requests at 1024 px or wider, **When** the page loads, **Then** the tabs or
   search and every filter sit in one row, each filter sized to its content, each with its label.
4. **Given** any tab group, **When** a tab is current, **Then** it differs from the others by fill,
   text color, and weight, and it is announced as selected.
5. **Given** any badge in a grid or column layout, **When** the page renders, **Then** the badge is as
   wide as its text.

---

### User Story 2 - Broken details are fixed (Priority: P1)

A host editing the arrival section sees a compact formatting toolbar, not six stacked bars. Opening
the workspace menu shows it above the navigation. The alerts banner shows its message and its action
on one line. The guide checklist keeps each topic's actions together. Checkbox and radio cards have
space between them.

**Why this priority**: These look broken today, on staging, in the founder's own screenshots.

**Independent Test**: At 375 px and 1280 px, open a section editor, open the workspace menu, view the
inbox with alerts off, view the guide's missing topics, and the new-property form. Each shows the
fixed layout.

**Acceptance Scenarios**:

1. **Given** the section editor at any width, **When** it shows the text toolbar, **Then** the format
   buttons sit in one or two compact rows above the text, each at least 44 px tall on touch screens
   and 40 px on others, and the active format is marked by fill, not only an outline.
2. **Given** the sidebar at 1024 px or wider, **When** the host opens the workspace menu, **Then** the
   menu paints above every navigation item, with a border, rounded corners, and the sheet shadow.
3. **Given** the inbox with alerts off on this device, **When** the banner shows, **Then** its text and
   its "Turn them on" action share one row where they fit, and the action is sized to its label.
4. **Given** the guide's missing-topics list, **When** a topic shows its actions, **Then** the three
   actions stay together on the topic's row on wide screens and wrap under the topic on phones.
5. **Given** a group of checkbox or radio option cards, **When** it renders, **Then** the cards have an
   8 px gap and a chosen card is highlighted with the brand edge and tint.

---

### User Story 3 - The main screens use the width (Priority: P1)

On a desktop, requests show as a grid of compact cards with their facts in two columns and status
colors that mean something; inbox items read as rows with a reason icon and the stay dates in words;
"Add property" offers its options as icon cards; the property overview shows the name and actions
first with a side column; the guide page has one primary action; settings open on a grid of icon
cards. Dates read "26 sept 2026", not "2026-09-26".

**Why this priority**: These are the screens a host uses every day (H-20, H-23, H-10, H-11, H-12);
they carry most of the scrolling and scanning cost on a desktop.

**Independent Test**: At 1280 px, a desktop screen shows at least four requests and at least four
inbox items without scrolling past the first screen height of content (with the demo data), the
property overview shows the name, actions, facts, and a side column in the first screen, and the add
property and settings pages show grids of icon cards. At 375 px the same screens stay single-column.

**Acceptance Scenarios**:

1. **Given** requests at 1024 px or wider, **When** the list renders, **Then** requests appear in two
   columns, each card with its title and status on one line, the facts (date, quantity, price, stay,
   guest) in a two-column grid, and actions at the bottom.
2. **Given** a waiting, confirmed, or closed request, **When** its status badge shows, **Then** waiting
   uses the warning color, confirmed the success color, and closed statuses a neutral color.
3. **Given** an inbox item, **When** it renders, **Then** it shows the reason icon in a tinted circle,
   the property and the stay dates formatted for the reader's language, the excerpt, the reason badge,
   and the time.
4. **Given** the add-property page or the first-property state, **When** it renders, **Then** each
   option is a card with an icon, title, description, and chevron, in two columns from 1024 px, and the
   recommended option has a terracota edge and a compact pill.
5. **Given** a property overview at 1024 px or wider, **When** it renders, **Then** the property's name,
   status, and actions come first, and the cover photo, its controls, and the analytics, assistant,
   Explore, and extras cards sit in a side column.
6. **Given** the guide page, **When** it renders, **Then** "Publish" is the only primary action and the
   other guide actions form a secondary group.
7. **Given** the settings page, **When** it renders, **Then** every settings area is a card with an
   icon, its name, and a one-line description, in a grid of up to three columns.

---

### User Story 4 - Forms feel like the brand (Priority: P2)

A host filling in a new property sees checkboxes and radios in the brand color, chosen options
highlighted, short fields (city, state, postal code; check-in, checkout) side by side on a desktop,
and a submit button sized to its label at the end of the form.

**Why this priority**: Forms are where hosts spend setup time; today they show system-blue controls
and full-width rows for two-word fields.

**Independent Test**: Open the new property form, onboarding, and the extra form at 1280 px and
375 px: brand-colored controls, chosen state visible, short fields share rows on desktop only.

**Acceptance Scenarios**:

1. **Given** any checkbox or radio, **When** it is checked, **Then** it uses the brand primary color in
   light and dark mode.
2. **Given** an option card containing a checked input, **When** it renders, **Then** the card shows
   the brand edge and tint.
3. **Given** a form row of short fields at 600 px or wider, **When** it renders, **Then** the fields
   share the row; under 600 px each field takes the full width.

---

### User Story 5 - Pages never flash blank (Priority: P2)

When a host opens or reloads any signed-in page, the logo and navigation show at once, and the page
area shows a calm placeholder until its content arrives.

**Why this priority**: Today every reload shows an empty cal page until the account loads, which
reads as broken on slow connections.

**Independent Test**: Throttle the network and reload the inbox: the shell and a placeholder show
before the data; the placeholder respects reduced motion.

**Acceptance Scenarios**:

1. **Given** a signed-in page that has not loaded the account yet, **When** it renders, **Then** the
   logo and every navigation destination show, with a placeholder where the workspace and account go.
2. **Given** a page whose content has not arrived, **When** its main area is empty, **Then** a
   placeholder shaped like a title and two content blocks shows, without animation when the user
   prefers reduced motion.

---

### User Story 6 - The public home and the guest guide look right on a laptop (Priority: P3)

A host comparing tools reads the public home on a laptop: each feature has its icon and the feature
grid is balanced. A guest who opens the guide on a laptop sees it as a card on the brand backdrop,
with tiles in three columns.

**Why this priority**: Fewer visits come from desktops than phones, but the public home sells the
product and the guide on a laptop represents the host.

**Independent Test**: Open the public home and a guide home at 1280 px: feature icons and a balanced
grid; the guide column on an arena backdrop with three tile columns; at 375 px nothing changes.

**Acceptance Scenarios**:

1. **Given** the public home at 1024 px or wider, **When** the features section renders, **Then** each
   feature shows its icon and no row holds a single orphan card.
2. **Given** a guide page at 768 px or wider, **When** it renders, **Then** the content column sits on
   an arena backdrop as a card; from 1024 px the home tiles use three columns.

---

### Edge Cases

- Long Spanish labels in buttons and option cards wrap between words; nothing is cut (spec 015 rule).
- A toolbar whose filters do not fit one row wraps them to a second row rather than shrinking them below
  their labels.
- At 200% zoom on a 1280 px screen (640 CSS px), the layouts fall back to the single-column shape
  without sideways scrolling.
- Agents (read-only) see the same layouts without the actions they cannot use; empty side columns do
  not leave gaps.
- A property without a cover photo shows the cover prompt in the side column, not an empty frame.
- Dates without a year in the current year still show the year when the stay crosses into another year.
- Dark mode: every new color pairing (status badges, chosen option, segmented control, skeleton)
  meets WCAG AA contrast.
- Print: the shell and placeholders do not print.

## Requirements *(mandatory)*

### Functional Requirements

**Shared components (User Stories 1, 2, 4)**

- **FR-001**: From 600 px wide, portal buttons MUST size to their label; under 600 px they keep the full
  column width. The auth panel keeps full-width buttons at every width.
- **FR-002**: Groups of buttons MUST sit in a wrapping row with an 8 px gap at every width; no button
  may touch another.
- **FR-003**: Text-style buttons (link buttons) MUST never take the full width or center themselves on
  their own line.
- **FR-004**: Filters and search on list pages (inbox, requests, properties) MUST form one toolbar row
  from 1024 px, each control sized between 12rem and 20rem, with a visible label; they wrap rather than
  shrink when space runs out, and stack at full width under 600 px.
- **FR-005**: Tab groups MUST render as a segmented control: a track in the surface color, the current
  item with the page background, the primary-strong text color, weight 600, and a soft shadow.
- **FR-006**: From 1024 px, cards MUST have a 1 px border and 24 px padding.
- **FR-007**: Badges MUST never be wider than their text in any layout.
- **FR-008**: The workspace menu MUST paint above the navigation and use the sheet style (border,
  16 px radius, padding, sheet shadow).
- **FR-009**: The text editor toolbar MUST be a compact row at every width (buttons sized to their
  label, at least 44 px tall on touch screens and 40 px with a fine pointer), with the active format
  marked by fill.
- **FR-010**: Checkboxes and radios MUST use the brand primary color; option cards MUST have an 8 px
  gap, a hover state, and a chosen state (primary edge and tint) when their input is checked.
- **FR-011**: Forms MUST place short related fields side by side from 600 px: city, state, and postal
  code; check-in and checkout times.

**Screens (User Story 3)**

- **FR-012**: Requests MUST show as a grid of cards (two columns from 1024 px) with title and status on
  one line, facts in a two-column grid, and actions at the bottom; status badges MUST use warning for
  waiting, success for confirmed, and neutral for closed statuses.
- **FR-013**: Dates and stay ranges in the inbox and requests MUST be formatted for the reader's
  language (day, short month, and year), not ISO strings.
- **FR-014**: Inbox items MUST show the reason icon in a tinted circle, a title with the property and
  stay, the excerpt, and badges and time; the alerts banner MUST keep its action on the message row.
- **FR-015**: The add-property options MUST be cards with an icon, title, description, and chevron, in
  two columns from 1024 px; the recommended one MUST have a primary edge and a compact pill.
- **FR-016**: The property overview MUST lead with the property's name, status, and actions; from
  1024 px the cover photo with its controls and the summary cards MUST move to a side column.
- **FR-017**: The guide page MUST show "Publish" as the only primary action, the other guide actions as
  secondary buttons in one group, and each missing topic as a row with its actions.
- **FR-018**: The settings index MUST show each area as a card with an icon, its name, and a one-line
  description, in a grid up to three columns wide, in Spanish and English.
- **FR-019**: The share page MUST use two columns from 1024 px (property link and QR on one side, the
  scheduled message on the other), and the language choice MUST be a segmented control.

**Loading (User Story 5)**

- **FR-020**: The signed-in shell MUST render the logo and navigation before the account loads, with a
  placeholder for the workspace switcher and the account link.
- **FR-021**: An empty main page area MUST show a placeholder (a title bar and two blocks) that does not
  animate when the user prefers reduced motion and is hidden from print.

**Public home and guest guide (User Story 6)**

- **FR-022**: Public home features MUST each show an icon, in a grid with no orphan card from 1024 px.
- **FR-023**: From 768 px the guest guide MUST show its content column as a card on an arena backdrop;
  from 1024 px the home tiles MUST use three columns (wide tiles keep the full row).

**Constraints**

- **FR-024**: The phone layout (under 600 px) MUST stay as it is except for FR-003, FR-007, FR-009,
  FR-010, FR-013, FR-014, FR-020, and FR-021.
- **FR-025**: No portal route may exceed 150 KB of initial JavaScript; the feature adds no client
  component and no client-side icon import.
- **FR-026**: Every change MUST pass WCAG 2.2 AA in light and dark mode, keep the no-cut-text rule,
  and use only the existing tokens, icons, and system fonts; new texts MUST exist in Spanish and English.

### Key Entities

None. The feature changes presentation only; no data, API, or permission changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 1280 px, no portal button, select, or search field outside forms is wider than 24rem,
  except form submit buttons on phones and the auth panel.
- **SC-002**: At 1280 px with the demo data, the requests page shows at least four requests and the
  inbox at least four items (when they exist) within the first 900 px of the page.
- **SC-003**: At 375 px, the inbox, requests, properties, property, guide, settings, and new property
  screens match their earlier layout except for the listed fixes (checked against the before captures).
- **SC-004**: axe finds no WCAG 2.2 A/AA violation on the screens of the existing a11y and brand-shell
  checks, in light and dark mode.
- **SC-005**: Every portal route stays at or under 150 KB of initial JavaScript.
- **SC-006**: No page scrolls sideways at 320, 375, 768, 1024, or 1280 px, and no text ends in an
  ellipsis or a hyphen.
- **SC-007**: The founder, reviewing on Safari at desktop width, no longer sees the four issues of the
  staging screenshots (menu under the navigation, full-width filters, stretched badge, touching
  checkbox cards).

## Assumptions

- PR #34 (wrapping emails, branded dropdowns, home hero illustration) is the base; its fixes are not
  redone.
- The demo workspace's data is representative for layout checks; real accounts may have more items.
- The design system's breakpoints (600 px, 1024 px) stay; the guest guide uses its own 768 px step.
- Icons come from the existing Guidesk icon set; no new icon is drawn unless an option has
  no fitting one.
- Phone users accepted the current mobile design; this feature does not revisit it beyond the listed
  fixes.
