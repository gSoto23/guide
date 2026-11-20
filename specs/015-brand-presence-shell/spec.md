# Feature Specification: Brand Presence and Responsive Shell

**Feature Branch**: `015-brand-presence-shell`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "015 Brand presence and responsive shell (phases A and B of docs/brand/brand-application-audit.md). The product is mobile first and must also work well on desktop, with no cut-off text anywhere. (A) Brand presence, no data changes: the logo and an original illustration on sign-in, verify, and invitation; one set of about 25 illustrative icons drawn for Guidesk, used on guest guide tiles, the portal navigation, inbox reason chips, key buttons, and section headers; about eight original flat illustrations for the auth screens, the welcome, empty states, and the guest guide status pages; the "Hecho con Guidesk" footer on Free-plan guides; link previews for guide and public pages with a branded default image. (B) The responsive portal shell from the design system: a bottom bar on phones and tablets, a sidebar on wide screens, the current page marked, a page header pattern, and responsive grids. No cut-off text. WCAG 2.2 AA, the portal and guest guide budgets, no third-party assets, the brand guide's rules, and dark mode. Out of scope: photos, avatars, the public home hero, Fraunces, and host branding."

**Sources**: [Brand application audit](../../docs/brand/brand-application-audit.md) · [Brand guide](../../docs/brand/README.md) (§2.3, §5, §6, §7) ·
[Design system](../../docs/ux/design-system.md) (§4 layout, §5 components, §6 accessibility, §8 performance) ·
[Screens](../../docs/ux/screens.md) · [Performance](../../docs/architecture/performance.md) · Spec 001 (accounts, sign-in), 004 (guest guide),
006 (inbox), 010 (analytics), 011 (plans), 014 (public pages)

## Clarifications

### Session 2026-11-19

Answered with the recommended option under the founder's standing instruction to run all phases; the
founder can change any of them.

- Q: Which destinations go in the phone and tablet bottom bar? → A: Inbox, Requests, Properties,
  and More. More opens a list with Analytics, Shared content, Team, and Settings. The wide-screen
  sidebar shows every destination directly. (Implementation note: a fifth column did not fit
  "Estadísticas", "Propiedades", and "Solicitudes" whole at 320 px, so Analytics moved under More
  to honor the no-cut rule; research R13.)
- Q: Where does the Guidesk credit appear on guides? → A: Only on guides of Free-plan workspaces, at
  the end of the guide home and the section pages, as the small mark and "Hecho con Guidesk" /
  "Made with Guidesk", linking to the public home in the guest's language. Paid plans show no credit,
  so the host's brand leads.
- Q: What do link previews of a guide show? → A: The property name as the title, a fixed
  description ("Guía digital de tu estadía" / "Digital guide for your stay"), and the branded default
  image. Never the guest's name, dates, codes, or any value from a stay link. A stay link is never
  looked up before the guest opens it, so its preview is generic ("Tu guía de estadía" / "Your stay
  guide") with the same description and image.
- Q: Is the icon set drawn for Guidesk or taken from a library? → A: Drawn for Guidesk from the brand
  guide's icon rules, so every icon shares the mark's shapes and no third-party license or download is
  involved.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The portal fits the screen it is on (Priority: P1)

A host uses Guidesk on the phone between check-ins and on a laptop at the office. On the phone, the
main destinations sit in a bottom bar within thumb reach. On the laptop, a sidebar shows the logo,
the workspace, and every destination, and the page content uses the width instead of a narrow
column. In both, the host always sees where they are.

**Why this priority**: Every signed-in screen depends on the shell. Today a wide screen shows one
480 px column and a row of underlined links with no current-page mark, which looks unfinished and
makes property managers, who work on desktop, scroll more.

**Independent Test**: Open the inbox, properties, analytics, and settings at 375 px, 768 px, and
1280 px wide. The navigation changes form at each breakpoint, the current page is marked, and no
page scrolls sideways.

**Acceptance Scenarios**:

1. **Given** a screen narrower than 600 px, **When** the host opens any signed-in page, **Then** a
   bottom bar shows Inbox, Requests, Properties, and More, each with an icon and a visible label,
   and the content is one column.
2. **Given** a screen from 600 to 1023 px, **When** the host opens any signed-in page, **Then** the
   bottom bar stays and the content uses the extra width (for example, two columns of property
   cards).
3. **Given** a screen 1024 px or wider, **When** the host opens any signed-in page, **Then** a
   sidebar shows the logo, the workspace switcher, and every destination with icon and label, and
   the content area grows up to a comfortable maximum width.
4. **Given** the host is on the analytics page, **When** they look at the navigation, **Then** the
   Analytics entry is visibly marked as current (a terracota tint and a shape change, not color
   alone) and announced as the current page to screen readers.
5. **Given** the host taps More on a phone, **When** the list opens, **Then** it shows Analytics,
   Shared content, Team, and Settings with icons, and closes with Escape, back, or a tap outside.
6. **Given** a main page (inbox, requests, properties, analytics, settings), **When** it loads,
   **Then** it starts with the same header pattern: the title, an optional one-line help text, and
   the page's primary action when it has one.

---

### User Story 2 - Text is never cut off (Priority: P1)

A host and a guest read every label whole, in Spanish and English, on a small phone and with large
text. No word is split with a hyphen inside a short label, no line ends in "…" hiding information,
and long property names, emails, and words wrap instead of overflowing.

**Why this priority**: The founder asked for it explicitly. Today the guest tiles show
"Electrodomésti-cos" and "Recomendacio-nes", which reads as broken.

**Independent Test**: Open the guest guide home, the property list, the inbox, and the settings at
320 px wide and at 200% zoom, in both languages, with a 60-character property name. Every label is
whole and nothing overflows.

**Acceptance Scenarios**:

1. **Given** the guest guide home at 320 px, **When** the tiles render, **Then** "Electrodomésticos",
   "Recomendaciones", and every other tile title show as whole words, wrapping between words only.
2. **Given** a property named with 60 characters and no spaces in places, **When** it appears in a
   card, a header, or the sidebar, **Then** it wraps onto more lines and the page does not scroll
   sideways.
3. **Given** any button, chip, tab, or navigation label in Spanish or English, **When** it renders,
   **Then** it grows to fit the label (or wraps) instead of cutting it.
4. **Given** 200% browser zoom at a 1280 px window, **When** any audited page renders, **Then** no
   text is clipped or hidden and no horizontal page scroll appears.

---

### User Story 3 - Icons make the product easier to scan (Priority: P1)

A guest looking for the Wi-Fi spots it by its icon before reading. A host scanning the inbox sees the
emergency and malfunction icons at a glance. Icons come from one set drawn for Guidesk, always next
to a text label.

**Why this priority**: The founder wants illustrative icons to make the product more intuitive, and
the brand guide already specifies the icon set.

**Independent Test**: Open the guest guide home and confirm that every tile has an icon matching its
section; open the portal navigation and the inbox and confirm icons on every destination and reason.

**Acceptance Scenarios**:

1. **Given** a published guide, **When** the guest opens the home, **Then** each tile (arrival,
   Wi-Fi, house rules, appliances, amenities, parking and transport, recommendations, emergencies,
   checkout, extras, explore, and custom sections) shows its own icon next to the title.
2. **Given** the portal navigation in any form (bottom bar, More list, sidebar), **When** it renders,
   **Then** each destination shows an icon and a text label.
3. **Given** a conversation that needs the host, **When** it appears in the inbox, **Then** the
   reason chip shows an icon for its reason and the reason text.
4. **Given** key actions (add property, paste a guest message, copy link, show code, ask, call
   emergency), **When** they render, **Then** they carry an icon before the label.
5. **Given** a screen reader, **When** it reads an icon with a label, **Then** it reads only the
   label (icons are hidden from assistive technology unless they are the only content, which never
   happens in this feature).

---

### User Story 4 - Sign-in feels like Guidesk (Priority: P2)

A new host arrives at the sign-in screen from the public home or an invitation email and sees the
Guidesk logo, a warm brand illustration, and the tagline, instead of a bare form.

**Why this priority**: Sign-in is the first screen after the public home and the first screen of
every invitation; today it has no logo.

**Independent Test**: Open sign-in, verify, and an invitation on a phone and on a desktop, in light
and dark mode.

**Acceptance Scenarios**:

1. **Given** a phone, **When** sign-in, verify, or the invitation opens, **Then** the logo sits at
   the top and a small illustration sits above the form, and the form is reachable without
   scrolling past decoration on a 667 px-tall screen.
2. **Given** a screen 1024 px or wider, **When** these screens open, **Then** they show two panels:
   the form, and a brand panel with the illustration and "Tu casa, siempre lista para responder." /
   "Your home, always ready to answer."
3. **Given** the sign-in options, **When** they render, **Then** the Google button shows the Google
   "G" mark and the passkey button shows a key icon, each with its text label.
4. **Given** dark mode, **When** these screens open, **Then** the logo switches to its dark version
   and the illustration and panel use the dark palette.

---

### User Story 5 - Empty and status screens explain themselves (Priority: P2)

A host with no properties yet, a clear inbox, no requests, or no analytics data sees a friendly
illustration, a sentence that explains why, and the next action. A guest whose link expired or who
is offline sees a calm page with the property name, an illustration, and what to do.

**Why this priority**: Empty and error states are where a product feels most unfinished; the brand
guide asks for illustrations there.

**Independent Test**: Open the portal with a new workspace (no properties, empty inbox, no
requests, no data) and open a guide link that is unavailable, rate limited, or offline.

**Acceptance Scenarios**:

1. **Given** a workspace with no properties, **When** the host opens Properties, **Then** an
   illustration, a sentence, and the "Add property" action appear.
2. **Given** an inbox with nothing that needs the host, **When** the host opens it, **Then** an
   "all caught up" illustration and sentence appear.
3. **Given** no requests or no analytics data yet, **When** the host opens those pages, **Then**
   each shows its illustration, the reason, and what will fill it.
4. **Given** a guide page that cannot load right now, is unavailable, is rate limited, or is opened
   offline, **When** the guest sees it, **Then** it shows the property name when known, an
   illustration, a short explanation, what to do next, and the small Guidesk mark at the bottom.
5. **Given** the first sign-in of a new host, **When** the start or onboarding screen opens,
   **Then** it shows a welcome illustration above the questions.

---

### User Story 6 - Free guides carry a Guidesk credit (Priority: P3)

A guest using a guide from a Free-plan host sees "Hecho con Guidesk" with the small mark at the end of
the page and can open the public home to learn about Guidesk. Guides of paid plans show no credit.

**Why this priority**: The brand guide defines it, and each guest who hosts is a potential new
customer; it is not needed for a host to use the product.

**Independent Test**: Open a guide of a Free workspace and one of a Pro workspace.

**Acceptance Scenarios**:

1. **Given** a Free-plan workspace, **When** the guest opens its guide home or a section, **Then**
   the footer shows the mark (16–20 px) and "Hecho con Guidesk" / "Made with Guidesk" in the guide's
   language, linking to the public home in that language and opening in a new tab.
2. **Given** a Pro or Business workspace, **When** the guest opens its guide, **Then** no Guidesk
   credit appears.
3. **Given** the workspace changes plan, **When** the guide is opened after the change, **Then** the
   credit follows the current plan.

---

### User Story 7 - Shared links look trustworthy (Priority: P3)

A host sends the guide link on WhatsApp, or someone shares the public home. The preview shows a
title, a description, and a branded image instead of a bare link.

**Why this priority**: The guide link is the main way guests reach the guide; a rich preview builds
trust. It depends on nothing else in this feature.

**Independent Test**: Read the page metadata of a guide page and of the public home, and open the
preview image.

**Acceptance Scenarios**:

1. **Given** a guide page, **When** a messaging app reads it, **Then** it finds the property name
   as the title, the fixed description, and the branded default image, in the guide's language.
2. **Given** a stay link (a guide URL that unlocks stay data), **When** a messaging app reads it,
   **Then** the preview is generic ("Tu guía de estadía") and contains no property name, guest name,
   dates, or codes.
3. **Given** the public home, privacy, or terms page, **When** a messaging app reads it, **Then** it
   finds the page title, description, and the branded image.

---

### Edge Cases

- A role that cannot use a destination (for example, an agent and Settings) keeps today's access
  rules; the navigation never shows an entry that leads to a "not allowed" page more than it does
  today.
- A workspace name or property name with 80 characters, emoji, or one long word wraps in the
  sidebar, switcher, cards, and headers without overflow.
- A host who uses 200% zoom on a 1280 px laptop (an effective 640 px width) gets the medium layout
  (bottom bar) rather than a squeezed sidebar.
- The bottom bar never covers the last item of a page, a focused field, or a toast; it respects the
  phone's safe areas, and it hides while the on-screen keyboard is open if it would cover the field.
- Printing (the QR poster, guide preview) hides the navigation bars.
- Dark mode: every icon, illustration, panel, and the preview image remain readable; the preview
  image is a single light version, since link previews do not follow the viewer's theme.
- Pages with their own full-width layout (the guide preview, the QR poster, a conversation thread)
  keep working inside the new shell.
- Reduced motion: opening More and changing pages has no animation when the user asks for reduced
  motion.
- A guide whose plan cannot be read when the page renders shows no credit (fail toward the host's
  brand).

## Requirements *(mandatory)*

### Functional Requirements

**Responsive shell (portal)**

- **FR-001**: The signed-in portal MUST use three layouts: compact (< 600 px) and medium
  (600–1023 px) with a bottom bar, and expanded (≥ 1024 px) with a sidebar.
- **FR-002**: The bottom bar MUST show Inbox, Requests, Properties, and More, each with an icon and
  a visible text label, with targets of at least 44 × 44 px, and MUST respect safe areas.
- **FR-003**: More MUST open a list with Analytics, Shared content, Team, and Settings (icon and
  label each),
  operable by keyboard, closing with Escape, back, or a tap outside, and returning focus to More.
- **FR-004**: The sidebar MUST show the logo (linking to the start page), the workspace switcher,
  and every destination with icon and label, grouped with the five primary destinations first.
- **FR-005**: The current destination MUST be marked visually (terracota tint plus a shape cue such
  as a bar or filled background) and with `aria-current="page"`; sub-pages mark their parent
  destination.
- **FR-006**: Page content MUST be able to use up to 75rem on wide screens; forms and long reading
  text MUST keep a readable line length (about 40rem); the guest guide keeps its 40rem layout.
- **FR-007**: The main pages (inbox, requests, properties, analytics, settings, shared content) MUST
  start with one page header pattern: title, optional help line, and the primary action when the
  page has one.
- **FR-008**: The property list and the analytics stat cards MUST flow into multiple columns when
  the width allows (one column on compact, two or more on medium and expanded).
- **FR-009**: Print MUST hide the bottom bar and the sidebar.

**No cut-off text (portal, guest guide, public pages)**

- **FR-010**: Short labels (tile titles, buttons, chips, tabs, navigation items, card titles) MUST
  NOT break inside a word with a hyphen; they wrap between words, and MUST NOT be truncated with an
  ellipsis that hides information.
- **FR-011**: Long user-entered strings (property, workspace, and section names, emails, links) MUST
  wrap within their container at 320 px and at 200% zoom, without horizontal page scrolling.
- **FR-012**: Buttons, chips, and navigation items MUST grow in height or wrap to fit their label in
  Spanish and English; fixed heights MUST NOT clip text.

**Icons**

- **FR-013**: The product MUST use one icon set of about 25 icons drawn for Guidesk following brand
  guide §5 (24 px grid, 2 px rounded strokes, shapes echoing the mark, current text color).
- **FR-014**: Icons MUST appear on: every guest guide tile (each default section kind, extras,
  explore, and custom sections), every navigation destination, every inbox reason chip, the key
  actions listed in User Story 3, and the section headers of the guest guide and the property page.
- **FR-015**: Icons MUST always accompany a visible text label, MUST be hidden from assistive
  technology, and meaningful icons MUST reach 3:1 contrast with their background; sol is never an
  icon color on light backgrounds.
- **FR-016**: The Google sign-in button MUST show the Google "G" mark as Google's branding allows,
  and the passkey button a key icon.

**Illustrations**

- **FR-017**: The product MUST include about eight original flat illustrations in the mark's
  vocabulary (arches, speech bubbles with one square corner, sun circles, simple horizons), using
  only brand colors and their tints, with no text, gradients, 3D, or AI-generated imagery.
- **FR-018**: Illustrations MUST follow light and dark mode, MUST be decorative (empty text
  alternative) unless they carry meaning, and MUST NOT shift the layout while loading.
- **FR-019**: Illustrations MUST appear on: sign-in, verify, and invitation; the start and
  onboarding welcome; the empty states of properties, inbox, requests, and analytics; and the guest
  guide pages for unavailable, rate limited, temporary error, and offline.

**Brand moments**

- **FR-020**: Sign-in, verify, and invitation MUST show the logo; on screens ≥ 1024 px they MUST show
  a brand panel with the illustration and the tagline in the page language.
- **FR-021**: Guest guide status pages MUST show the property name when the request identifies a
  property and the name can be read without exposing stay data, plus the small Guidesk mark.
- **FR-022**: Guides of Free-plan workspaces MUST show the "Hecho con Guidesk" / "Made with Guidesk"
  footer with the mark at 16–20 px, linking to the public home in the guide's language in a new tab;
  guides of paid plans MUST NOT show it; if the plan cannot be determined, the credit is not shown.

**Link previews**

- **FR-023**: Guide pages MUST publish preview metadata (title = property name, the fixed
  description, the branded default image, the guide language); stay links get a generic title;
  no preview carries a guest name, dates, codes, or stay values.
- **FR-024**: The public home, privacy, and terms pages MUST publish preview metadata with the
  branded default image.
- **FR-025**: The branded default image MUST show the logo and the tagline on cal at the common
  1200 × 630 size, MUST be served from Guidesk's own origins, and MUST stay under 100 KB.

**Quality**

- **FR-026**: All new and changed screens MUST meet WCAG 2.2 AA: contrast, visible focus, 44 px
  targets, reflow at 320 px, and no information by color alone.
- **FR-027**: The portal MUST stay within 150 KB of JavaScript per route, and the guest guide within
  its budgets (100 KB JavaScript per route, 500 KB initial weight, LCP ≤ 2.5 s, CLS ≤ 0.1); icons and
  illustrations MUST NOT add icon fonts, icon libraries, or third-party downloads.
- **FR-028**: Every new text MUST exist in Spanish and English.

### Key Entities

No data changes. The feature reads two existing facts:

- **Workspace plan**: decides whether a guide shows the Guidesk credit.
- **Property name**: the title of a guide's link preview and of its status pages.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At 375, 768, 1280, and 1440 px wide, 100% of the audited portal pages show the
  navigation form of their breakpoint, mark the current page, and have no horizontal scrolling.
- **SC-002**: At 320 px and at 200% zoom, in Spanish and English, 0 labels are split by a hyphen or
  cut by an ellipsis on the audited pages (guest guide home and sections, sign-in, properties,
  inbox, requests, analytics, settings, public home).
- **SC-003**: 100% of guest guide tiles, navigation destinations, and inbox reason chips show an
  icon next to their label.
- **SC-004**: The logo appears on 100% of portal screens, including sign-in, verify, and invitation,
  and the small mark on 100% of guest guide status pages.
- **SC-005**: Automated accessibility checks report 0 violations on the audited pages in light and
  dark mode, and the existing portal and guest guide budgets and lab checks still pass.
- **SC-006**: A guide link shared in a messaging app shows a title, a description, and an image, and
  0 previews contain stay data.
- **SC-007**: In a 5-person hallway test (or the founder's review), people find the Wi-Fi tile and
  the Analytics page in under 5 seconds on a phone.

## Assumptions

- The bottom-bar destinations and the More list reflect today's navigation; role-based access stays
  as it is.
- The icon set and illustrations are drawn for this feature and kept in the repository as source
  files; the brand guide gains an icons and illustrations section that lists them.
- The Google "G" mark is used as Google publishes it for sign-in buttons; it is the only third-party
  mark, and it is served from Guidesk's origin.
- Link previews use one branded default image in this feature; a per-property photo replaces it in
  phase C.
- The public pages from spec 014 keep their layout; they gain icons in the plans and features blocks
  and the preview image, but no hero image (phase D).
- Emails are unchanged.
