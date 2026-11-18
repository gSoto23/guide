# Implementation Plan: Tours and Experiences (Affiliate)

**Branch**: `009-tours-affiliate` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/009-tours-affiliate/spec.md`

## Summary

Explore in the guest guide: the host's tips first, then up to 12 partner experiences near the property,
grouped by category, each with a commission disclosure; "Book on {partner}" goes through a safe,
counted redirect on the guide origin. Hosts choose what guests see per property and as a workspace
default. The assistant may point guests to Explore; the copilot never does.

Technical approach: an `ExperiencePartnerPort` with a Viator basic-access adapter and a fixtures
adapter; a curated Civitatis list in the repository; a worker job refreshes active destinations every 30
minutes and keeps Viator content at most 1 hour (its terms); pure domain functions for destination keys,
categories, selection, settings, and redirect targets; guest and member routes in the API; two
server-rendered guest pages; a portal settings screen ([research](research.md)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS

**Primary Dependencies**: existing stack; no new packages (the Viator adapter uses `fetch`).

**Storage**: PostgreSQL 16: `experience_destination`, `experience_refresh`, `experience`,
`experience_partner_reference` (global, read-only for the app role), `explore_settings`,
`explore_open_daily`, `experience_click_daily` (RLS by workspace) ([data model](data-model.md)).

**Testing**: Vitest (unit for domain rules; contract test of the Viator adapter against a local HTTP
server with synthetic responses; integration with Testcontainers), Playwright on the phone viewport,
axe, Lighthouse CI for the guide, the `evals/agent` suite.

**Target Platform**: API and worker (ECS Fargate), guest app (Lambda behind CloudFront), portal.

**Project Type**: Web application in the existing monorepo.

**Performance Goals**: Explore and detail LCP ≤ 2.5 s (mid-range phone, 4G); guest explore route p95 ≤
150 ms at the origin; click redirect p95 ≤ 300 ms; settings routes p95 ≤ 300 ms; portal route ≤ 150 KB
gzip; guide JavaScript within its size check.

**Constraints**: no partner call during a guest request; Viator content kept at most 1 hour; redirects
only to stored partner pages on allowlisted hosts; no guest data to partners or in counts.

**Scale/Scope**: 2 guest pages, 1 portal screen (property) plus a workspace card, about 7 endpoints, 2
worker jobs, 1 partner adapter, 1 curated list.

## Constitution Check

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | Spec committed (`626e59e`) with 7 clarifications under the standing authorization; checklist complete; caching rule updated after research | [x] |
| II. Platform Compliance | PC-07 (disclosure everywhere, not removable), PC-08 (links only), PC-10 (copilot never; chat only points to Explore when asked), PC-11 (no guest data), PC-02 | [x] |
| III. Guest Trust and Human-in-the-Loop | Hosts control what guests see; settings changes logged; no unsolicited offers | [x] |
| IV. Channel-Agnostic Core | Partners behind `ExperiencePartnerPort` with fixtures and a contract test; curated list behind the same selection | [x] |
| V. Test-First and Eval-Driven | Tests first per story; eval cases for the Explore pointer | [x] |
| VI. Security and Privacy | SEC-02 (no referrer), SEC-11 (plain text, allowlisted links and image hosts, no partner scripts), SEC-13 (Viator key as a secret, background-only calls with timeouts), SEC-14 (RLS on 3 tenant tables, read-only global tables, cross-tenant tests), SEC-16, SEC-20 | [x] |
| VII. Simplicity | No new dependency, datastore, or vendor SDK; curated list as a reviewed file instead of a back-office | [x] |
| VIII. Observability | `explore.refresh` span with per-partner counts and error codes; stale-destination count | [x] |
| IX. International | Spanish and English texts; partner text per language with an English fallback note; partner currencies shown as given; days in the property's time zone | [x] |
| Performance | Budget below; Lighthouse and timing tests | [x] |

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Explore and experience detail (guest) | LCP at p75, mid-range phone on 4G | ≤ 2.5 s | Lighthouse CI (guide config) |
| Guest app JavaScript | Size check | Within spec 004's limit | `size:check` |
| Guest explore route | API latency | p95 ≤ 150 ms | Integration timing test |
| Click redirect | API latency | p95 ≤ 300 ms | Integration timing test |
| Explore settings routes | API latency | p95 ≤ 300 ms | Integration timing test |
| Property Explore screen (portal) | Initial JavaScript | ≤ 150 KB gzip | Portal bundle check |

## Project Structure

### Documentation (this feature)

```text
specs/009-tours-affiliate/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/http-api.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/domain/src/explore/          # categories, destination keys, selection, settings, redirect target
packages/integrations/src/experiences/ # ExperiencePartnerPort, Viator adapter, fixtures adapter, config
packages/integrations/catalog/experiences.json   # curated Civitatis entries
packages/contracts/src/explore.ts      # guest and member shapes
packages/db/src/schema/explore.ts      # + migrations 0030, 0031
packages/i18n/messages/                # portal and guest catalogs
apps/api/src/explore/                  # guest explore and redirect, member settings routes
apps/api/src/guest/                    # guide response `explore.visible`, opens kind `explore`
apps/worker/src/jobs/                  # explore-refresh.ts, explore-references.ts, chat-reply (exploreUrl), retention
apps/guide/src/                        # explore pages, navigation, CSP image origins, script, service worker
apps/portal/app/[locale]/(app)/properties/[propertyId]/explore/, components/explore/
evals/agent/                           # Explore pointer cases
e2e/specs/explore-us1 … explore-us5
infra/                                 # ViatorApiKey secret, EXPERIENCES_MODE, image origins
```

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A refresh job every 30 minutes | Viator keeps search results at most 1 hour (R2) while guests must never wait on it (FR-017) | Daily ingestion breaks the terms; live calls slow the guide |
| Global partner tables readable by the app role | The settings screen lists partner experiences for the destination | Copying them per workspace multiplies storage for public content |
| A curated list file | Civitatis has no self-service content access (R3) | A back-office editor is more work than the pilot's few entries |
