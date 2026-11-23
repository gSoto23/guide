# Implementation Plan: Desktop Design and Usability Polish

**Branch**: `017-ui-ux-polish` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/017-desktop-design-polish/spec.md`

## Summary

Give the portal a real desktop shape without touching the accepted phone design, and fix the details
that look broken at every width. Almost all of it is CSS in `apps/portal/app/globals.css`, organized as
a "desktop layer" at the 600 px and 1024 px breakpoints, plus small markup changes in the screens that
need new structure (requests, inbox, add-property options, property overview, guide page, settings
index, share, the shell's loading state). Icons render on the server or come from components that
already import the icon module, so no route gains client JavaScript. The guest guide gets a laptop
layout in `apps/guide/styles/guide.css`, and the public home gets feature icons in its server
components. No data, API, or contract changes.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24; React 19 (portal on Next.js 16, guide server-rendered with `react-dom/server`)

**Primary Dependencies**: Existing only: Next.js, next-intl, `@guidesk/ui` icons and illustrations

**Storage**: No change

**Testing**: vitest (portal units), Playwright with axe (portal and guide e2e, mobile project and a 1280 px check), the bundle budget check, before and after screenshots at 375 and 1280 px, light and dark

**Target Platform**: Mobile and desktop browsers (last two versions of Safari, Chrome, Firefox, Edge; iOS Safari 17+); the founder reviews on desktop Safari

**Project Type**: Web application (monorepo: `apps/portal`, `apps/guide`, shared `packages/*`)

**Performance Goals**: Portal ≤ 150 KB initial JavaScript per route (no route may grow); guide ≤ 100 KB per route, ≤ 500 KB initial weight, CLS ≤ 0.1

**Constraints**: CSP with nonces (no inline `style` attributes); WCAG 2.2 AA in light and dark; reflow at 320 px and 200% zoom; no cut text (spec 015); system fonts; tokens from the brand guide only

**Scale/Scope**: About 2,350 lines of portal CSS; 9 portal screens with markup changes; 1 shell change; 2 guide CSS changes; 1 public page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec written from the audit, clarifications answered and recorded; no open markers | [x] |
| II. Platform Compliance | No platform messaging, listing, or guest-flow change | [x] |
| III. Guest Trust and Human-in-the-Loop | No change to escalation, autonomy, or what guests see beyond layout; status text unchanged | [x] |
| IV. Channel-Agnostic Core | No integration touched | [x] |
| V. Test-First and Eval-Driven | Unit test for the date formatter and the shell placeholder; e2e checks for the desktop toolbar, button widths, and the workspace menu listed before implementation in tasks; existing a11y and brand-shell specs re-run | [x] |
| VI. Security and Privacy | Presentation only; CSP unchanged (no inline styles, no new origins) | [x] |
| VII. Simplicity | CSS first; no new dependency, component library, or runtime | [x] |
| VIII. Observability | No backend change | [x] |
| IX. International | New texts (settings descriptions, section labels) in es and en | [x] |
| Performance | Budgets below; the bundle check runs before the PR | [x] |

Post-design re-check (after Phase 1): all items still pass; no complexity entries.

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Portal routes in `bundle-budget.json` | Initial JavaScript, gzip | ≤ 150 KB, and no route grows by more than 0.3 KB | `scripts/check-bundle-budget.ts` |
| Portal CSS | Stylesheet, gzip | Grows by ≤ 4 KB | Build output |
| Guest guide pages | Initial weight | ≤ 500 KB; CSS grows by ≤ 1 KB | Guide size test |

## Project Structure

### Documentation (this feature)

```text
specs/017-desktop-design-polish/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── desktop-layout.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
apps/portal/
├── app/globals.css                                 # desktop layer: buttons, toolbar, segmented, cards,
│                                                   # badges, option cards, form rows, skeleton, screens
├── app/[locale]/(app)/settings/page.tsx            # icon cards with descriptions (server)
├── app/[locale]/(app)/properties/[propertyId]/page.tsx  # two-column layout wrapper (server)
├── components/app-header.tsx                       # shell renders before /me loads
├── components/inbox/inbox-view.tsx                 # rows with reason icon, localized stay dates
├── components/notifications/alerts-card.tsx        # banner row
├── components/requests/requests-screen.tsx         # toolbar fields, card grid, facts grid, status colors
├── components/properties/start-options.tsx         # option cards with icons
├── components/properties/property-facts.tsx        # header first; cover moves to the side column
├── components/properties/property-list.tsx         # search in the toolbar
├── components/guide/guide-review.tsx               # action hierarchy, checklist rows
├── components/share/share-screen.tsx               # two columns, segmented language choice
├── lib/dates.ts                                    # new: locale date and range formatting
└── test/dates.test.ts                              # new
apps/guide/styles/guide.css                         # laptop layout: backdrop card, three tile columns
apps/portal/components/public/home-sections.tsx     # feature icons, balanced grid
packages/i18n/messages/{es,en}.json                 # settings descriptions and groups
docs/ux/design-system.md                            # desktop layer documented
```

**Structure Decision**: Keep every change in the layer that owns it: shared component styles in the
portal stylesheet, screen structure in each screen's component, guest layout in the guide stylesheet.
No new package or component library.

## Complexity Tracking

No violations.
