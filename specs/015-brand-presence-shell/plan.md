# Implementation Plan: Brand Presence and Responsive Shell

**Branch**: `015-brand-presence-shell` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/015-brand-presence-shell/spec.md`

## Summary

Make the "Bienvenida" identity visible across the portal and the guest guide, and give the portal the
responsive shell the design system describes. One icon set and one illustration set, drawn for
Guidesk, live in `@guidesk/ui` and render as server-side inline SVG in both apps. The portal gets a
bottom bar (compact and medium) and a sidebar (expanded), a page header pattern, responsive grids,
branded sign-in screens, and illustrated empty states. The guest guide gets icon tiles that never
cut words, illustrated status pages, the Free-plan credit, and link previews. No data changes; the
guest guide contract gains one field (`credit`).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24; React 19 (portal on Next.js 16, guide server-rendered with `react-dom/server`)

**Primary Dependencies**: Existing only: Next.js, next-intl, NestJS, Drizzle; `sharp` (already a dev dependency) to raster the preview images

**Storage**: No change (reads `workspace.plan` for the credit)

**Testing**: vitest (ui, portal, guide, api units), vitest + Testcontainers (API integration), Playwright with axe (portal and guide e2e), the bundle budget check, Lighthouse CI

**Target Platform**: Mobile and desktop browsers (last two versions of Safari, Chrome, Firefox, Edge; iOS Safari 17+)

**Project Type**: Web application (monorepo: `apps/portal`, `apps/guide`, `apps/api`, shared `packages/*`)

**Performance Goals**: Portal ≤ 150 KB initial JavaScript per route; guide ≤ 100 KB per route, ≤ 500 KB initial weight, LCP ≤ 2.5 s, CLS ≤ 0.1

**Constraints**: CSP with nonces (no inline `style` attributes, so SVG colors come from classes); no third-party scripts, fonts, or images; WCAG 2.2 AA; reflow at 320 px; system fonts

**Scale/Scope**: 50 portal routes share the shell; about 36 icons and 9 illustrations; 6 guest guide page types

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec written with clarifications answered; no open markers | [x] |
| II. Platform Compliance | No platform messaging or listing changes; Google's sign-in branding followed for the "G" button (research R9) | [x] |
| III. Guest Trust and Human-in-the-Loop | No change to escalations or autonomy; reason chips keep their text | [x] |
| IV. Channel-Agnostic Core | No external system added | [x] |
| V. Test-First and Eval-Driven | Unit tests for icons, illustrations, navigation, credit, and metadata; e2e for breakpoints, cut text, and axe, listed before implementation in tasks; no agent change | [x] |
| VI. Security and Privacy | Previews never carry stay data (FR-023, tested); the credit reads the plan server-side; CSP unchanged | [x] |
| VII. Simplicity | No new runtime, vendor, or dependency; icons and illustrations are plain components in the existing `@guidesk/ui` | [x] |
| VIII. Observability | No new backend path beyond one joined column; existing logs apply | [x] |
| IX. International | Every new label in es and en catalogs (portal, guest, public) | [x] |
| Performance | Budgets below, enforced by the bundle check and Lighthouse CI | [x] |

Post-design re-check (after Phase 1): all items still pass; no complexity entries.

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Portal routes (all listed in `bundle-budget.json`) | Initial JavaScript, gzip | ≤ 150 KB; the shell adds ≤ 1.5 KB | `scripts/check-bundle-budget.ts` in CI |
| Portal auth and public pages | LCP / CLS / accessibility | ≤ 2.5 s / ≤ 0.1 / ≥ 0.95 | Lighthouse CI |
| Guest guide home | Initial page weight | ≤ 500 KB; icons and credit add ≤ 8 KB of HTML before compression | Guide size test |
| Guest guide home | LCP / CLS | ≤ 2.5 s / ≤ 0.1 | Lighthouse CI (existing guide config) |
| Preview image | File size | ≤ 100 KB each (es, en) | Unit test on the files |

## Project Structure

### Documentation (this feature)

```text
specs/015-brand-presence-shell/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── icons-illustrations.md
│   ├── portal-shell.md
│   └── guest-guide-brand.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/ui/src/
├── icons/            # icon data (one export per icon), <Icon>, the name registry
├── illustrations/    # nine illustrations as components with class-based colors
└── index.ts          # exports

apps/portal/
├── app/[locale]/(app)/layout.tsx          # shell: sidebar, bottom bar, More, main area
├── app/[locale]/(auth)/layout.tsx         # new: two-panel brand layout
├── components/shell/                      # nav items, NavLink (client, aria-current), More popover, PageHeader
├── components/empty-state.tsx             # illustration + text + action
├── components/app-header.tsx              # becomes the sidebar/top bar content
├── public/brand/og-es.png, og-en.png, google-g.svg
├── lib/public/metadata.ts                 # preview images
└── app/globals.css                        # shell, grids, illustration tokens, no-cut rules

apps/guide/
├── src/pages/guide-pages.tsx              # icon tiles, credit footer
├── src/pages/simple-pages.tsx             # illustrated status pages
├── src/components/layout.tsx              # preview metadata, credit, mark
└── styles/guide.css                       # tile layout without hyphenation, illustration tokens

apps/api/src/guest/                        # credit flag from the workspace plan
packages/contracts/src/guest.ts            # GuestGuide.credit
packages/i18n/messages/*.json, public/*.json
docs/brand/build/og.mjs                    # rasters the preview images
docs/brand/README.md                       # icons and illustrations sections
```

**Structure Decision**: The shared visual assets go in the existing `@guidesk/ui` package, already
used by both apps for the guide renderer. App-specific layout stays in each app.

## Complexity Tracking

No violations.
