# Implementation Plan: Guest Guide

**Branch**: `004-guest-guide` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-guest-guide/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Guests open a property's published guide (spec 003) from a link or QR code on their phone, with no
app or account. The property link shows public content; a per-stay link unlocks locked fields for
that stay's window, optionally behind a Guidesk-generated confirmation code. Hosts share everything
from a Share screen: the property link, a printable QR code, a scheduled-message template, and per
stay a stay link and a ready-to-paste message with the access instructions.

Technical approach:

- **A new guest app (`apps/guide`)** renders HTML on the server with React and never hydrates it;
  a small browser script and a service worker add the interactive parts and offline reading. It
  runs as a Lambda behind its own CloudFront distribution, which also routes `/api/v1/guest/*` to
  the API, so the guest cookie is host-only on the guide origin
  ([R2](research.md#r2-origins-and-routing), [R3](research.md#r3-guest-app-rendering)).
- **Guest routes in the API (`guest` module)** resolve a link or session to one workspace and
  property, reuse feature 003's published preview for content, and reuse its reveal service for
  values, behind window, verification, and rate-limit checks
  ([R7](research.md#r7-showing-codes-to-guests), [R12](research.md#r12-data-access-for-guest-routes)).
- **Links:** 130-bit property links, 256-bit stay tokens stored hashed and encrypted, exchanged once
  per device for an `HttpOnly` cookie and removed from the address bar
  ([R4](research.md#r4-links-tokens-and-confirmation-codes), [R5](research.md#r5-stay-sessions-and-the-token-exchange)).
- **The stay window** is computed per request from the stay, so date changes, cancellations, and
  revocations apply at once ([R6](research.md#r6-the-stay-window)).
- **Caching:** public pages and data on the CDN for 60 seconds with stale-if-error; everything
  personal `no-store`; no codes offline ([R9](research.md#r9-offline-and-caching)).
- **Share screen (`share` module and portal page)** with server-generated QR codes and plain-text
  messages from the published version ([R14](research.md#r14-the-share-screen-qr-codes-and-messages)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS, as in features 001 to 003

**Primary Dependencies**:

- **Existing:** NestJS with Fastify (API); Next.js and `next-intl` (portal); React 19 and
  `react-dom/server` (guest app, server only); `@guidesk/ui` `GuideDocumentView`; Drizzle, Zod;
  the vault and KMS adapter; SST; OpenTelemetry and Sentry.
- **New for `apps/guide`:** `use-intl` (already in the lockfile as `next-intl`'s core) for server
  translations; `esbuild` (already in the lockfile, install scripts still blocked) to bundle the
  browser script, the service worker, and the Lambda handler.
- **New for the API:** `qrcode` (MIT) and `@types/qrcode` for QR codes (R14).

**Storage**:

- **RDS PostgreSQL 16:** 4 new tenant tables with RLS forced (`guide_link`, `stay_link`,
  `guide_session`, `guide_open_daily`) and one column on `guide` ([data model](data-model.md)).
- **S3 media bucket** (feature 003): read through presigned GET URLs for guests.
- **AWS KMS:** the existing per-workspace data keys also encrypt stay tokens and codes.

**Testing**: Vitest (unit, integration with Testcontainers, guest app); Playwright on a phone
viewport (offline mode, two browser contexts for guest and host); axe; Lighthouse CI on guest
pages served from fixtures; k6 for opens and reveals ([R19](research.md#r19-testing)).

**Target Platform**: guest browsers (iOS Safari 16+, Chrome Android 110+, desktop evergreen); the
guest app on AWS Lambda behind CloudFront; the API on ECS Fargate; the portal as today.

**Project Type**: Web application in the existing pnpm and Turborepo monorepo (one new app).

**Performance Goals**: See the [Performance Budget](#performance-budget). Key targets: LCP ≤ 2.5 s
on 4G; guest script ≤ 15 KB gzip; guide data p95 ≤ 300 ms at the origin; reveal p95 ≤ 500 ms;
revocation effective within one request (SC-005).

**Constraints**:

- Locked values never reach cached responses, the service worker, logs, view counts, or security
  event metadata; tokens and codes never reach logs.
- No guest personal data is asked or stored; no device identifiers.
- The guest app ships no inline scripts or styles (strict CSP with cached HTML).
- No new datastore, no Redis; rate limits use the existing PostgreSQL limiter.

**Scale/Scope**:

- **Year-1 target:** 5,000 properties, about 50,000 stays a year, so about 50,000 stay links and up
  to 500,000 sessions a year (10 per link at most, about 2 in practice); 365 × 2 count rows per
  property per year.
- **Guest app:** 6 pages plus the exchange, offline, and unavailable pages.
- **Portal:** 2 screens (Share, poster). **API:** 7 guest and 9 share endpoints.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | No open `[NEEDS CLARIFICATION]`; five decisions recorded in the 2026-11-17 clarification session under the founder's standing authorization (OQ-20 and OQ-28 decided); quality checklist 16/16; spec committed (`4f9c5e4`) | [x] |
| II. Platform Compliance | **PC-01/PC-02:** stay message and template carry the essentials through the OTA thread; every locked state repeats the fallback (tests). **PC-03/PC-04:** no guest data asked; verification uses Guidesk codes only (security review test). **PC-05/PC-06:** template wording and off-platform phrase check (unit test). **PC-07:** benefit disclosure next to recommendations (e2e) | [x] |
| III. Guest Trust and Human-in-the-Loop | No agent behavior in this feature. Guests see only host-approved, published content. Every guest reveal and host export is logged | [x] |
| IV. Channel-Agnostic Core | No new external system. Stays come from feature 002's canonical model whatever their source (iCal, PMS, manual); QR generation is a library, not a provider | [x] |
| V. Test-First and Eval-Driven | Test layers in R19; tasks list tests first in each story. No prompt or model change, so no eval suite changes | [x] |
| VI. Security and Privacy | SEC-01 (two link types), SEC-02 (exchange, cookie, clean URL, headers), SEC-03 (codes, three-scope limits, backoff, alert), SEC-04 (`no-store`, service worker rules, OQ-28 = no offline codes), SEC-05 (step-up on stay links and exports), SEC-06 (one reveal service), SEC-11 (own origin, strict CSP), SEC-14 (RLS forced on 4 new tables, CI check, guest cross-tenant cases), SEC-16 (8 new events), SEC-20 (counts only, retention in data model §7) | [x] |
| VII. Simplicity | No new runtime, datastore, or vendor. The guest app moves from the overview's Next.js to server-only React (measured budget reason, R3), recorded in ADR-0010. Two new libraries (`qrcode`, plus `use-intl` and `esbuild` already in the lockfile). Extra pieces justified in Complexity Tracking | [x] |
| VIII. Observability | Spans for every guest route with outcome codes (never tokens, codes, or values); metrics for exchanges, reveals, verification failures, lockouts, and opens; Lambda errors to Sentry; CloudFront cache hit ratio on the guide distribution | [x] |
| IX. International | Guide in ES/EN with browser detection and a remembered switch; all guest texts and messages in both languages; times in the property's time zone with the device's when it differs; disclosures in the guest's language | [x] |
| Performance | Budget below; Lighthouse CI on guest pages, guest script and style size check, integration timing tests, k6 | [x] |

**Result:** pass. Two production gates do not block development and are tracked in
[R20](research.md#r20-documentation-and-rollout): the guide domain (OQ-11) and the legal review of
disclosure and template wording (OQ-35).

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Guest guide pages (home, section, emergency) | LCP at p75, mid-range mobile on 4G | ≤ 2.5 s | Lighthouse CI on fixture pages; staging gate |
| Same pages | INP / CLS at p75 | ≤ 200 ms / ≤ 0.1 | Lighthouse CI, real-user monitoring later (spec 010) |
| Same pages | TTFB at p75 from the CDN | ≤ 800 ms | Lighthouse CI, CloudFront metrics |
| Same pages | Initial JavaScript | ≤ 15 KB gzip (performance.md cap: 100 KB) | Size check in CI (`size:check`) |
| Same pages | Initial page weight before images | ≤ 150 KB (SC-001; performance.md cap 500 KB) | Size check, Lighthouse |
| Slow 3G | Arrival, Wi-Fi network name, house rules readable | ≤ 5 s | Lighthouse with slow-3G throttling on the fixture home |
| Guide data and pages at the origin (cache miss) | Latency | p95 ≤ 300 ms (SC-009) | Integration timing test, k6 |
| Reveal | Request to response | p95 ≤ 500 ms (SC-009) | Integration timing test, k6 |
| Section opened after the first visit | Tap to content | < 1 s online, < 300 ms offline (SC-002) | e2e timing with throttling |
| Revocation, regeneration, cancellation | Effective for the next request | 100% (SC-005) | Integration test |
| Share screen (portal) | Initial JavaScript per route | ≤ 150 KB gzip | Portal bundle check (new routes) |
| Share screen | LCP at p75 | ≤ 2.5 s | Lighthouse CI on the portal |

## Project Structure

### Documentation (this feature)

```text
specs/004-guest-guide/
├── spec.md              # Feature specification (with the 2026-11-17 clarifications)
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R20
├── data-model.md        # Phase 1: tables, RLS, events, retention
├── quickstart.md        # Phase 1: validation scenarios and founder gates
├── contracts/
│   ├── http-api.md      # Phase 1: guest and share endpoints
│   ├── guide-web.md     # Phase 1: guest app pages, headers, script, service worker
│   └── emails.md        # Phase 1: the verification-locked email
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks, not created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/
├── guide/                         # NEW: guest app (server-only React, no hydration)
│   ├── src/
│   │   ├── handler.ts             # Request → Response router (pages, assets, sw)
│   │   ├── server.ts              # local Node HTTP server (127.0.0.1:3001, proxies /api)
│   │   ├── lambda.ts              # AWS Lambda adapter
│   │   ├── api-client.ts          # fetches /api/v1/guest/guides from the API
│   │   ├── headers.ts             # CSP and security headers, cache policies
│   │   ├── i18n.ts                # use-intl translator over packages/i18n "guest" messages
│   │   ├── pages/                 # home, section, emergency, exchange, unavailable, offline, root
│   │   ├── components/            # layout, tiles, locked field, stay card, media, disclosure
│   │   ├── fixtures/              # fixture guide for Lighthouse (GUIDE_FIXTURES=true only)
│   │   └── client/                # browser script (guide.ts) and service worker (sw.ts)
│   ├── styles/guide.css
│   ├── scripts/                   # build-assets.ts (esbuild + hashes), check-size.ts
│   └── test/                      # router, headers, rendering, sw rules
├── api/src/
│   ├── guest/                     # guest controller, guest context (system tx), sessions,
│   │                              # verification, reveals, opens, media redirect, guard
│   └── share/                     # share controller and service, QR, messages
├── portal/
│   ├── app/[locale]/(app)/properties/[propertyId]/share/   # Share screen and poster
│   └── components/share/          # property link card, template card, stays list, dialogs
└── worker/src/jobs/retention.ts   # new rules
packages/
├── domain/src/guest/              # tokens, codes, window, lock state, backoff, emergency
│                                  # numbers, message builder
├── contracts/src/                 # guest.ts, share.ts
├── db/src/schema/guest.ts         # + migrations 0021 and 0022
├── emails/src/guides/             # verification-locked email (ES/EN)
└── i18n/messages/                 # "guest" and "share" namespaces (ES/EN)
infra/guide.ts                     # GuideRouter (CloudFront + WAF), guest app function, routes
e2e/specs/                         # guest-us1 … guest-us6
perf/k6/guest.js
docs/architecture/adr/0010-guest-guide-server-rendered-without-client-framework.md
```

**Structure Decision**: the layout of the
[architecture overview](../../docs/architecture/overview.md#8-repository-layout), which already
reserves `apps/guide`; its framework changes from Next.js to server-only React (R3, ADR-0010).
New units: the guest domain folder, two API modules, the guest app, one infra file, and the
Share screen.

## Post-Design Constitution Re-check

The Phase 1 design keeps every check above.

- **Data model:** RLS forced on the 4 new tables; agents see no stay links or sessions; token and
  code ciphertexts are not selectable by the request role; sessions hold hashes only; counts hold
  no identifiers.
- **Contracts:** the only guest response that can carry a value is `POST /guest/reveals`, behind
  the session, window, verification, and rate checks, with `no-store` and a security event; stay
  link URLs and codes come only from step-up routes; unavailable cases share one response.
- **Guest app:** no inline script or style; the HTML never contains session state, so CDN caching
  cannot leak one guest's state to another.
- **Retention:** stay links and sessions 30 days after the window; replaced property links 30 days
  (data model §7).

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| A new deploy unit (`apps/guide` on Lambda) and a second CloudFront distribution | SEC-11 asks for a separate guide origin; performance.md asks for CDN-first delivery that survives API outages | Rendering guest pages in the API: couples guest traffic to API capacity and mixes guest and host surfaces; a path on the portal's distribution: same origin as the portal, against SEC-11 |
| Server-only React instead of Next.js for the guest app | The Next.js runtime alone (about 117 KB gzip, measured) exceeds the 100 KB guest budget | Next.js: over budget; another framework: new tool to maintain (R3) |
| Guest routes read tenant data in the system context | Guests have no member, so request RLS has no subject; scoping by IDs resolved from a hashed secret is how the reveal service and worker already work | A dedicated guest database role with per-table policies: more surface for the same guarantee; kept as a pre-launch hardening option (R12) |
| Stay tokens stored encrypted as well as hashed | The host must be able to copy the same stay link again without breaking the one already sent (FR-022) | Hash only: every copy would regenerate the link and silently break earlier messages |
