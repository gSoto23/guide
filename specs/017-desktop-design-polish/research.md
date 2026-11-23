# Research: Desktop Design and Usability Polish

Decisions behind [plan.md](plan.md). Each lists the decision, the rationale, and the alternatives.

## R1. Button width: mobile-first full width, label width from 600 px

- **Decision**: Keep `width: 100%` as the base button rule and switch to `width: auto` from 600 px.
  The auth panel keeps full-width buttons at every width. Toolbars and link buttons are auto at every
  width (spec FR-003, FR-009).
- **Rationale**: The phone design was accepted; the full-width base gives thumb-sized targets there.
  From 600 px, full-width buttons are what makes the desktop read as a stretched phone (audit cause 1).
  One media query fixes every screen at once instead of editing 120 call sites.
- **Alternatives**: Change the base to `auto` and add a `.button-block` class where full width is
  wanted — cleaner long term but touches every form on phones, which the founder accepted; rejected
  for this feature.

## R2. Filter toolbar from existing markup

- **Decision**: Reuse `.inbox-controls` as the toolbar on inbox and requests; wrap each label and select
  pair of requests in a `.toolbar-field` element; from 1024 px the toolbar is a wrapping flex row with
  fields between 12rem and 20rem. The properties search form joins the page as a toolbar with a 24rem
  field.
- **Rationale**: Minimal markup change; labels stay visible (WCAG 3.3.2); phones keep the stacked
  fields.
- **Alternatives**: Hidden labels with placeholders (fails the design system's "visible labels" rule);
  a filter drawer (needs client state).

## R3. Segmented control for tabs

- **Decision**: Restyle `.tabs`/`.tab` (inbox), `.segmented` (share and analytics), and analytics' radio
  tabs as one segmented control: a surface track with a 1 px border, items without borders, the current
  item (`aria-selected="true"`, `.tab-active`, or a checked radio) on the page background with the
  primary-strong text, weight 600, and `--shadow-sheet` at low strength.
- **Rationale**: The current tab today differs only by a 2 px border (audit M10). Fill, color, and
  weight together meet WCAG 1.4.1 (not color alone) and 1.4.11 (the track edge has 3:1 against the
  page).
- **Alternatives**: Underlined tabs — weaker on touch and inconsistent with the bottom bar's pill marks.

## R4. Status colors by meaning

- **Decision**: Request badges: waiting → `badge-warning-status` (warning color and warning background),
  confirmed → `badge-success` (success color and background), closed statuses → plain `badge`.
  Pairings come from the existing tokens, which the brand build checks at AA in both modes.
- **Rationale**: Today confirmed uses the terracota "ready" outline, the same family as the primary
  action; meaning-based colors are what hosts expect (audit H5).
- **Alternatives**: Keep outlines in new colors — thin 1 px colored text at 13 px reads poorly in dark
  mode; filled pills read better.

## R5. Dates in the reader's language

- **Decision**: A small `lib/dates.ts` with `formatDay(iso, locale)` ("26 sept 2026") and
  `formatRange(from, to, locale)` ("18–22 nov 2026", "28 nov – 2 dic 2026", "28 dic 2026 – 2 ene 2027")
  built on `Intl.DateTimeFormat` and `formatRange` where available. Date-only strings are read as
  calendar dates (no time zone shift).
- **Rationale**: `Intl` is built into every target browser; no library, no bundle cost beyond a few
  hundred bytes in the inbox and requests chunks. Treating `YYYY-MM-DD` as a calendar date avoids the
  classic UTC-midnight off-by-one.
- **Alternatives**: A date library (bundle cost); server formatting (both screens are client
  components that already hold the data).

## R6. Shell before the account loads

- **Decision**: `AppHeader` renders the logo and every navigation destination when `me` is not loaded
  yet, with a non-interactive placeholder block where the workspace switcher and the account link go.
  The page area shows a CSS-only skeleton through `.app-content > main:empty::before/::after` (a title
  bar and two blocks), with the pulse disabled under `prefers-reduced-motion` and hidden in print.
- **Rationale**: The navigation does not depend on the account (spec 015 shows the same destinations to
  every role); rendering it at once removes the blank page (audit H10). The `:empty` selector catches
  every page whose client component still returns `null`, with no JavaScript.
- **Alternatives**: Next.js `loading.tsx` (covers server suspense only, not client fetches); a
  `<Skeleton>` component in each of 44 components (large diff, client code).

## R7. Property overview in two columns

- **Decision**: The server page wraps `PropertyFacts` in a main column and the four summary cards in an
  aside; `PropertyFacts` renders its header (name, badges, actions) before the cover, and the cover card
  moves out of the header flow with a CSS grid area so that, from 1024 px, it sits at the top of the
  aside. Under 1024 px the order stays as today (cover, name, actions).
- **Rationale**: The name and actions are the page's purpose; the cover and its editing controls are
  secondary on a desktop (audit H8). A grid with named areas keeps one DOM order that reads correctly
  for screen readers: header, facts, then the aside.
- **Alternatives**: Two separate renders of the cover per breakpoint (duplicate controls and ids).

## R8. Icons without new client JavaScript

- **Decision**: Icons go where the module is already loaded or rendered on the server: the settings
  index and the public home are server components; the add-property page passes server-rendered icons
  into the client `StartOptionsPanel` as props (the pattern of the shell, spec 015 R3); the property
  list, inbox, and guide review already import `Icon`.
- **Rationale**: Importing any icon in a client component pulls the whole icon table (~1.3 KB) into the
  route, and several routes sit at 149.5 KB.
- **Alternatives**: CSS background icons (needs data URLs per icon and breaks dark-mode recoloring).

## R9. Guest guide on a laptop

- **Decision**: From 768 px the guide's `body` uses the arena color and the content column becomes a
  card (cal background, 1 px border, 24 px radius, 32 px padding, centered, max 44rem); the home tiles
  use three columns, the wide tiles span all three.
- **Rationale**: A laptop guest sees a designed page instead of a narrow strip on a blank page (audit
  M9), with no change under 768 px.
- **Alternatives**: A two-pane guide (sections list and content) — a bigger change for few desktop
  guests.
