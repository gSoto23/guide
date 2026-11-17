# Implementation Plan: Guide Builder

**Branch**: `003-guide-builder` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-guide-builder/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Owners and admins build each property's guest guide in the portal: a draft made from the
property's data, a section editor with formatted text, images, and short videos, locked fields for
codes, an AI interview by text or voice, document and photo reading, Spanish and English
translation, shared content across properties, a completeness score, and explicit, versioned
publishing. Agents read only.

Technical approach:

- **Content as items with typed documents:** each section is a list of items (text, image, video,
  recommendation, fact) with a source label and review state; text lives in a JSON document per
  language validated against a strict schema, so nothing unsafe is ever stored
  ([R2](research.md#r2-content-model-items-with-a-rich-text-document-per-language)). Tiptap edits
  it, loaded on demand ([R3](research.md#r3-editor)).
- **Locked fields** extend 002's restricted values; a single reveal service in the API decrypts,
  behind step-up, a per-member limit, and the security log
  ([R4](research.md#r4-locked-fields-and-the-reveal-service)).
- **Codes never reach the AI:** 002's detector runs before every model call, with reversible
  masking for translation ([R5](research.md#r5-codes-never-reach-the-ai)).
- **AI:** four structured Claude calls (draft from listing, interview answer, document
  suggestions, block translation) under ADR-0005, each gated by an eval suite
  ([R6](research.md#r6-ai-calls)); speech to text with Amazon Transcribe behind a new port
  ([R8](research.md#r8-speech-to-text-for-voice-notes)).
- **Files:** the 002 uploads path and sandbox gain PDF, media, and audio modes; images are
  re-encoded and videos lose their metadata in place; a private media bucket serves the portal
  through short-lived links ([R9](research.md#r9-uploads-media-and-documents)).
- **Publishing:** immutable snapshots of reviewed content; locked values and core facts resolve
  at view time; shared blocks fan out to published guides without publishing drafts
  ([R12](research.md#r12-publishing-and-versions), [R14](research.md#r14-shared-blocks)).
- **Completeness:** deterministic topic rules, no AI per save
  ([R10](research.md#r10-key-topics-coverage-and-the-completeness-score)).

## Technical Context

**Language/Version**: TypeScript 6.0 (strict) on Node.js 24 LTS, as in features 001 and 002

**Primary Dependencies**:

- **Existing:** Next.js and `next-intl` (portal); NestJS with Fastify (API); Drizzle, Zod,
  pg-boss; `@anthropic-ai/sdk`; AWS SDK v3 (KMS, S3, Lambda); `sharp` and `tesseract.js`
  (sandbox); React Email; SST; OpenTelemetry and Sentry.
- **New:**
  - `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link` (portal editor,
    MIT);
  - `@aws-sdk/client-transcribe` (speech to text, R8);
  - `pdfjs-dist` (Apache-2.0) and `@napi-rs/canvas` (MIT, scanned pages) in the sandbox (R9).

**Storage**:

- **RDS PostgreSQL 16:** 13 new tenant tables with RLS forced, and changes to `restricted_value`,
  `upload`, and `workspace` ([data model](data-model.md)).
- **S3:** the 002 uploads bucket (1-day lifecycle) for every incoming file, and a new private media
  bucket for images and videos kept in guides.
- **AWS KMS:** the 002 key and per-workspace data keys, unchanged.

**Testing**: Vitest (unit, contract, integration with Testcontainers); recorded fixtures for
Anthropic and Transcribe; sandbox fixture files (PDFs, MOV with location metadata, MP4, WebM);
a spying fake `LlmPort` that records inputs; Playwright on a phone viewport with fake model and
speech adapters; Mailpit; one new eval package, `evals/guide`, with three suites (drafting, interview, translation).

**Target Platform**: the portal (mobile-first PWA), the API and worker on ECS Fargate, and the
`file-processor` sandbox Lambda, as in feature 002.

**Project Type**: Web application in the existing pnpm and Turborepo monorepo.

**Performance Goals**: See the [Performance Budget](#performance-budget). Key targets:

- median time from sign-up to published guide 30 minutes or less (SC-001);
- interview drafts within 15 seconds (text) and 30 seconds (voice) (FR-036);
- translations within 2 minutes of the last save (FR-044, SC-005);
- the completeness score within 1 minute of a save (FR-031); in practice, in the save response;
- a shared block live in 50 guides within 1 minute (SC-007).

**Constraints**:

- Locked values never reach logs, traces, error reports, job payloads, snapshots, AI inputs, or
  any response except the reveal route.
- Images and audio never reach the language model.
- Only the sandbox parses uploaded bytes; only the reveal service decrypts in the API.
- Draft edits never change what guests or the agent read.
- No Redis; no new datastore.

**Scale/Scope**:

- **Year-1 target:** 5,000 properties (NFR-09): 5,000 guides, about 50 items each (250,000 items,
  500,000 texts), 20 versions each at most, and roughly 50 GB of media.
- **Portal:** about 9 screens (draft review, section editor, locked fields, interview, uploads,
  translations, publish and versions, preview, shared content).
- **API:** about 55 endpoints ([contracts](contracts/http-api.md)).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle (Guidesk constitution) | Check | Status |
|---|---|---|
| I. Spec-First | No open `[NEEDS CLARIFICATION]`; six decisions recorded in the 2026-11-17 clarification session under the founder's standing authorization; quality checklist 16/16; spec committed (`b82bcdf`) | [x] |
| II. Platform Compliance | **PC-07:** recommendations need the benefit answer before approval (test). **PC-06:** the publish check warns on off-platform phrases and payment links (test). **PC-01/PC-02:** the guide stays optional; arrival content is reusable by spec 004 for the OTA thread. **PC-12:** no link in content is ever fetched (AC-SEC-013) | [x] |
| III. Guest Trust and Human-in-the-Loop | No guest-facing agent behavior. Every AI output is an unreviewed draft item; only the host approves and publishes (FR-005, FR-027). Each AI call records model, tokens, and cost (`guide_ai_request`) | [x] |
| IV. Channel-Agnostic Core | `LlmPort` (extended), `SpeechToTextPort` (new: Transcribe, fake), `SandboxPort` (new modes), `ObjectStoragePort` (media bucket). Contract tests on recorded fixtures for each | [x] |
| V. Test-First and Eval-Driven | Test layers in R20; tasks list tests first. Three new eval suites gate prompt, schema, model, and effort changes (R6) | [x] |
| VI. Security and Privacy | Each Security Considerations item maps to a control: SEC-04 (no-store reveal), SEC-05 (step-up and MFA on locked fields), SEC-06 (vault; one reveal service, lint-enforced), SEC-07 (AI and storage limits), SEC-08 (data framing, drafts only, link rule), SEC-10 (sandbox modes, blocking scans for media and documents, metadata removal), SEC-11 (schema-validated documents, media on its own origin), SEC-14 (RLS forced on all 13 new tables plus the CI check), SEC-16 (12 new events), SEC-20 (retention table in data model §6) | [x] |
| VII. Simplicity | No new runtime or datastore. Amazon Transcribe is a service of the existing hosting vendor (AWS): tasks amend ADR-0009's service table and the subprocessor register, as 002 did for GuardDuty. Tiptap, `pdfjs-dist`, and `@napi-rs/canvas` are libraries. The media bucket and the reveal-service exception are justified in Complexity Tracking | [x] |
| VIII. Observability | Spans for every new job and sandbox mode with counts and outcome codes, never content; failure counters per job and error code; AI usage per call; Transcribe job duration as a metric for the R22 gate | [x] |
| IX. International | Spanish and English for every screen, question, email, topic name, and fact rendering; guides in both languages with tracked translations; times in the property's time zone | [x] |
| Performance | Budget declared below; Lighthouse CI, bundle check (routes and the editor chunk), k6, and timing tests in CI | [x] |

**Result:** pass. Five production gates do not block development and are tracked in
[R22](research.md#r22-rollout-flags-and-production-gates): the Transcribe check on real
recordings, the AWS AI-services opt-out policy, GuardDuty blocking for media and documents, the
eval suites against the real model, and the quickstart on staging.

## Performance Budget

| Surface or path | Metric | Budget | Verified by |
|---|---|---|---|
| Guide review, locked fields, interview, uploads, translations, versions, shared content pages | LCP at p75, mid-range mobile on 4G | ≤ 2.5 s | Lighthouse CI on the local production build |
| Same pages | INP / CLS at p75 | ≤ 200 ms / ≤ 0.1 | Lighthouse CI, real-user monitoring |
| Same pages | Initial JavaScript per route | ≤ 150 KB gzip | Bundle-size check in CI |
| Section editor chunk (Tiptap and extensions), loaded on demand | JavaScript | ≤ 120 KB gzip | Bundle-size check in CI (new entry) |
| Guide read, item save, approve, topic mark, publish check | Latency, excluding AI and sandbox calls | p95 ≤ 300 ms (NFR-19) | k6 (`perf/k6/guides.js`), OpenTelemetry |
| Publish (snapshot of a 50-item guide) | Request to response | p95 ≤ 1 s | Integration timing test |
| Completeness after a save | Save to updated score | In the save response; ≤ 1 min (FR-031) | Integration test |
| Interview answer | Submit to drafted items | Text ≤ 15 s, voice ≤ 30 s at p90 (FR-036) | Integration test with fake adapters plus simulated latency; staging gate R22 |
| Section translation | Last save to translated | ≤ 2 min for 90% (SC-005) | Integration test with a fake model; staging measurement |
| Document reading, 60-page PDF | Upload complete to suggestions | ≤ 2 min (FR-041) | Sandbox and worker timing test |
| Shared block fan-out | Publish to live in 50 guides | ≤ 1 min (SC-007) | Integration timing test |
| Media processing | Upload complete to ready | Image ≤ 10 s; 150 MB video ≤ 60 s | Sandbox timing test |

## Project Structure

### Documentation (this feature)

```text
specs/003-guide-builder/
├── spec.md              # Feature specification (with the 2026-11-17 clarifications)
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R22
├── data-model.md        # Phase 1: tables, RLS, retention, state machines
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── http-api.md      # Phase 1: REST endpoints, roles, errors
│   └── emails.md        # Phase 1: the reveal-limit email
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks, not created by /speckit-plan)
```

### Source Code (repository root)

```text
apps/
├── portal/
│   ├── app/[locale]/(app)/properties/[propertyId]/guide/   # review, section editor, locked
│   │                                                      # fields, interview, uploads,
│   │                                                      # translations, publish, versions,
│   │                                                      # preview
│   ├── app/[locale]/(app)/shared-content/                  # shared blocks (H-29)
│   ├── components/guide/                                   # item cards, editor (lazy), locked
│   │                                                      # field chip and dialogs, recorder,
│   │                                                      # completeness, publish dialog
│   └── lib/guide/                                          # autosave queue, offline drafts
├── api/src/
│   ├── guides/           # guide, sections, items, topics, preview, publish, versions
│   ├── locked-fields/    # CRUD, visibility, reveal service (the only API decrypt), history
│   ├── guide-media/      # presigned forms, completion, signed URLs, limits
│   ├── guide-documents/  # reading uploads
│   ├── interviews/       # sessions, answers, voice forms, polling
│   └── shared-blocks/    # blocks, items, publish, links
├── worker/src/jobs/      # guide-draft, guide-translate, interview-answer, guide-document,
│                         # media-process, shared-block-publish; retention (extended)
└── sandbox/src/file-processor/  # pdf.ts, media-image.ts, media-video.ts, audio.ts (new modes)
packages/
├── domain/src/guides/    # template, document rules, topics, coverage, completeness,
│                         # segmenter, translation states, publish checks, snapshot builder,
│                         # shared resolution; restricted-values.ts extended (spoken digits)
├── contracts/src/guides/ # Zod: content documents, endpoints above
├── db/src/schema/        # guides.ts, shared-blocks.ts, media.ts, interviews.ts + migrations;
│                         # changes to properties.ts (restricted_value), extractions.ts (upload)
├── integrations/src/     # llm/ (four new calls, prompts, schemas), speech/ (transcribe, fake),
│                         # sandbox/ (protocol modes), storage/ (media bucket, presigned GET)
├── ui/src/guide-renderer/  # document renderer shared with spec 004
├── emails/src/guides/    # reveal-limit email (ES/EN)
└── i18n/messages/        # guide strings, topic names, interview questions (ES/EN)
evals/guide/              # new: drafting, interview, and translation suites
infra/                    # media bucket, file-processor write permission, Transcribe IAM
e2e/specs/                # guide flows; e2e/fixtures/guide/
perf/k6/guides.js
```

**Structure Decision**: the layout of the
[architecture overview](../../docs/architecture/overview.md#8-repository-layout) and feature 002.
New units: the guide domain folder, six API modules, six worker jobs, three sandbox modes, the
speech port, the guide renderer in `packages/ui` (its first real component, reused by spec 004),
and the `evals/guide` package with three suites.

## Post-Design Constitution Re-check

The Phase 1 design keeps every check above.

- **Data model:**
  - RLS is forced on all 13 new tables; agents read locked fields only through a view without the
    ciphertext and `public_value` columns.
  - `guide_version` is insert-only for the application role; snapshots carry references, never
    values.
  - Shared blocks refuse `lockedField` nodes by schema.
- **Contracts:**
  - The only response that can carry a locked value is the reveal route, with step-up, MFA, a
    per-member limit, `no-store`, and a security-log event.
  - Every write checks role, pending deletion, and revision in one transaction.
  - Agents get `403` on writes (logged) and never see values or reveal history.
- **Retention:** voice files and read documents are deleted within 24 hours; answers,
  transcripts, and document text after 7 days; versions beyond 20; unreferenced media after 24
  hours; AI usage rows after 12 months (data model §6).

## Complexity Tracking

| Addition | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The reveal service decrypts in the API (one file, ESLint exception) | FR-016 needs the value in one request; 002's worker round trip would store the plaintext in the job table | A worker job: plaintext at rest in pg-boss. A separate Lambda: more infrastructure for one route |
| A second S3 bucket for media | Guide media must live beyond 24 hours and be served on its own origin; the uploads bucket deletes everything after 1 day and is write-only for browsers | One bucket with prefixes: mixes a short-lived untrusted area with served content and complicates lifecycle and CORS rules |
| Amazon Transcribe (AWS service) | FR-035 and FR-037 need speech to text separate from the drafting model | A self-hosted Whisper: cold starts and CPU time put the 30-second target at risk. Other vendors: new subprocessors |
| Content as items with per-language documents | Source labels, review states, shared blocks, and partial publishing work per piece of content (FR-005, FR-051) | One document per section: review markers inside the document and HTML sanitizing instead of a schema check |
