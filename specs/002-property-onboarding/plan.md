# Implementation Plan: Property Onboarding

**Branch**: `002-property-onboarding` | **Date**: 2026-11-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-property-onboarding/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Owners and admins add rental properties to a workspace in six ways:

- a blank start;
- pasted listing text or screenshots, structured by AI;
- a CSV file;
- a read-only import from Beds24 or Hostex;
- duplication of an existing property;
- calendar feeds and stays added by hand, which give each property its stay windows.

Every path ends with the host confirming the core facts. Imported or extracted content stays a
draft labeled with its source; spec 003 turns it into the guide.

Technical approach:

- **Untrusted content in a sandbox:** host-supplied links and uploaded files are handled only by
  two Lambda functions outside the VPC: a feed reader, and a file processor that runs text
  recognition with Tesseract and parses CSV. Nothing that touches untrusted bytes can reach the
  database ([R2](research.md#r2-isolated-sandbox-for-untrusted-content-sec-09-sec-10),
  [R3](research.md#r3-text-recognition-for-screenshots)).
- **Codes never reach the AI:** a deterministic detector removes likely codes from every text
  before it is stored or sent to Claude, and screenshots are never sent to the model
  ([R4](research.md#r4-restricted-value-detection-before-any-ai-call)).
- **Extraction:** one structured Claude call per request, under ADR-0005's model and effort
  rules, gated by a new eval suite
  ([R6](research.md#r6-listing-extraction-with-claude)).
- **Restricted data:** PMS credentials, calendar links, and imported codes use AWS KMS envelope
  encryption with one data key per workspace. This is the first feature to implement SEC-06
  ([R5](research.md#r5-field-level-encryption-sec-06)).
- **PMS adapters:** Beds24 and Hostex sit behind `PmsPort`, with allowlist parsing that drops
  guest contact data. Each provider is behind a feature flag until OQ-26 is confirmed with it
  ([R7](research.md#r7-pms-adapters-beds24-and-hostex)).
- **Background work:** pg-boss jobs for extraction, imports, the 3-hour feed and PMS refreshes,
  retention, and purges ([R13](research.md#r13-background-jobs-and-notifications)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS, as in feature 001

**Primary Dependencies**:

- **Existing:** Next.js and `next-intl` (portal); NestJS with Fastify (API); Drizzle, Zod,
  pg-boss; React Email and SES; SST; OpenTelemetry and Sentry.
- **New:**
  - `@anthropic-ai/sdk` (extraction, ADR-0005);
  - AWS SDK v3 clients for KMS, S3 (with presigned POST), and Lambda;
  - `tesseract.js` with the Spanish and English models, and `sharp` (file processor);
  - `ical.js` (feed reader), and `undici` with `ipaddr.js` (SSRF-safe fetch);
  - `csv-parse` and `csv-stringify`;
  - generated time zone data from the IANA `zone1970.tab` and GeoNames (CC BY 4.0).

**Storage**:

- **RDS PostgreSQL 16:** new tenant tables with RLS forced
  ([data model](data-model.md)).
- **S3:** one private uploads bucket that deletes objects after 1 day.
- **AWS KMS:** one customer-managed key that wraps the per-workspace data keys.

**Testing**: Vitest (unit, contract, and integration with Testcontainers), recorded provider
fixtures for Beds24, Hostex, and Anthropic, an in-process sandbox with a fake DNS resolver for
SSRF tests, Playwright (end to end, phone viewport), a local iCal fixture server, Mailpit, and
the new extraction eval suite (`evals/extraction/`).

**Target Platform**:

- **Portal:** mobile-first PWA (OpenNext on Lambda and S3, behind CloudFront).
- **API and worker:** ECS Fargate in private subnets.
- **Sandbox:** two Lambda functions not attached to the VPC (`feed-reader`, `file-processor`).

**Project Type**: Web application in the existing pnpm and Turborepo monorepo.

**Performance Goals**: See the [Performance Budget](#performance-budget). Key targets:

- the first property from listing text in 5 minutes or less (median, SC-001);
- extraction within 60 seconds (FR-016);
- 200 CSV rows validated within 10 seconds (SC-005);
- 50 PMS listings imported within 10 minutes (SC-004);
- stay changes visible within 3 hours, or 1 minute after "Refresh now" (SC-006).

**Constraints**:

- Images never reach the AI.
- Restricted values never reach logs, traces, error reports, AI prompts, or API responses.
- Only the sandbox functions fetch host-supplied URLs or parse uploaded bytes.
- No Redis.
- PMS access is read-only.
- Beds24 credits are shared with the host's other tools, so imports never drop below 30
  remaining credits.
- No outside geocoding service.

**Scale/Scope**:

- **Year-1 target:** 5,000 properties (NFR-09). About 7,500 calendar feeds refreshed every 3
  hours is about 42 feed reads per minute, well within one worker and the sandbox's
  concurrency.
- **Portal:** about 10 screens (property list, start options, paste, CSV, PMS import, property
  detail with facts, content, calendars, and stays, plus confirmation and removal dialogs).
- **API:** about 40 endpoints ([contracts](contracts/http-api.md)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | No open `[NEEDS CLARIFICATION]`; clarify session of 2026-11-15 recorded; quality checklist 16/16. The spec is not committed yet: commit it with this plan before `/speckit-tasks` | [x] |
| II. Platform Compliance | **PC-12:** no listing page is ever fetched; a URL-only input makes no fetch and no AI call (test). No OTA passwords are asked for. Stays come from OTA iCal exports and PMS APIs only. **PC-11:** PMS guest names are used only to show stays; they never go to the AI or marketing. **PC-03:** no guest contact data is stored (AC-SEC-012) | [x] |
| III. Guest Trust and Human-in-the-Loop | No guest-facing agent behavior. Extracted and imported content is a draft that is never published (FR-018). Each extraction records model, tokens, and cost | [x] |
| IV. Channel-Agnostic Core | `PmsPort` (Beds24, Hostex), `LlmPort`, `TextRecognitionPort`, `KeyManagementPort`, `ObjectStoragePort`, and `SandboxPort`. Each adapter has contract tests on recorded fixtures, and R7 documents each PMS's field mapping | [x] |
| V. Test-First and Eval-Driven | Test layers in R14; tasks list tests first. A new extraction eval suite (30 listings plus injection cases) gates prompt, schema, model, and effort changes (R6) | [x] |
| VI. Security and Privacy | Every Security Considerations item maps to a control: SEC-05 (step-up), SEC-06 (R5), SEC-07 (R12), SEC-09 (R2), SEC-10 (R2, R9), SEC-13 (R7), SEC-14 (RLS forced on all 11 new tables, plus the CI check), SEC-16 (data model §5), and SEC-20 (minimization and retention, data model §6). Restricted data is encrypted, decrypted only by the worker, and kept out of logs and prompts | [x] |
| VII. Simplicity | No new runtime, datastore, or vendor. S3 and KMS are already in ADR-0009. The sandbox functions use the same Node.js runtime and SST. GuardDuty Malware Protection and Tesseract are an AWS service and a library. Tasks amend ADR-0009's service table and SEC-09's wording. The sandbox is justified in Complexity Tracking | [x] |
| VIII. Observability | OpenTelemetry spans for every job and sandbox call, failure counters per provider and error code, Sentry with the existing scrubbing, and AI usage stored per extraction (R13) | [x] |
| IX. International | Spanish and English for every screen, email, the CSV template, and CSV headers. Times shown in the property's time zone. Extracted content keeps its language. No currency in this feature | [x] |
| Performance | Budget declared below; Lighthouse CI, bundle check, k6, and timing tests in CI | [x] |

**Result:** pass, with one step for the founder: commit the spec together with this plan. Two
external confirmations gate production but not development: OQ-26 for each PMS (feature flags)
and the R3 recognition accuracy check (the `extraction.screenshots` flag).

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Property list, start options, creation, and property detail pages | LCP at p75, mid-range mobile on 4G | ≤ 2.5 s | Lighthouse CI on preview deploys |
| Same pages | INP / CLS at p75 | ≤ 200 ms / ≤ 0.1 | Lighthouse CI, real-user monitoring |
| Same pages | Initial JavaScript per route | ≤ 150 KB gzip; image normalization and CSV preview load on demand | Bundle-size check in CI |
| Property, stay, listing-content, and import-status endpoints | Latency, excluding sandbox, PMS, and AI calls | p95 ≤ 300 ms | k6 against staging, OpenTelemetry |
| Saving a calendar link (includes the feed read) | Request to response | p95 ≤ 12 s (10 s read limit) | Integration test, OpenTelemetry |
| PMS credential check and listing | Request to response | p95 ≤ 15 s | Contract fixtures with provider latency, OpenTelemetry |
| Extraction, maximum input | Submit to result | ≤ 60 s hard limit (FR-016); p50 ≤ 20 s | Integration test with a fake model; staging measurement |
| CSV validation | Upload to per-row results | 200 rows ≤ 10 s (SC-005); 500 rows ≤ 30 s | Integration test |
| PMS import | Start to finish | 50 listings ≤ 10 min (SC-004), subject to provider rate limits | Fixture adapter with simulated latency and credits |
| Calendar or PMS change | Change at the source to visible | ≤ 3 h scheduled; ≤ 1 min after "Refresh now" (SC-006) | Integration test with the iCal fixture server |

## Project Structure

### Documentation (this feature)

```text
specs/002-property-onboarding/
├── spec.md              # Feature specification (with the 2026-11-15 clarifications)
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R15
├── data-model.md        # Phase 1: tables, RLS, retention, state machines
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── http-api.md      # Phase 1: REST endpoints, roles, errors
│   └── emails.md        # Phase 1: notification emails
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks, not created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/
├── portal/
│   ├── app/[locale]/(app)/properties/             # list, start options, paste, CSV, PMS import
│   ├── app/[locale]/(app)/properties/[propertyId]/ # facts, listing content, calendars, stays
│   ├── components/properties/                     # confirmation step, forms, banners, dialogs
│   └── lib/image-normalize.ts                     # canvas re-encode and HEIC handling (lazy)
├── api/src/
│   ├── properties/        # CRUD, confirmation, duplicate draft, remove and restore, limits
│   ├── listing-content/   # review, edit, approve
│   ├── extractions/       # requests, presigned uploads, status
│   ├── calendar-feeds/    # save with feed check, refresh now
│   ├── stays/             # list, manual stays, hide
│   ├── pms/               # connections, listings, imports, refresh, disconnect
│   ├── imports/           # CSV runs, items, error file, retry
│   ├── uploads/           # presigned POST forms
│   └── time-zones/        # suggestion endpoints
├── worker/src/jobs/       # extraction, csv, pms-import, pms-refresh, calendar-refresh,
│                          # retention, purge-properties
└── sandbox/               # NEW: Lambda handlers feed-reader and file-processor
packages/
├── domain/src/properties/ # core facts, setup status, limits, CSV rules, feed classification,
│                          # stay dedupe, restricted-value detector, time zone suggestion
├── db/src/schema/         # properties.ts, stays.ts, pms.ts, imports.ts, keys.ts + migrations
├── contracts/src/         # Zod schemas for the endpoints above
├── integrations/src/      # pms/ (beds24, hostex), llm/ (anthropic), ocr/ (tesseract, textract),
│                          # kms/ (aws, local), storage/ (s3, local), sandbox/ (lambda, in-process)
├── vault/                 # NEW: envelope encryption over KeyManagementPort
├── emails/src/properties/ # import finished, feed failing, PMS reconnect (ES/EN)
└── i18n/messages/         # property onboarding strings (ES/EN)
evals/extraction/          # NEW: 30 sample listings, injection cases, runner
infra/                     # uploads bucket, KMS key, sandbox functions, GuardDuty plan
e2e/specs/                 # property onboarding flows
```

**Structure Decision**: This follows the layout from the
[architecture overview](../../docs/architecture/overview.md#8-repository-layout). It adds three
new units:

- `apps/sandbox`: the isolation boundary required by SEC-09 and SEC-10;
- `packages/vault`: restricted-data encryption, kept separate so its use can be audited;
- `evals/extraction`: the first eval suite, which the constitution requires for prompt changes.

## Post-Design Constitution Re-check

The Phase 1 design keeps every check above.

- **Data model:**
  - RLS is forced on all 11 new tables.
  - Agents read feeds only through a view without the link columns, and never see PMS
    connections.
  - Restricted columns hold only ciphertext, with additional authenticated data that binds each
    value to its row.
- **Contracts:**
  - Feed and connection routes return `404` to agents and to other workspaces.
  - Creating paths re-check the plan limit and pending deletion in the same transaction.
  - No response carries a restricted value, only masks and hints.
- **Retention:**
  - Screenshots and CSV files are deleted after processing, with a 1-day bucket backstop.
  - Extraction text is deleted after confirmation or 7 days.
  - Guest names are deleted 12 months after checkout, pending OQ-35.
  - PMS credentials are deleted at disconnect.

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Two sandbox Lambda functions outside the VPC (`apps/sandbox`) | SEC-09 requires that the component fetching host-supplied URLs has no route to internal services. SEC-10 requires that uploaded files are parsed in isolation. The current worker shares the database network | Fetching and parsing in the worker with an IP blocklist only: a single bypass would reach the database network. A separate ECS service in an isolated subnet: more infrastructure for the same boundary |
| `packages/vault` | SEC-06 envelope encryption is used by several API modules and worker jobs, and decryption must stay auditable | Inline encryption in each module: harder to audit and easy to misuse |
