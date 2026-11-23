# UI/UX Audit, November 2026

> **Status:** Findings 2026-11-23; the high- and medium-impact fixes are built in
> [spec 017](../../specs/017-desktop-design-polish/spec.md) · **Owner:** Founder ·
> **Related:** [Design system](design-system.md) · [Screens](screens.md) ·
> [Brand guide](../brand/README.md) · [Brand application audit](../brand/brand-application-audit.md) ·
> [Spec 015](../../specs/015-brand-presence-shell/spec.md) · [Spec 016](../../specs/016-property-photos/spec.md)

A screen-by-screen review of the whole product: the public pages, sign-in and onboarding, every
portal screen, and the guest guide. The founder's verdict that started it: *the product is
designed for phones, which is right, but on a desktop it shows the same thing stretched to the
width.* This audit confirms it, finds the causes, and proposes a desktop design that keeps the
mobile one intact.

## 1. Method

- **Stack:** the local stack (portal, guide, API, worker) on branch `ux/forms-hero-wrap` (PR #34:
  emails wrap after the "@", branded dropdowns, home hero illustration), signed in as the demo owner
  with the seeded "Demo · Guidesk" workspace (Casa Brisa, Loft Escazú) and an empty workspace for
  the empty states.
- **Captures:** 61 screens (6 public and auth, 39 portal, 5 portal empty states, 11 guest guide) at
  375 px and 1280 px, light and dark, full page: 244 screenshots. Kept outside the repository; the
  before and after pairs that matter are in the spec 017 pull request.
- **Automated checks on every capture:** axe-core with the WCAG 2.0/2.1/2.2 A and AA tags (light),
  color contrast (dark), sideways page scroll, text cut by an ellipsis, interactive elements under
  44 × 44 px (the design system's minimum), and text under 13 px.
- **Founder's review:** four Safari screenshots of staging at about 1660 px (Requests with the
  workspace menu open, Inbox, Properties with no properties, and the new-property form).
- **Code reading:** `apps/portal/app/globals.css`, the shell, and the components behind each screen.

## 2. Summary

**Phones work.** The bottom bar, the page header, the illustrated empty states, the icons, and the
no-cut-text rule from spec 015 hold at 320–412 px. Nothing scrolls sideways and axe finds no
WCAG A/AA violation on the screens it can reach.

**Desktop is the phone layout, stretched.** From 1024 px the sidebar appears, and everything else
keeps the phone's single column. Five systemic causes explain almost every desktop finding:

1. **Every button is full width.** `button, .button { width: 100% }` is the base rule. On a phone it
   makes good thumb targets; on a desktop it gives 770 px "Save property" bars, breaks the text
   editor's toolbar into six stacked full-width buttons, centers "Turn them on" on its own line
   inside the alerts banner, and drops "No aplica" under its row in the guide checklist.
2. **Every field and filter is full width.** Filters (Inbox property, Requests property and status,
   Properties search) stretch across 1,100 px, with their label on a line above, instead of sitting
   in one toolbar row.
3. **One column for everything.** Property overview, guide builder, settings, and forms stack every
   block vertically. Nothing uses a second column: no side panel, no grid of options, no two-column
   form rows for short fields (city, state, postal code; check-in and checkout).
4. **Text blocks instead of scannable rows.** A request is a 380 px tall card with seven lines of
   "Label: value"; an inbox item is a grey slab with one line of metadata. A desktop user scans many
   at once; the layout shows two per screen.
5. **Weak hierarchy and native controls.** Cards are an arena fill with no edge; tabs are three
   bordered buttons where only the border width marks the current one; checkboxes and radios keep
   the operating system's blue; the "Recommended" badge stretches across its card; dates show as
   `2026-09-26`.

**Loading is a blank page.** Every signed-in page renders nothing, not even the shell, until
`/api/v1/me` answers; then most screens show "Cargando…" text until their own data arrives.

## 3. Findings

Impact: **High** — breaks a task, looks broken, or affects every screen; **Medium** — a clear
usability or polish problem on an important screen; **Low** — polish. Each finding names the
screen (IDs from [screens.md](screens.md)), the problem, and the fix. "D" marks desktop-only
findings, "M" phone-only, "All" both.

### 3.1 High impact

| # | Screen | Where | Problem | Proposed fix |
|---|---|---|---|---|
| H1 | Every portal screen | D | Buttons stretch to the full content width (cause 1). | Buttons size to their label from 600 px; full width only on phones and in the narrow auth panel. Button groups always sit in a wrapping row with an 8 px gap. |
| H2 | H-13 Section editor | All | The text editor toolbar (Bold, Italic, Heading, List, Numbered list, Link) renders as six stacked full-width buttons before the text, pushing the content below the fold. | A compact toolbar row: buttons size to their label, 40 px tall (44 px on touch screens), wrap when needed, the active format marked by a tint and not only an outline. |
| H3 | H-30 Workspace switcher | D | The open menu sits under the sidebar items: "Requests" paints over "Your workspaces" (founder's screenshot). The menu also has no border or radius. | Lift the menu above the navigation (stacking order), give it the sheet style (border, 16 px radius, padding, `--shadow-sheet`). |
| H4 | H-20 Inbox, H-23 Requests, H-10 Properties | D | Filters and search stretch across the page with a label line each (cause 2); on Requests they take 200 px before the first request. | A filter toolbar: one row on wide screens (tabs or search on the left, selects on the right), selects sized to their content (12–20rem), labels kept visible but compact; on phones the fields stack at full width as today. |
| H5 | H-23 Requests | D, All | Each request is a tall card of seven "Label: value" lines; a desktop shows two requests per screen. Confirmed and declined use the same terracota outline as "waiting". Dates are ISO (`2026-09-26`). | A responsive grid of request cards (one column on phones, two from 1024 px): title and status on one line, the facts in a two-column definition grid, actions at the bottom. Status colors by meaning: waiting = warning, confirmed = success, declined/cancelled/expired = neutral. Dates in the reader's locale ("26 sept 2026"). |
| H6 | H-20 Inbox | D, All | Items are grey slabs with one bold line (`Casa Brisa · 2026-11-18 → 2026-11-22 · Chat de la guía`) and loose metadata; tabs look like three buttons; the alerts banner puts its action alone at the bottom center. | Inbox rows: a reason icon in a tinted circle, the property and stay as the title with localized dates, the excerpt in muted text, reason chip and time aligned at the end on wide screens. Tabs become a segmented control. The banner is one row: message and action. |
| H7 | H-11 Add property, first-property state | D, All | The "Recommended" badge stretches across the card (founder's screenshot); the options are four text-only full-width cards with no icon. | Option cards in a grid (one column on phones, two on desktop), each with an icon in a tinted circle, the title, the description, and a chevron; the recommended card has a terracota edge and a compact "Recommended" pill. Badges never stretch anywhere. |
| H8 | H-10 Property overview | D | The cover photo is 52rem wide at the top of the page (about 470 px tall) above the property's name, with its edit controls (Change photo, description, Remove) inline; the five cards (facts, analytics, assistant, Explore, extras) stack in one column. | A header with the property's name, status, and actions first. From 1024 px, two columns: the main column with the facts, listing content, calendars, and stays; a side column with the cover photo (16:9 at the column width), its edit controls, and the analytics, assistant, Explore, and extras cards. |
| H9 | H-12 Guide builder | D | Seven actions of equal weight wrap over two rows; the missing-topics checklist puts "Answer in the interview" and "Edit section" as links on one line and "No aplica" as a full-width button below (cause 1). | One primary action (Publish), the others as a secondary group; each missing topic is a row with its name on the left and its three actions on the right on wide screens, wrapping under the name on phones. |
| H10 | Every signed-in screen | All | Blank page until `/api/v1/me` answers (no logo, no navigation), then "Cargando…" text on most screens. | Render the shell (logo, navigation, a placeholder for the workspace and account) immediately; show a skeleton (title bar and two content blocks, reduced-motion aware) while a page has no content yet. |
| H11 | Forms (new property, onboarding, property facts, workspace, extras) | All, D | Checkbox and radio cards touch each other (founder's screenshot, guide languages); checkboxes and radios use the system blue; a chosen option is not highlighted; short fields each take a full row. | Brand `accent-color`; option cards with an 8 px gap, hover, and a chosen state (terracota edge and tint); short fields in two or three columns from 600 px (city / state / postal code, check-in / checkout); the submit button sizes to its label at the end of the form. |

### 3.2 Medium impact

| # | Screen | Where | Problem | Proposed fix |
|---|---|---|---|---|
| M1 | Every portal screen | D | Cards are an arena fill with no edge and the same padding as on phones; on a wide cal page the layout looks unfinished. | On wide screens cards get a 1 px border, 24 px padding, and the 16 px radius; lists of cards use the responsive grid. |
| M2 | Page headers | D | The title is 24 px on every screen, the help line sits close, and sub-pages (property, guide, section, settings pages) start with a plain underlined "Back to…" link. | Titles 28 px from 1024 px; the back link becomes a small breadcrumb-style link with a chevron above the title. |
| M3 | Settings index | D, All | Ten text-only full-width links. | A grid of setting cards, each with an icon and a one-line description, grouped (Workspace, Guest experience, Your account). |
| M4 | H-34 Analytics, property analytics | D | The period tabs use the same weak button style; metric cards and bars do not use the width. | The segmented control; metric cards four across on wide screens. |
| M5 | H-16 Share | D | Copy blocks and the stays list stack in one column. | Two columns from 1024 px: the message and QR on one side, stays on the other. |
| M6 | Inbox and Requests | All | Dates and stays show in ISO format (`2026-11-18 → 2026-11-22`). | Dates formatted for the reader's locale ("18–22 nov", "18 nov – 2 dic"). |
| M7 | Inbox | All | The alerts-off banner centers its action on a separate line at the bottom (a link button inherits the full-width button rule). | Message and action in one row; the action is a text button that sizes to its label. |
| M8 | Public home | D | Five feature cards in a four-column grid leave "Estadísticas" alone on a second row; the cards have no icon. | Each feature with its icon in a tinted circle; a balanced grid (three plus two, or three columns with six items). |
| M9 | Guest guide | D | On a laptop the guide is a 40rem column on a cal page; the tiles stay in two columns. | From 768 px: the guide column sits on an arena backdrop as a card, and the tiles use three columns. |
| M10 | Tabs and segmented controls (Inbox, Analytics, autonomy) | All | The current tab differs only by a 2 px border. | A segmented control: an arena track, the current item on cal with the terracota text and a soft shadow. |

### 3.3 Low impact

| # | Screen | Where | Problem | Proposed fix |
|---|---|---|---|---|
| L1 | Sign-in, verify | D | The brand panel is plain arena with one illustration and the tagline. | Keep; optional later: three value points under the tagline. |
| L2 | Sidebar | D | The workspace name wraps over two lines inside a tall bordered box; the account email wraps. | Smaller switcher (name and role on one line where they fit); fine as is with the wrap rules from PR #34. |
| L3 | Properties list | D | The search field is full width. | Part of the toolbar (H4), at most 24rem. |
| L4 | Conversation | D | The transcript and the draft card use the 52rem column; on wide screens the copilot draft could sit beside the transcript. | Later: a split view (list and conversation) for the inbox at 1280 px and wider. |
| L5 | Next.js development indicator | All (dev only) | The "N" badge and the issues overlay cover the bottom-left corner in local screenshots. | Nothing to fix in production; screenshots hide it. |

## 4. Automated checks

The script ran axe (WCAG 2.2 A/AA) on all 61 screens in light mode and the color-contrast rule in
dark mode. See section 4.1 for the totals; the touch-target and small-text checks flag what the
design system's 44 px and 13 px rules exclude by design (inline links in sentences and the bottom
bar's 12 px labels, which spec 015 accepted to keep four Spanish labels whole at 320 px).

### 4.1 Results

*Filled in from the capture report (section 6).*

## 5. Desktop design direction

The phone design stays as it is. From 600 px, and more from 1024 px, the same components change
shape:

- **Page templates.** *List* (inbox, requests, properties, extras, shared content): page header,
  one toolbar row, a grid or rows that use up to 75rem. *Detail* (property, guide, share): page header
  with actions, a main column and a 22rem side column. *Form* (new property, onboarding, settings
  forms): a 40rem column, short fields side by side, actions at the end, sized to their labels.
  *Hub* (settings index, add property): a grid of option cards with icons.
- **Components.** Buttons size to their label; button groups wrap in a row. Toolbars hold filters in
  one row. Tabs are a segmented control. Cards have an edge on wide screens. Badges never stretch.
  Option cards show the chosen state. The workspace menu is a sheet above the navigation.
- **Brand.** Terracota only for the one primary action per view, current navigation, chosen
  options, and icon circles; arena for tracks and panels; icons from the Guidesk set beside
  headings and option cards; no new colors and no web fonts.
- **Budget.** All of this is CSS and server-rendered markup: no new client JavaScript on the
  portal's 150 KB routes.

## 6. Status after spec 017

| Finding | Status |
|---|---|
| H1 buttons, H4 toolbars, M1 cards, M10 tabs | Fixed: the desktop layer in `globals.css` (spec 017 FR-001 to FR-007). |
| H2 editor toolbar, H3 workspace menu, M7 alerts banner | Fixed at every width. |
| H5 requests, H6 inbox, M6 dates | Fixed: card grid with a facts grid and status pills by meaning; inbox rows with reason icons; dates in words. |
| H7 add property, M3 settings | Fixed: icon option cards; settings in three groups of icon cards with descriptions. |
| H8 property overview, M5 Share | Fixed: header first and a side column from 1024 px; Share in two columns. |
| H9 guide builder | Fixed: one primary action, quiet secondary actions, checklist rows, sections in two columns. |
| H10 loading | Fixed: the shell renders on the server before the account loads; empty pages show a placeholder. |
| H11 forms | Fixed: brand accent, option card gaps and chosen state, address fields in one row. |
| M2 page headers | Fixed: chevron back links and 28 px titles from 1024 px. |
| M8 public home | Fixed: feature icons, three-plus-two grid. |
| M9 guest guide | Fixed: a card on the arena backdrop from 768 px, three tile columns from 1024 px. |
| M4 analytics | Partly: the period tabs use the segmented style; the metric grid already used the width. |
| L1–L5 | Open (low impact); L4 (inbox split view) is proposed for a later spec. |

## 7. What this audit does not cover

- A split view for the inbox (list and conversation side by side) and a sub-navigation inside
  settings: both need client state or new routes; proposed for a later spec.
- Product copy beyond dates and labels touched by the fixes.
- The emails and the QR poster print layout.
