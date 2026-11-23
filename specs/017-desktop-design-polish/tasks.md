# Tasks: Desktop Design and Usability Polish

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [contracts/desktop-layout.md](contracts/desktop-layout.md)

**Tests**: Included (constitution V): a unit test for the date formatter; an e2e desktop-layout spec for
button widths, the toolbar, the workspace menu, the editor toolbar, and the option cards; the existing
a11y and brand-shell specs re-run; before and after screenshots at 375 and 1280 px, light and dark.

## Phase 1: Setup

- [X] T001 Capture the "before" screenshots of every screen at 375 and 1280 px, light and dark, with the automated checks (axe, sideways scroll, ellipsis, targets, small text), outside the repository; record the totals in docs/ux/ui-ux-audit-2026-11.md §4.1

## Phase 2: Foundational (the desktop layer)

- [X] T002 [P] Write the e2e desktop-layout spec: at 1280 px no button, select, or search outside the auth panel spans the content width; the requests filters share one row; the workspace menu covers the sidebar items; the section editor toolbar buttons share rows; option cards have gaps; at 375 px a form's primary button still spans the column; in e2e/specs/desktop-layout.spec.ts
- [X] T003 Buttons: label width from 600 px, full width in `.auth-panel`, link and toolbar buttons never full width, `.actions` rows with 8 px gaps, in apps/portal/app/globals.css
- [X] T004 Toolbar (`.inbox-controls`, `.toolbar-field`), segmented control (`.tabs`, `.tab`, `.segmented`, analytics radio tabs), card edge from 1024 px, badges never stretch, status pills (`.badge-success`, `.badge-warning-status`), in apps/portal/app/globals.css

## Phase 3: User Story 1 - Wide screens look designed (P1)

**Independent test**: Inbox, requests, properties, property, guide, settings, and a form at 1280 px.

- [X] T005 [US1] Requests and properties filters as toolbar fields (label and control grouped, search field max 24rem) in apps/portal/components/requests/requests-screen.tsx and apps/portal/components/properties/property-list.tsx
- [X] T006 [US1] Page header at 1024 px (28 px title) and back links as small chevron links (`.back-link`) in apps/portal/app/globals.css

## Phase 4: User Story 2 - Broken details are fixed (P1)

**Independent test**: Section editor, workspace menu, alerts banner, guide checklist, new property form at 375 and 1280 px.

- [X] T007 [P] [US2] Editor toolbar as a compact row with a filled active state in apps/portal/app/globals.css (`.guide-editor-toolbar`)
- [X] T008 [P] [US2] Workspace menu above the navigation with the sheet style in apps/portal/app/globals.css (`.switcher-menu`)
- [X] T009 [US2] Alerts banner as one row (message and text action) in apps/portal/components/notifications/alerts-card.tsx and apps/portal/app/globals.css
- [X] T010 [US2] Guide checklist rows (topic name, then its actions together; "Not applicable" as a text button) in apps/portal/components/guide/guide-review.tsx and apps/portal/app/globals.css

## Phase 5: User Story 3 - The main screens use the width (P1)

**Independent test**: At 1280 px the requests show two columns, the inbox rows show icons and dates in words, add-property and settings show icon cards, the property page has a side column.

- [X] T011 [P] [US3] Write unit tests for `formatDay` and `formatRange` (same month, different months, different years, es and en, date-only strings without time zone shift) in apps/portal/test/dates.test.ts
- [X] T012 [US3] Implement `formatDay`, `formatDateTime`, and `formatRange` with `Intl.DateTimeFormat` in apps/portal/lib/dates.ts
- [X] T013 [US3] Requests as a card grid: title and status on one line, facts as a two-column grid, status pills by meaning, localized dates, in apps/portal/components/requests/requests-screen.tsx and apps/portal/app/globals.css
- [X] T014 [US3] Inbox rows: reason icon in a tinted circle, title with the property and localized stay range, excerpt, badges and time at the end on wide screens, in apps/portal/components/inbox/inbox-view.tsx and apps/portal/app/globals.css
- [X] T015 [US3] Add-property options as icon cards (`.option-grid`, `.option-card`, recommended edge and pill), icons rendered by the server page and passed in, in apps/portal/components/properties/start-options.tsx, apps/portal/app/[locale]/(app)/properties/new/page.tsx, apps/portal/components/properties/property-list.tsx, and apps/portal/app/globals.css
- [X] T016 [US3] Property overview: header first, two columns from 1024 px with the cover and the summary cards in the aside, in apps/portal/app/[locale]/(app)/properties/[propertyId]/page.tsx, apps/portal/components/properties/property-facts.tsx, and apps/portal/app/globals.css
- [X] T017 [US3] Guide page actions: Publish primary, the rest secondary in one group, in apps/portal/components/guide/guide-review.tsx
- [X] T018 [US3] Settings index as grouped icon cards with one-line descriptions in apps/portal/app/[locale]/(app)/settings/page.tsx, packages/i18n/messages/es.json, packages/i18n/messages/en.json, and apps/portal/app/globals.css
- [X] T019 [US3] Share page in two columns from 1024 px and the language choice as a segmented control in apps/portal/components/share/share-screen.tsx and apps/portal/app/globals.css
- [X] T020 [US3] Extras list as a two-column grid from 1024 px, "Delete" as a quiet danger button, in apps/portal/components/extras/property-extras.tsx and apps/portal/app/globals.css

## Phase 6: User Story 4 - Forms feel like the brand (P2)

**Independent test**: New property, onboarding, extra form at 375 and 1280 px.

- [X] T021 [US4] Brand `accent-color`, option cards with gap, hover, and chosen state (`:has(input:checked)`) in apps/portal/app/globals.css
- [X] T022 [US4] City, state, and postal code in one `.field-row` from 600 px in apps/portal/components/properties/core-facts-form.tsx

## Phase 7: User Story 5 - Pages never flash blank (P2)

**Independent test**: Reload the inbox with a slow network.

- [X] T023 [US5] Render the shell before `/me` loads with a placeholder for the switcher and account in apps/portal/components/app-header.tsx
- [X] T024 [US5] CSS skeleton for an empty main area (title bar and two blocks, reduced motion, print) in apps/portal/app/globals.css

## Phase 8: User Story 6 - Public home and guest guide on a laptop (P3)

**Independent test**: Public home and guide home at 1280 and 375 px.

- [X] T025 [P] [US6] Feature icons and a balanced grid on the public home in apps/portal/components/public/home-sections.tsx and apps/portal/app/globals.css
- [X] T026 [P] [US6] Guide from 768 px: arena backdrop, the column as a card, three tile columns, in apps/guide/styles/guide.css

## Phase 9: Polish and verification

- [X] T027 Document the desktop layer (breakpoints, page templates, components) in docs/ux/design-system.md §4 and §5
- [X] T028 Run portal typecheck, lint, and unit tests; build and run the bundle budget check (no route over 150 KB)
- [X] T029 Run the affected e2e specs (mobile project) and the a11y spec, one at a time with rate-limit resets: desktop-layout, brand-shell, a11y, inbox-us1, extras-us2, properties-us1-blank, guide-us1-draft, photos
- [X] T030 Capture the "after" screenshots, compare with "before" at 375 px (no unintended change) and 1280 px, add the key pairs to docs/ux/screenshots/017/ for the pull request
- [X] T031 Mark the audit's fixed findings and open the pull request against main with the screenshots

## Dependencies

- Phase 2 (T003, T004) before every story: the stories rely on the button and toolbar rules.
- US1–US6 are independent of each other after Phase 2; US3's T013 and T014 need T012.
- Phase 9 after all stories.

## Parallel opportunities

- T002 and T011 (tests) in parallel with T003/T004.
- T007 and T008 (separate CSS blocks) in parallel.
- T025 (portal public) and T026 (guide) in parallel with any portal screen task.

## Implementation strategy

MVP = Phase 2 + US1 + US2: the shared desktop layer and the broken details fix most of what the founder
reported. Then US3 screen by screen (requests, inbox, add property, property, guide, settings, share,
extras), then forms, loading, and the guest and public pages. Commit after each phase.
