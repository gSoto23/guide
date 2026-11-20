# Tasks: Brand Presence and Responsive Shell

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [contracts/](contracts/)

**Tests**: Included (constitution V): unit tests for the shared assets, the navigation, the credit,
and the metadata; e2e for breakpoints, cut text, and accessibility.

## Phase 1: Setup

- [X] T001 Mark `@guidesk/ui` as side-effect free and add `src/icons` and `src/illustrations` folders with exports in packages/ui/package.json and packages/ui/src/index.ts

## Phase 2: Foundational (shared assets)

- [X] T002 [P] Write tests for the icon set (every contract name exists, `aria-hidden`, no colors besides `none`/`currentColor`, every section kind and reason mapped) in packages/ui/test/icons.test.tsx
- [X] T003 [P] Write tests for the illustrations (every name renders, only `il-*` classes, no `<text>` or `style`) in packages/ui/test/illustrations.test.tsx
- [X] T004 Draw the icon set (about 45 icons on the 24 px grid, 2 px round strokes, shapes echoing the mark) with `Icon`, `ICONS`, `SECTION_ICONS`, and `REASON_ICONS` in packages/ui/src/icons/
- [X] T005 Draw the nine illustrations (`door`, `welcome`, `noProperties`, `inboxClear`, `noRequests`, `noData`, `offline`, `unavailable`, `wait`) and the small brand mark in packages/ui/src/illustrations/
- [X] T006 [P] Add illustration and icon tokens for light and dark mode (`--il-*`) in apps/portal/app/globals.css and apps/guide/styles/guide.css

## Phase 3: User Story 1 - The portal fits the screen (P1)

**Independent test**: Inbox, properties, analytics, and settings at 375, 768, and 1280 px.

- [X] T007 [P] [US1] Write unit tests for destination matching (`currentDestination(path)`, Team vs Settings, conversations under Inbox) in apps/portal/test/shell-nav.test.ts
- [X] T008 [US1] Add the destination list and matcher in apps/portal/components/shell/destinations.ts and the client `NavLink` (aria-current, `is-current`) in apps/portal/components/shell/nav-link.tsx
- [X] T009 [US1] Rebuild the signed-in shell: sidebar (logo, switcher, all destinations), compact top bar, bottom bar with More popover, icons rendered by the server layout and passed as nodes, in apps/portal/app/[locale]/(app)/layout.tsx and apps/portal/components/app-header.tsx
- [X] T010 [US1] Add `PageHeader` in apps/portal/components/shell/page-header.tsx and use it on inbox, requests, properties, analytics, settings, and shared content
- [X] T011 [US1] Shell CSS: breakpoints at 600 and 1024 px, 75rem content, `.page-narrow` for forms, grids for property cards and stat cards, print rules, safe areas, in apps/portal/app/globals.css
- [X] T012 [US1] Add `nav.more` and page help texts in packages/i18n/messages/es.json and en.json

## Phase 4: User Story 2 - Text is never cut off (P1)

- [X] T013 [P] [US2] Write an e2e test at 320 px and 1280 px with 200% zoom (guide home, sign-in, properties, inbox, settings) asserting no horizontal overflow and no element with `text-overflow: ellipsis` or `hyphens: auto`, in e2e/specs/brand-shell.spec.ts
- [X] T014 [US2] Remove truncation and hyphenation (guide top bar name, workspace switcher, chips, tiles), switch fixed heights to `min-height`, keep `overflow-wrap: anywhere` only for user strings, in apps/guide/styles/guide.css and apps/portal/app/globals.css

## Phase 5: User Story 3 - Icons (P1)

- [X] T015 [US3] Guide tiles as icon rows (one column under 560 px, two from 560 px) for sections, Extras, and Explore in apps/guide/src/pages/guide-pages.tsx and apps/guide/styles/guide.css
- [X] T016 [US3] Section header icons in the guest section page and the property page in apps/guide/src/pages/guide-pages.tsx and apps/portal/components/properties/
- [X] T017 [US3] Reason chip icons in the inbox list in apps/portal/components/inbox/
- [X] T018 [US3] Icons on key actions (add property, paste a guest message, copy link, show code, ask, call emergency) in the portal and guide components
  - Note: the "Show code" button is created and relabeled by the guide script, so it stays text-only
    (keeps the 15 KB script simple); the locked-field label it belongs to carries the `lock` icon.
- [X] T019 [P] [US3] Guide unit test: every tile has an icon and its text in apps/guide/test/brand.test.tsx

## Phase 6: User Story 4 - Sign-in feels like Guidesk (P2)

- [X] T020 [US4] `(auth)` layout with logo, illustration, and the brand panel with the tagline in apps/portal/app/[locale]/(auth)/layout.tsx; `auth.tagline` in the catalogs
- [X] T021 [US4] Google "G" mark (apps/portal/public/brand/google-g.svg) and key icon on the sign-in buttons in apps/portal/components/sign-in-form.tsx

## Phase 7: User Story 5 - Empty and status screens (P2)

- [X] T022 [US5] `EmptyState` component in apps/portal/components/empty-state.tsx; use it for no properties, inbox clear, no requests, and no analytics data; welcome illustration on start and onboarding
- [X] T023 [US5] Illustrated guest status pages (unavailable, rate limited, one moment, offline) with the small mark in apps/guide/src/pages/simple-pages.tsx and apps/guide/src/handler.tsx
- [X] T024 [P] [US5] Guide unit tests for the status pages (illustration present, no stay data, mark present) in apps/guide/test/brand.test.tsx

## Phase 8: User Story 6 - Free credit (P3)

- [X] T025 [P] [US6] API integration test: `credit` is true for a Free workspace and false for Pro in apps/api/test/integration/guest-credit.test.ts
- [X] T026 [US6] `GuestGuide.credit` in packages/contracts/src/guest.ts; the guest target reads `workspace.plan` in apps/api/src/guest/guest-context.ts and the payload sets `credit` in apps/api/src/guest/guest-guide.service.ts; guide fixtures updated
- [X] T027 [US6] Credit footer on the guide home and sections in apps/guide/src/components/layout.tsx and guide-pages.tsx; `credit.label` in packages/i18n/messages/guest.*.json

## Phase 9: User Story 7 - Link previews (P3)

- [X] T028 [US7] Preview image builder in docs/brand/build/og.mjs; generate apps/portal/public/brand/og-es.png and og-en.png
- [X] T029 [US7] Guide preview tags in apps/guide/src/components/layout.tsx (property name, fixed description, image, locale), the same for stay links; `meta.description` in guest catalogs
- [X] T030 [US7] Public pages: preview image and twitter card in apps/portal/lib/public/metadata.ts
- [X] T031 [P] [US7] Tests: guide pages carry the tags and no stay data (apps/guide/test/brand.test.tsx); public metadata includes the image (apps/portal/test/public-helpers.test.ts); preview files exist and are under 100 KB

## Phase 10: Polish

- [X] T032 Update the brand guide (icons and illustrations sections, the inline-SVG decision) in docs/brand/README.md, the design system shell notes in docs/ux/design-system.md, and the audit status in docs/brand/brand-application-audit.md
- [X] T033 Run unit, lint, and typecheck across the monorepo; the API integration test; the e2e suites touched (smoke, public pages, a11y, guest, inbox, brand shell); and the bundle check after a production build
- [X] T034 Compare phone (375 px) and desktop (1280 px) screenshots of the main screens in light and dark mode and fix what looks wrong

## Dependencies

- T001 → T002–T006 → all stories.
- US1 (T007–T012) and US2 (T013–T014) touch the same CSS; do US1 first.
- US3 depends on T004; US4 and US5 depend on T005; US6 and US7 are independent of the shell.

## Implementation Strategy

Shared assets first, then the shell and the no-cut rules (the founder's priorities), then icons,
brand screens, empty states, the credit, and previews; polish and full checks last.

## Implementation notes (2026-11-19)

- The bottom bar has four columns (Inbox, Requests, Properties, More); Analytics moved under More so
  every Spanish label fits whole at 320 px (research R13, spec clarification updated).
- Stay-link pages get a generic preview title because the token is never looked up before the
  guest opens it (research R14, FR-023 updated).
- Illustrations, like icons, are one export per scene so client bundles carry only what they show.
- Bundle check after a production build: every route within 150 KB; the closest are `/es/requests`
  and the section editor at 149.5 KB.
- E2E (mobile project, Pixel 7): `brand-shell` (new), smoke, public pages, sign-up, guest US1,
  inbox US1, extras US3, analytics US3 pass; two specs that clicked Analytics and Shared content now
  open More first.
