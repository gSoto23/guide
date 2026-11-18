---

description: "Task list for feature 003: guide builder"
---

# Tasks: Guide Builder

**Input**: Design documents from `/specs/003-guide-builder/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. The constitution (Principle V) mandates test-first. Within each story, test
tasks come first and must fail before the implementation tasks start. Each AI call ships with its
eval suite in the story that introduces it.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested
on its own.

> **Production gates (not development gates):** the Transcribe check on real recordings and the
> AWS AI-services opt-out policy (flag `GUIDE_INTERVIEW_VOICE`); GuardDuty blocking for media and
> documents; the eval suites against the real model; the quickstart on staging. See T118 and
> [research R22](research.md#r22-rollout-flags-and-production-gates).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US7)
- Include exact file paths in descriptions

## Path Conventions

The monorepo from features 001 and 002 (see [plan.md](plan.md#project-structure)):

- `apps/portal`, `apps/api`, `apps/worker`, `apps/sandbox`
- `packages/*`; `evals/guide` (new)
- `infra/` (SST), `e2e/` (Playwright), `perf/k6/`

Conventions that apply to every task:

- New API modules are registered in `apps/api/src/app.module.ts`, and new jobs in
  `apps/worker/src/main.ts` with their queues in `packages/domain/src/jobs.ts`.
- Every creating `POST` accepts `Idempotency-Key`.
- Writes check `properties.manage` in code (through `WorkspaceAction`) and again through RLS.
  Refusals are logged as `access.role_denied`. Reveals and the Wi-Fi switch use
  `restricted.reveal` with `stepUp: true`.
- Every write to a section, block, or item checks `revision` and pending deletion in the same
  transaction, and sets `guide.has_unpublished_changes` when the guide is published.
- Locked values never appear in a response (except the reveal route), a log line, a span
  attribute, an error report, a job payload, a snapshot, an email, or an AI input.
- Before any text reaches `LlmPort`, it passes the restricted-value detector (R5).
- Every screen is in Spanish and English and fully usable on a phone (FR-069, NFR-12); every
  end-to-end test runs on the phone viewport.
- Test data committed to the public repository is synthetic: no copied listing text, real
  addresses, names, or real codes.

## Decisions made while writing these tasks

These refine the plan without adding scope. The plan, research, and quickstart were updated to
match.

1. **One eval package, three suites:** `evals/guide` (`@guidesk/evals-guide`) holds the
   `drafting`, `interview`, and `translation` suites with one runner and one CI job, instead of
   three packages. The harness of `evals/extraction` is copied, not shared, as 002 kept it local.
2. **All 13 tables and their RLS land in the Foundational phase**, in two migrations, as in 002:
   foreign keys cross stories (items to documents, interview turns, media, and shared blocks), and
   one cross-tenant suite then covers every table.
3. **The guide is created inside the property's creation transaction** for every 002 path; only
   the AI part of the draft runs in `guide.draft` (R16). A migration backfills guides for existing
   properties.
4. **The fake `LlmPort` records every input** in memory and exposes it to tests, so every
   "never reaches the AI" check reads the same recorder (SC-004).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependencies, configuration, infrastructure, CI, and the eval package.

- [X] T001 Add dependencies, pinning exact versions that respect the 3-day minimum release age, and record an `allowBuilds` decision for any that requests an install script (SEC-12):
  - `apps/portal/package.json`: `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`;
  - `packages/integrations/package.json`: `@aws-sdk/client-transcribe`;
  - `apps/sandbox/package.json`: `pdfjs-dist` and `@napi-rs/canvas` (prebuilt binaries for the Lambda architecture)
- [X] T002 [P] Scaffold `evals/guide` (`@guidesk/evals-guide`): `package.json` with an `eval` script, `tsconfig.json`, `cases/drafting/`, `cases/interview/`, `cases/translation/`, `cases/injection/`, and placeholder `src/run.ts`, `src/score.ts`, `src/cases.ts` modeled on `evals/extraction`
- [X] T003 Extend the configuration schemas in `apps/api/src/config/config.ts` and `apps/worker/src/config.ts`, and list the names (never values) in `.env.example`:
  - `SPEECH_MODE` (`transcribe|fake`), `MEDIA_BUCKET`, `MEDIA_REQUIRE_SCAN` (boolean, default `true`);
  - flags `GUIDE_INTERVIEW_VOICE` and `GUIDE_SCANNED_PDF`: booleans, default `false`.

  Production refuses `SPEECH_MODE=fake` and `MEDIA_REQUIRE_SCAN=false`. Add cases to `apps/api/test/unit/config.test.ts` and `apps/worker/test/config.test.ts`
- [X] T004 [P] Add the infrastructure in SST (R8, R9):
  - `infra/storage.ts`: the private media bucket: SSE-KMS with the account's S3 key, public access blocked, CORS `GET` and `HEAD` for the portal origin only, no lifecycle expiry; GuardDuty Malware Protection keeps covering the uploads bucket, where every file arrives;
  - `infra/sandbox.ts`: `file-processor` may also `s3:PutObject` on `media/*` in the media bucket and read object tags in the uploads bucket; raise its memory to 3,008 MB, ephemeral storage to 1 GB, and timeout to 120 seconds; bundle `@napi-rs/canvas` for the Lambda architecture;
  - `infra/services.ts`: link the media bucket to the API (presigned GET) and the worker; grant the worker `transcribe:StartTranscriptionJob`, `GetTranscriptionJob`, and `DeleteTranscriptionJob`, `s3:GetObject` on `uploads/*` and `s3:PutObject` on `transcripts/*` in the uploads bucket, and `s3:GetObjectTagging` for the scan wait;
  - `infra/storage.ts`: a lifecycle rule deleting `transcripts/*` after 1 day (covered by the bucket rule; assert it in the infra test)
- [X] T005 [P] Extend `.github/workflows/ci.yml`: build, lint, and test the new code paths; add an `evals-guide` job gated by the existing secret check job (runs when `ANTHROPIC_API_KEY` is present, blocks the merge on failure, uploads `evals/guide/report/`)
- [X] T006 [P] Update the vault rule in `packages/config/eslint.config.js`: `@guidesk/vault/decrypt` stays forbidden outside `apps/worker/src`, with one exception for the file `apps/api/src/locked-fields/reveal.service.ts` (R4). Add a lint fixture test showing another API file still fails

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Tables with RLS, the guide domain rules, the content schema, the ports, limits,
security events, guide creation for every property, and test helpers.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first ⚠️ (write first, must fail)

- [X] T007 [P] Integration test for RLS on the 13 new tables and the `restricted_value` changes, run as `guidesk_app`, in `packages/db/test/integration/guide-builder-rls.test.ts` (SEC-14, AC-SEC-011):
  - a member of workspace A reads nothing of workspace B in any new table;
  - agents cannot insert, update, or delete in any new table;
  - agents read locked fields only through `restricted_value_public`, which has no `value_ciphertext` or `public_value` column;
  - `guide_version` refuses `UPDATE` for the application role;
  - inserts into a workspace pending deletion fail;
  - `guide_item` refuses a row with both or neither of `section_id` and `shared_block_id`
- [X] T008 [P] Content document schema tests in `packages/contracts/test/guide-document.test.ts` (R2, AC-SEC-008): allowed nodes and marks pass; `script`, raw HTML strings, unknown nodes, `javascript:` and `data:` links, image nodes, headings of level 1, and extra attributes fail with a path; `lockedField` is refused when the schema is used for shared-block items
- [X] T009 [P] Detector extension tests in `packages/domain/test/properties/restricted-values.test.ts` and the corpus `restricted-values.corpus.ts` grown to at least 120 snippets (R5): spelled-out digits in Spanish and English, digits split by spaces or dashes, interview phrasings, and look-alikes that must survive (times, prices, phone numbers, room counts, street numbers); recall 100%; reversible masking round trip `{{R1}}`
- [X] T010 [P] Unit tests for the guide template and topics in `packages/domain/test/guides/topics.test.ts`: the nine default sections in order (FR-001); every topic has a valid section kind, a weight from 1 to 5, and at least one rule; topic IDs are unique; the essentials of FR-050 exist
- [X] T011 [P] Unit tests for coverage and completeness in `packages/domain/test/guides/completeness.test.ts` (R10, FR-030 to FR-032): keyword rules in both languages and without accents; locked-field, media, recommendation, personal-tip, and fact rules; AI topic tags; host marks win; "Doesn't apply" leaves the denominator; hidden and custom sections do not count; inherited shared blocks count
- [X] T012 [P] Unit tests for the segmenter in `packages/domain/test/guides/segmenter.test.ts` (R7): round trips for paragraphs, headings, lists, bold, italic, links, `lockedField` nodes, and masked codes; missing, duplicated, or invented tokens are detected
- [X] T013 [P] Unit tests for translation states in `packages/domain/test/guides/translation-state.test.ts`: every transition of [data model §7](data-model.md#translation-per-item-and-non-source-language)
- [X] T014 [P] Unit tests for the snapshot builder in `packages/domain/test/guides/snapshot.test.ts` (R12): only reviewed items; hidden sections left out; inherited shared blocks resolved from their published snapshot with the block ID; overrides and exclusions respected; locked fields as references and facts as keys; never a value; unreviewed machine translations of reviewed items included
- [X] T015 [P] Unit tests for publish checks in `packages/domain/test/guides/publish-checks.test.ts` (R13, FR-050): left-out items by section; missing essentials; unset locked-field references; code-like text unless kept; off-platform phrases and payment domains in both languages (PC-06); counts of unreviewed and out-of-date translations; blockers `not_ready` and `pending_deletion`
- [X] T016 [P] Unit tests for limits in `packages/domain/test/guides/limits.test.ts`: the daily AI limit is `guide_ai_daily_limit` or `max(100, 50 × property limit)`; the media limit is `media_storage_limit_mb` or 1,024 MB × property limit (FR-064, FR-065)
- [X] T017 [P] Integration test for guide creation in `apps/api/test/integration/guide-creation.test.ts` (R16, FR-001, FR-006): a property created by the blank, listing-text, CSV, and PMS paths gets a guide with the nine sections and the four fact items in one transaction; a property created before the migration gets one from the backfill

### Implementation

- [X] T018 Create the Drizzle schemas `packages/db/src/schema/guides.ts`, `shared-blocks.ts`, `media.ts`, and `interviews.ts`, export them from `packages/db/src/schema/index.ts`, change `properties.ts` (`restricted_value`), `extractions.ts` (`upload`), and `tenancy.ts` (`workspace`), and generate `packages/db/migrations/0018_guide_builder.sql`. Follow [data-model.md](data-model.md) for every column and foreign-key rule. Constraints to carry exactly:
  - `guide`: `property_id` unique; `status` enum `draft`, `published`, `unpublished`; `draft_state` enum `pending`, `drafting`, `ready`, `waiting_limit`, `failed`; `completeness` "smallint 0–100"; `published_version_id` deferrable FK (`ON DELETE SET NULL`);
  - `guide_section`: `kind` enum `arrival`, `wifi`, `house_rules`, `appliances`, `amenities`, `parking`, `local_recommendations`, `emergency`, `checkout`, `custom`; partial unique index on `(guide_id, kind)` where `kind <> 'custom'`; `title` "`{es?, en?}`, each 1–80 characters"; `revision` integer default 0; `status` enum `missing`, `needs_review`, `ready`;
  - `guide_item`: `CHECK` exactly one of `section_id`, `shared_block_id`; `kind` enum `text`, `image`, `video`, `recommendation`, `fact`; `source` enum `host`, `listing`, `pms`, `document`, `interview`, `copy`; `source_detail` "text ≤ 120"; `fact_key` enum `check_in_time`, `checkout_time`, `max_guests`, `address`; `media_id` FK (`ON DELETE RESTRICT`);
  - `guide_item_text`: PK `(item_id, language)`; `origin` enum `source`, `machine`, `reviewed`; `state` enum `current`, `stale`, `out_of_date`, `pending`, `failed`; `pending_reason` enum `ai_limit`, `ai_unavailable`, `tokens_mismatch`;
  - `guide_topic_mark`: PK `(guide_id, topic_id)`; `mark` enum `covered`, `not_applicable`;
  - `guide_version`: unique `(guide_id, number)`; `cause` enum `publish`, `shared_block`, `shared_block_removed`;
  - `shared_block`: `section_kind` default kinds only; `name` "text 1–80"; `status` enum `draft`, `published`;
  - `guide_shared_link`: PK `(guide_id, shared_block_id)`; `mode` enum `override`, `exclude`;
  - `media_object`: `kind` enum `image`, `video`; `status` enum `uploading`, `processing`, `ready`, `rejected`; `video_codec` enum `h264`, `hevc`;
  - `guide_document`: `kind` enum `pdf`, `photo`; `status` enum `checking`, `reading`, `done`, `rejected`; `file_name` "text ≤ 120";
  - `interview_session`: partial unique index, one `active` session per guide; `status` enum `active`, `finished`;
  - `interview_turn`: `answer_kind` enum `text`, `voice`; `answer_text` "text ≤ 2,000"; `follow_up` "text ≤ 300"; `status` enum `queued`, `transcribing`, `drafting`, `done`, `failed`;
  - `guide_ai_request`: `kind` enum `draft_listing`, `interview_answer`, `document`, `translation`; `outcome` enum `ok`, `refused`, `truncated`, `invalid`, `timeout`, `unavailable`;
  - `restricted_value`: `label` "now required, ≤ 80"; `source` adds `host` and `copy`; `value_ciphertext` and `data_key_id` nullable; `public_value` "text ≤ 200, nullable" with the `CHECK` that it and `value_ciphertext` are never both set; `section_kind`; `value_set_at`; `updated_by`;
  - `upload.purpose` adds `document`, `photo`, `media`, `voice`; owners `media_object_id`, `guide_document_id`, `interview_turn_id`;
  - `workspace`: `guide_ai_daily_limit` and `media_storage_limit_mb`, "int, nullable, > 0"
- [X] T019 Write `packages/db/migrations/0019_guide_builder_rls.sql`: RLS enabled and forced on the 13 tables with policies as in 002 (members read, `properties.manage` writes); the `restricted_value_public` view; column grants that keep `value_ciphertext` and `public_value` from agent-facing reads; no `UPDATE` grant on `guide_version`; and the backfill that creates a guide, nine sections, and fact items for every existing property. Make T007 pass and keep `pnpm lint:rls` green
- [X] T020 [P] Implement the content document schema and its plain-text helpers in `packages/contracts/src/guide-document.ts` (R2), with a variant for shared blocks without `lockedField`. Make T008 pass
- [X] T021 [P] Extend the detector in `packages/domain/src/properties/restricted-values.ts` with spelled digits, split digit groups, interview phrasings, and `maskRestrictedValues`/`unmaskRestrictedValues` for reversible masking (R5). Make T009 pass
- [X] T022 [P] Implement `packages/domain/src/guides/template.ts` and `topics.ts`: section kinds, default order, the `GUIDE_TOPICS` list (about 35 topics with weights, keyword families in Spanish and English, and rules), and the essentials set (FR-029). Make T010 pass
- [X] T023 [P] Implement `packages/domain/src/guides/completeness.ts` (R10). Make T011 pass
- [X] T024 [P] Implement `packages/domain/src/guides/segmenter.ts` (R7). Make T012 pass
- [X] T025 [P] Implement `packages/domain/src/guides/translation-state.ts`. Make T013 pass
- [X] T026 [P] Implement `packages/domain/src/guides/snapshot.ts` and `shared.ts` (snapshot builder and shared-block resolution, R12, R14). Make T014 pass
- [X] T027 [P] Implement `packages/domain/src/guides/publish-checks.ts` (R13). Make T015 pass
- [X] T028 [P] Implement `packages/domain/src/guides/limits.ts` and export the guide domain from `packages/domain/src/index.ts`. Make T016 pass
- [X] T029 [P] Add the queues `guide.draft`, `guide.translate`, `interview.answer`, `guide.document`, `media.process`, and `shared-block.publish` with their payload types (IDs only) to `packages/domain/src/jobs.ts`; `guide.translate` is `stately` with a singleton key per section and language (R7)
- [X] T030 [P] Add the security events of [data model §6](data-model.md#6-security-log-retention-and-deletion) to `packages/domain/src/security-events.ts` with their allowlisted fields (R19, FR-066), and extend `packages/domain/test/security-events.test.ts`
- [X] T031 [P] Extend `LlmPort` in `packages/integrations/src/llm/port.ts` with `draftFromListing`, `draftAnswer`, `suggestFromDocument`, and `translateBlocks` and their result types (outcome, items or strings, usage, model). Extend `fake.adapter.ts` with deterministic answers for each call and an input recorder exposed to tests (decision 4)
- [X] T032 [P] Add `SpeechToTextPort` and `FakeSpeechToText` in `packages/integrations/src/speech/` (fixture transcripts keyed by the audio hash, with a default), and export them
- [X] T033 [P] Extend the sandbox protocol in `packages/integrations/src/sandbox/protocol.ts` with the `document`, `media`, and `audio` modes and their responses (text with page counts; media variants with sizes, dimensions, duration, and codec; audio container), and the new error codes (`password_protected`, `too_many_pages`, `too_long`, `unsupported_codec`)
- [X] T034 [P] Extend `ObjectStoragePort` in `packages/integrations/src/storage/` with the media bucket, presigned GET URLs (15 minutes, `inline`, stored type), copy, and object-tag reads; implement it for S3 and the local filesystem; extend `packages/integrations/test/storage.contract.test.ts`
- [X] T035 Implement `GuideLimitsService` in `apps/api/src/guides/guide-limits.service.ts` (daily AI limit in `rate_limit_bucket` per UTC day, media usage sum, both with the workspace overrides) and the `GET /workspaces/{workspaceId}/guide-limits` route; share the AI-limit check with the worker through `packages/domain` rules and a small worker helper in `apps/worker/src/jobs/guide-ai.ts`
- [X] T036 Create guides in every property creation path: add `createGuideForProperty(tx, property)` in `apps/api/src/guides/guide-factory.ts` (nine sections, fact items) and call it from the property service, the CSV import job, and the PMS import job in the same transaction; send `guide.draft` after commit. Make T017 pass
- [X] T037 [P] Add test helpers in `apps/api/test/integration/guide-helpers.ts` (create a guide with items, texts, locked fields, and a published version) and fixture files in `e2e/fixtures/guide/` (synthetic: entrance photo with GPS EXIF, 40-second MP4, MOV with location metadata, text PDF, scanned PDF, encrypted PDF, WebM voice note, renamed archive)
- [X] T038 [P] Add the guide message catalogs to `packages/i18n/messages/es.json` and `en.json`: section names, statuses, source labels, topic names, fact renderings, and locked-field kind names

**Checkpoint**: tables, rules, ports, and limits ready; user stories can start.

---

## Phase 3: User Story 1 - Review the guide draft and edit its sections (Priority: P1) 🎯 MVP

**Goal**: Every property has a draft built from its data, and owners and admins edit it on a
phone with text, images, and videos; agents read only.

**Independent Test**: [quickstart 1 and 2](quickstart.md#validation-scenarios).

### Tests for User Story 1 ⚠️

- [X] T039 [P] [US1] Integration test for the guide API in `apps/api/test/integration/guides.test.ts`: `GET /` returns sections in order with statuses, completeness, and source labels; custom sections (create, rename, reorder, delete, limit 10 → `422 section_limit`); hide a default section; items create, edit, delete, reorder, approve, and section approve; `409 section_changed` with the current section on a stale revision (FR-012); `422 invalid_document` and `422 text_too_long` (FR-010); `benefit_required` (FR-014); agents get `403` on every write and it is logged (AC-SEC-001); completeness updates in the save response (FR-031)
- [X] T040 [P] [US1] Worker test for `guide.draft` in `apps/worker/test/integration/guide-draft.test.ts` (R16, FR-004, FR-026): house rules and amenities placed without an AI call; the description sent to the fake model after the detector (recorder holds no code); items labeled `listing` or the PMS name and unreviewed; imported restricted values linked to Arrival or Wi-Fi; the AI limit sets `waiting_limit`; a refusal or timeout sets `failed` and keeps the deterministic items
- [X] T041 [P] [US1] Contract test for `draftFromListing` in `packages/integrations/test/llm/draft-from-listing.contract.test.ts` with recorded responses: ok, refusal fallback, truncation, invalid output; links not in the input are dropped
- [X] T042 [P] [US1] Sandbox tests for the `media` mode in `apps/sandbox/test/media.test.ts`: a JPEG with GPS EXIF yields WebP variants at 1,600 and 640 px with no metadata (AC-SEC-010); a MOV with location boxes yields a file whose `udta`, `meta`, and XMP `uuid` boxes are zero-filled `free` boxes with every other byte unchanged; duration over 90 seconds is `too_long`; a renamed archive is `unsupported_type`; HEVC is reported as `hevc`
- [X] T043 [P] [US1] Integration test for media in `apps/api/test/integration/guide-media.test.ts` and the worker job in `apps/worker/test/integration/media-process.test.ts`: presigned form with type and size limits (FR-009); `422 storage_limit_reached` at the form and again at processing (FR-065); scan wait honored when `MEDIA_REQUIRE_SCAN=true` (a `THREATS_FOUND` tag rejects as `malware`); images per section ≤ 20 and videos ≤ 3 (`422 item_limit`); presigned GET URLs only for `ready` media
- [X] T044 [P] [US1] Unit tests for the guide renderer in `packages/ui/test/guide-renderer.test.tsx`: every node and mark renders without raw HTML; links get `rel="noopener noreferrer nofollow"`; `lockedField` renders a placeholder with the label
- [X] T045 [P] [US1] End-to-end test `e2e/specs/guide-us1-draft.spec.ts` on a phone viewport (quickstart 1 and 2): draft from listing text, live fact change, edit with text, image, and video, approve, hide, custom section, conflict dialog, pasted script removed, agent read-only

### Implementation for User Story 1

- [X] T046 [US1] Implement the guide read model in `apps/api/src/guides/guide-read.service.ts`: sections, items, texts, media URLs, locked fields masked (agents get `locked: true` only), and inherited shared blocks (resolved through `packages/domain` shared rules; blocks arrive in US7, so the list is empty until then)
- [X] T047 [US1] Implement the section and item services in `apps/api/src/guides/sections.service.ts` and `items.service.ts`: revision checks, limits, document validation and normalization, approval rules, `has_unpublished_changes`, the section status and completeness recompute on every write, and code warnings from the detector (the warning body never includes the value); controller `apps/api/src/guides/guides.controller.ts` with the routes of the contract's "Guide and sections" and "Items" tables except translations and redraft. Make T039 pass
- [X] T048 [US1] Implement `draftFromListing` in `packages/integrations/src/llm/anthropic.adapter.ts` with its prompt and Zod schema in `packages/integrations/src/llm/guide/draft-listing.ts` (R6: `claude-opus-5-5`, effort `medium`, data framing, topic IDs validated, link rule). Make T041 pass
- [X] T049 [US1] Implement the `guide.draft` job in `apps/worker/src/jobs/guide-draft.ts` (R16), recording each AI call in `guide_ai_request`, and the redraft route `POST /sections/{sectionId}/redraft` (FR-007). Make T040 pass
- [X] T050 [US1] Implement the sandbox `media` mode in `apps/sandbox/src/file-processor/media-image.ts` and `media-video.ts` (R9: magic bytes, orientation, `sharp` variants, ISO BMFF box walk and in-place neutralization, duration and codec), wired in `handler.ts`. Make T042 pass
- [X] T051 [US1] Implement the `guide-media` module (`apps/api/src/guide-media/`) and the `media.process` job (`apps/worker/src/jobs/media-process.ts`) with the scan wait, size re-check, and `media_object` states. Make T043 pass
- [X] T052 [P] [US1] Implement the guide renderer in `packages/ui/src/guide-renderer/` (R2). Make T044 pass
- [X] T053 [US1] Build the draft review page (H-12) in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/page.tsx` with `apps/portal/components/guide/`: section cards with status, completeness, and source labels; "Drafting from your listing…" while `draft_state` is `drafting`; empty, error, and agent read-only states
- [X] T054 [US1] Build the section editor (H-13) in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/sections/[sectionId]/page.tsx`: item cards; Tiptap loaded with `next/dynamic` (R3) and only the R2 extensions; mobile toolbar; recommendation form with the benefit question (FR-014); approve per item and per section; hide, rename, reorder, add and delete custom sections; the conflict dialog for `409 section_changed`
- [X] T055 [US1] Add autosave and offline drafts in `apps/portal/lib/guide/autosave.ts`: 1-second debounce, per-item `localStorage` copies, resend on reconnect, and offline notices that disable uploads (FR-011, FR-070)
- [X] T056 [US1] Build media upload in `apps/portal/components/guide/media-upload.tsx`: image normalization reused from `apps/portal/lib/image-normalize.ts`, direct upload with progress, processing and rejected states, storage usage, and the HEVC note
- [X] T057 [US1] Show the guide status and completeness on the property list (`apps/portal/components/properties/property-list.tsx`) and link "Build the guide" from the property page; add the guide routes to `apps/portal/bundle-budget.json` and the editor chunk entry (≤ 130 KB gzip, revised from 120 KB after measuring)
- [X] T058 [US1] Seed `evals/guide` drafting cases from the 30 synthetic listings in `evals/extraction/cases/listings/` with expected section placements and injection cases, and implement the drafting scorer (placement ≥ 90%, invented facts 0) in `evals/guide/src/score.ts` (SC-002)
- [X] T059 [US1] Make T045 pass; record any deviation in this file's Implementation notes

**Checkpoint**: US1 works on its own: a draft exists for every property and can be edited.

---

## Phase 4: User Story 2 - Keep door codes and the Wi-Fi password in locked fields (Priority: P1)

**Goal**: Codes live in locked fields: encrypted, masked, revealed only after step-up, referenced
from text, and never sent to the AI.

**Independent Test**: [quickstart 3](quickstart.md#3-locked-fields-us2-ac-sec-002-ac-sec-003).

### Tests for User Story 2 ⚠️

- [X] T060 [P] [US2] Integration test for locked fields in `apps/api/test/integration/locked-fields.test.ts`: add, change, delete, and reveal need step-up within 10 minutes and MFA above the threshold (AC-SEC-002); values ≤ 200 characters; no response except reveal carries a value (AC-SEC-006); reveal answers `no-store` and logs `restricted_value.revealed`; the 21st reveal in an hour is `429 reveal_limit_reached`, logs `reveal_limited`, and queues one `guides.reveal_limit` email to owners (FR-018, AC-SEC-003); `PUT visibility` works only for `wifi_password` (`422 wifi_only`) and moves the value between ciphertext and `public_value`; deleting a referenced field needs `confirm=true` (FR-024); agents get only `locked: true`, `403` on writes, and `404` on reveals and history; reveal history for owners and admins
- [X] T061 [P] [US2] Integration test for code warnings in `apps/api/test/integration/guide-code-warnings.test.ts` (FR-023): saving "door code 4821" returns a warning without the value; `keepCodeWarning` stores the hash and silences the same text; "Move to a locked field" creates the field and replaces the text with a `lockedField` node in one request
- [X] T062 [P] [US2] Unit test in `apps/api/test/unit/reveal-service.test.ts`: the decrypted buffer is zeroed after the response is built, and errors carry no value
- [X] T063 [P] [US2] Email template test in `packages/emails/test/guides.test.tsx`: `guides.reveal_limit` in Spanish and English contains no value or code and links only to the portal origin
- [X] T064 [P] [US2] End-to-end test `e2e/specs/guide-us2-locked.spec.ts` (quickstart 3)

### Implementation for User Story 2

- [X] T065 [US2] Implement the `locked-fields` module (`apps/api/src/locked-fields/`): controller, service (encrypt with the vault, labels, section kind, re-import rule of FR-022), `reveal.service.ts` (the only API decrypt, R4), visibility, history from the security log, and the per-member reveal limit with the owners' email through the outbox. Make T060 and T062 pass
- [X] T066 [US2] Add the `guides.reveal_limit` template in `packages/emails/src/guides/reveal-limit.tsx` with Spanish and English strings. Make T063 pass
- [X] T067 [US2] Add code warnings and "Move to a locked field" to the item service and contract (`POST /items/{itemId}/move-to-locked-field`, recorded in the contract). Make T061 pass
- [X] T068 [US2] Build the locked fields screen (H-18) in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/locked-fields/page.tsx`: masked inputs, "set by … on …", reveal with the step-up dialog from spec 001 and a 60-second hide, the public Wi-Fi switch with its warning, reveal history, and agent view
- [X] T069 [US2] Add the `lockedField` inline node and the "Insert locked field" picker to the editor (`apps/portal/components/guide/editor/locked-field-node.ts`), and the code warning banner with "Move to a locked field" and "Keep as text"
- [X] T070 [US2] Make T064 pass

**Checkpoint**: US1 and US2 work; codes are safe in the guide.

---

## Phase 5: User Story 3 - Publish the guide and keep editing safely (Priority: P1)

**Goal**: Explicit, versioned publishing; drafts never change what guests read.

**Independent Test**: [quickstart 4](quickstart.md#4-publish-edit-restore-us3-sc-009).

### Tests for User Story 3 ⚠️

- [X] T071 [P] [US3] Integration test for publishing in `apps/api/test/integration/guide-publish.test.ts`: `409 not_ready_to_publish` before the core facts are confirmed and in a workspace pending deletion (FR-049); the publish check lists left-out items and every warning kind (FR-050); publishing creates version N with only reviewed items and no locked value or `public_value` anywhere in the snapshot (SC-004); a draft edit after publishing leaves the version and `published_version_id` unchanged and sets `has_unpublished_changes` (SC-009); a stale `expectedRevisionHash` is `409`; restore replaces the draft without publishing; unpublish; versions beyond 20 are not listed; every action logs its event; agents get `403`
- [X] T072 [P] [US3] Integration test for the preview in `apps/api/test/integration/guide-preview.test.ts`: draft, published, and numbered previews per language with locked fields as placeholders and facts resolved from the property (FR-054)
- [X] T073 [P] [US3] Performance test in `apps/api/test/integration/guide-publish.perf.test.ts`: publishing a 50-item guide takes ≤ 1 second at p95 over 20 runs
- [X] T074 [P] [US3] End-to-end test `e2e/specs/guide-us3-publish.spec.ts` (quickstart 4)

### Implementation for User Story 3

- [X] T075 [US3] Implement `apps/api/src/guides/publish.service.ts`: publish check, publish (snapshot builder from the domain, version insert, `published_version_id`, status), unpublish, versions list and view, restore; routes in the guides controller. Make T071 and T073 pass
- [X] T076 [US3] Implement the preview route in `apps/api/src/guides/preview.service.ts`. Make T072 pass
- [X] T077 [US3] Build the publish dialog (left-out items with Review and Approve, warnings, confirm), the "Published · unpublished changes" status, the versions page with view and restore, unpublish, and the preview page using `packages/ui` guide renderer with a language switch, in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/`
- [X] T078 [US3] Make T074 pass

**Checkpoint**: the MVP slice (US1–US3) is complete: a host can build, protect, and publish a
guide.

---

## Phase 6: User Story 4 - Fill the gaps with the completeness score and the AI interview (Priority: P2)

**Goal**: The score shows what guests ask about most; the interview fills it by text or voice.

**Independent Test**: [quickstart 5](quickstart.md#5-completeness-and-interview-us4-ac-sec-004).

### Tests for User Story 4 ⚠️

- [X] T079 [P] [US4] Integration test for completeness in `apps/api/test/integration/guide-completeness.test.ts`: `GET /completeness` orders missing topics by weight; `PUT /topics/{topicId}` marks stay until removed (FR-032); the score keeps working when the AI limit is used (FR-031)
- [X] T080 [P] [US4] Integration test for the interview API in `apps/api/test/integration/interviews.test.ts`: one active session per guide (`409 interview_active`); the first question is the heaviest missing topic; code topics return `opensLockedField` (FR-038); text answers ≤ 2,000 characters; voice forms only with `GUIDE_INTERVIEW_VOICE`; skip and finish; resume returns the next question (FR-035); the AI limit refuses with no call; agents read only
- [X] T081 [P] [US4] Worker test for `interview.answer` in `apps/worker/test/integration/interview-answer.test.ts`: text and voice (fake speech) paths; "the door code is 4821" in the transcript and in a typed answer never reaches the fake model's recorder, and the turn reports the redaction (AC-SEC-004); the voice file is deleted after transcription (FR-037); items labeled `interview`, unreviewed, in the right section, in the main language; a follow-up question is stored; `not_understood` and `transcription_failed` keep the question open; timing within 15 and 30 seconds with simulated latency (FR-036)
- [X] T082 [P] [US4] Contract tests: `draftAnswer` in `packages/integrations/test/llm/draft-answer.contract.test.ts` (recorded responses), and the Transcribe adapter in `packages/integrations/test/speech/transcribe.contract.test.ts` (start, poll, result, language identification limited to `es-US` and `en-US`, failure, delete)
- [X] T083 [P] [US4] Sandbox test for the `audio` mode in `apps/sandbox/test/audio.test.ts`: WebM, Ogg, MP4, and M4A accepted by magic bytes; anything else `unsupported_type`
- [X] T084 [P] [US4] End-to-end test `e2e/specs/guide-us4-interview.spec.ts` (quickstart 5), with the fake model and fake speech, recording a voice note through a fixture media stream

### Implementation for User Story 4

- [X] T085 [US4] Implement the completeness route and topic marks in `apps/api/src/guides/completeness.controller.ts`. Make T079 pass
- [X] T086 [US4] Implement `draftAnswer` in the Anthropic adapter with its prompt and schema in `packages/integrations/src/llm/guide/draft-answer.ts` (R6, R11)
- [X] T087 [US4] Implement the Transcribe adapter in `packages/integrations/src/speech/transcribe.adapter.ts` (R8: batch job, language identification, output under `transcripts/`, read, delete job and output). Make T082 pass
- [X] T088 [US4] Implement the sandbox `audio` mode in `apps/sandbox/src/file-processor/audio.ts`. Make T083 pass
- [X] T089 [US4] Implement the `interviews` module (`apps/api/src/interviews/`) and the `interview.answer` job (`apps/worker/src/jobs/interview-answer.ts`), with questions from the catalog and turns stored as in the data model. Make T080 and T081 pass
- [X] T090 [US4] Add the interview questions for every topic in Spanish and English to the message catalogs
- [X] T091 [US4] Build the completeness panel on the review page (score, missing topics, "Answer in the interview", "Edit section", marks) and the interview screen (H-14) with one question at a time, the target section, text input, the voice recorder (`apps/portal/components/guide/voice-recorder.tsx`, `MediaRecorder`, 2-minute stop, upload), "Transcribing…", transcript next to the drafted text, skip, finish, the "type instead" error, and the reminder to keep codes out (FR-028)
- [X] T092 [US4] Add the interview suite to `evals/guide` (40 synthetic answers, half as transcripts, plus injection cases) with the scorer for section placement ≥ 90%, invented facts 0, and no code in outputs (SC-003)
- [X] T093 [US4] Make T084 pass

**Checkpoint**: hosts can fill gaps on a phone, by text or voice.

---

## Phase 7: User Story 5 - Offer the guide in Spanish and English (Priority: P2)

**Goal**: Every section is translated within 2 minutes and tracked as machine, reviewed, out of
date, pending, or failed.

**Independent Test**: [quickstart 6](quickstart.md#6-translation-us5).

### Tests for User Story 5 ⚠️

- [X] T094 [P] [US5] Worker test for `guide.translate` in `apps/worker/test/integration/guide-translate.test.ts`: one call per section and language for every stale item; tokens kept; a mismatch retried once then `failed` with `tokens_mismatch`; masked codes restored unchanged and absent from the recorder (FR-025); the AI limit sets `pending` with `ai_limit`; reviewed texts never overwritten; single-language guides make no call (US5 scenario 6); with simulated model latency, 90% of sections are translated within 2 minutes of the last save (SC-005)
- [X] T095 [P] [US5] Integration test for translation actions and triggers in `apps/api/test/integration/guide-translations.test.ts`: a source edit marks machine texts `stale` and reviewed ones `out_of_date` and schedules one debounced job; `translate_again`, `keep`, and `mark_reviewed`; editing a translation makes it `reviewed`; adding a guide language translates every section and removing one drops it from the draft but not from the published version (FR-048)
- [X] T096 [P] [US5] Contract test for `translateBlocks` in `packages/integrations/test/llm/translate-blocks.contract.test.ts` (recorded responses, count mismatch detected)
- [X] T097 [P] [US5] End-to-end test `e2e/specs/guide-us5-translation.spec.ts` (quickstart 6)

### Implementation for User Story 5

- [X] T098 [US5] Implement `translateBlocks` in the Anthropic adapter with its prompt in `packages/integrations/src/llm/guide/translate-blocks.ts` (R6, effort `low`). Make T096 pass
- [X] T099 [US5] Implement the `guide.translate` job in `apps/worker/src/jobs/guide-translate.ts` (R7) and the scheduling on saves in the item service (20-second `startAfter`, singleton per section and language). Make T094 pass
- [X] T100 [US5] Implement the translation action route and the guide-language change hook in the property service. Make T095 pass
- [X] T101 [US5] Build the translations screen (H-19) in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/translations/page.tsx`: side by side per section, status badges, edit, mark reviewed, translate again, keep as is, pending and failed reasons
- [X] T102 [US5] Add the translation suite to `evals/guide` (30 items with formatting, links, and locked-field tokens) with the token and content scorer
- [X] T103 [US5] Make T097 pass

**Checkpoint**: guides are bilingual with tracked translations.

---

## Phase 8: User Story 6 - Learn from my manuals and photos (Priority: P3)

**Goal**: PDFs and photos become suggested section content; files are deleted after reading.

**Independent Test**: [quickstart 7](quickstart.md#7-uploads-us6-ac-sec-005-ac-sec-009).

### Tests for User Story 6 ⚠️

- [X] T104 [P] [US6] Sandbox tests for the `document` mode in `apps/sandbox/test/document.test.ts`: text PDF read per page; more than 60 pages `too_many_pages`; encrypted PDF `password_protected`; a scanned PDF read by recognition only with the flag; a renamed archive `unsupported_type` (AC-SEC-009)
- [X] T105 [P] [US6] Worker and API tests in `apps/worker/test/integration/guide-document.test.ts` and `apps/api/test/integration/guide-documents.test.ts`: up to 10 files (FR-039); scan wait; text after the detector stored and sent to the fake model, with no code in the recorder and no image ever sent (AC-SEC-005); suggestions as unreviewed `document` items labeled with the file name; accept, edit, discard; `nothing_found`; the file deleted after reading; "ignore previous instructions…" treated as text (AC-SEC-007); the AI limit
- [X] T106 [P] [US6] Contract test for `suggestFromDocument` in `packages/integrations/test/llm/suggest-from-document.contract.test.ts`
- [X] T107 [P] [US6] End-to-end test `e2e/specs/guide-us6-uploads.spec.ts` (quickstart 7)

### Implementation for User Story 6

- [X] T108 [US6] Implement the sandbox `document` mode in `apps/sandbox/src/file-processor/pdf.ts` (R9: `pdfjs-dist`, encryption detection, page limits, scanned pages rendered with `@napi-rs/canvas` and read with the existing recognizer behind the flag; only text leaves the sandbox, never an image, FR-042). Make T104 pass
- [X] T109 [US6] Implement `suggestFromDocument` in the Anthropic adapter (`packages/integrations/src/llm/guide/suggest-document.ts`), the `guide-documents` module, and the `guide.document` job (`apps/worker/src/jobs/guide-document.ts`). Make T105 and T106 pass
- [X] T110 [US6] Build the uploads screen (H-15) in `apps/portal/app/[locale]/(app)/properties/[propertyId]/guide/uploads/page.tsx`: pick or take photos, per-file status, what was learned, links to suggestions with accept, edit, and discard, "add this photo to a section", and the reminder to keep codes out (FR-028)
- [X] T111 [US6] Make T107 pass

**Checkpoint**: manuals and photos speed up the appliance and access sections.

---

## Phase 9: User Story 7 - Share content across my properties (Priority: P3)

**Goal**: Workspace blocks inherited by every property, overridable or excludable, and published
to every inheriting guide at once.

**Independent Test**: [quickstart 8](quickstart.md#8-shared-content-us7-sc-007).

### Tests for User Story 7 ⚠️

- [X] T112 [P] [US7] Integration test for shared blocks in `apps/api/test/integration/shared-blocks.test.ts` and the job in `apps/worker/test/integration/shared-block-publish.test.ts`: create, edit, publish, delete; limit 50 (`422 shared_block_limit`); `lockedField` nodes refused; inherited blocks appear in drafts once published, marked shared; override copies items and records the revision; "The shared version changed"; exclude and reset; publishing writes a new version for every inheriting published guide from its previous snapshot, never publishing a draft edit (FR-060); overriding and excluding guides unchanged; delete removes the block from published versions; cross-tenant `404`; agents read only
- [X] T113 [P] [US7] Performance test in `apps/worker/test/integration/shared-block-publish.perf.test.ts`: a block published in a workspace with 50 published guides is live in all within 1 minute (SC-007)
- [X] T114 [P] [US7] End-to-end test `e2e/specs/guide-us7-shared.spec.ts` (quickstart 8)

### Implementation for User Story 7

- [X] T115 [US7] Implement the `shared-blocks` module (`apps/api/src/shared-blocks/`), the per-property override, exclude, and reset routes, the `shared-block.publish` job (`apps/worker/src/jobs/shared-block-publish.ts`), and the shared-block resolution in the guide read model and the completeness computation. Make T112 and T113 pass
- [X] T116 [US7] Build the shared content screen (H-29) in `apps/portal/app/[locale]/(app)/shared-content/` (blocks by section, editor reuse, publish, inherit/override/exclude counts and list) and the "Shared" marker with "Override for this property", "Exclude", "Reset to shared", and "The shared version changed" in the section editor
- [X] T117 [US7] Make T114 pass

**Checkpoint**: every user story works on its own.

---

## Phase 10: Polish & Cross-Cutting Concerns

- [X] T118 Production gates (founder): record each gate of [research R22](research.md#r22-rollout-flags-and-production-gates) and its status in research.md; flags stay off in production until they close
- [X] T119 [P] Duplicate and remove (FR-067, FR-068): extend `apps/api/test/integration/property-lifecycle.test.ts` and `apps/worker/test/purge-jobs.test.ts` first, then copy the guide on duplication (sections, items labeled `copy`, media objects copied to new keys, links, locked fields with labels and no values) in the property service, and delete guide data, media, and locked fields in `apps/worker/src/jobs/purge-properties.ts`
- [X] T120 [P] Retention (data model §6): extend `apps/worker/test/integration/retention.test.ts` first, then add the voice, document, transcript, answer, document-text, version (beyond 20), unreferenced media (24 hours), and AI-request (12 months) rules to `apps/worker/src/jobs/retention.ts`
- [X] T121 [P] Security review: `apps/api/test/integration/security-review-003.test.ts` covering AC-SEC-001 to AC-SEC-013 end to end, including a log and span capture that searches for every code used in the tests (SC-004), and an extension of `apps/api/test/integration/cross-tenant.test.ts` to every guide route (AC-SEC-011)
- [X] T122 [P] Performance: `perf/k6/guides.js` (guide read, item save, approve, topic mark, publish check; p95 ≤ 300 ms); add the guide pages to `lighthouserc.json`; confirm the bundle check covers the guide routes and the editor chunk
- [X] T123 [P] Accessibility: extend `e2e/specs/a11y.spec.ts` to the guide screens (review, editor, locked fields, interview, uploads, translations, publish, shared content)
- [X] T124 [P] Documentation (R21): the public Wi-Fi note in `docs/architecture/security.md` §1 and the reveal service in SEC-06; Amazon Transcribe and the media bucket in ADR-0009's service table; the subprocessor note; UX gaps 4, 5, and 8 marked resolved in `docs/ux/README.md`; the repository layout in `docs/architecture/overview.md` §8
- [X] T125 Run the [quickstart](quickstart.md) locally end to end and record the results in this file's Implementation notes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1):** no dependencies.
- **Foundational (Phase 2):** depends on Setup; blocks every story.
- **US1 (Phase 3):** depends on Foundational. It is the base for the others: the read model,
  item service, editor, and renderer.
- **US2 (Phase 4)** and **US3 (Phase 5):** depend on US1. They can run in parallel with each
  other.
- **US4, US5, US6 (Phases 6–8):** depend on US1; US4's locked-field topics use US2's form. They
  can run in parallel with each other.
- **US7 (Phase 9):** depends on US1 and US3 (fan-out writes versions).
- **Polish (Phase 10):** after the stories it touches.

### Within Each User Story

- Tests first, failing; then the domain or adapter code, services, routes, jobs, and screens; the
  end-to-end test last.

### Parallel Opportunities

- Phase 2 tests T007–T017 and the domain implementations T020–T034 are independent files.
- US2 and US3 in parallel after US1; US4, US5, and US6 in parallel after US1 (and US2 for US4's
  lockbox topic).

## Parallel Example: Foundational

```bash
Task: "Unit tests for coverage and completeness in packages/domain/test/guides/completeness.test.ts"
Task: "Unit tests for the segmenter in packages/domain/test/guides/segmenter.test.ts"
Task: "Unit tests for the snapshot builder in packages/domain/test/guides/snapshot.test.ts"
Task: "Unit tests for publish checks in packages/domain/test/guides/publish-checks.test.ts"
```

## Implementation Strategy

### MVP First (US1 → US3)

1. Setup and Foundational.
2. US1: draft and editor. Validate with quickstart 1 and 2.
3. US2: locked fields. Validate with quickstart 3.
4. US3: publishing. Validate with quickstart 4. This is the smallest guide a host can publish.

### Incremental Delivery

5. US4 interview and US5 translation (both P2), then US6 uploads and US7 shared content (P3),
   each validated with its quickstart scenario and committed when green.
6. Polish, the security review, and the quickstart run.

## Implementation notes

_Recorded during implementation._

### Foundations and US1 (2026-11-17)

- **One schema file.** The 13 tables live in `packages/db/src/schema/guides.ts` instead of four
  files: items, media, documents, and interview turns reference each other, and one module avoids
  an ESM import cycle. `GUIDE_LANGUAGES` moved to `enums.ts` for the same reason.
- **The guide factory is shared.** `createGuideForProperty` is in `packages/db` (not the API), so
  the API and the worker's CSV and PMS imports create guides in their own transactions (T036).
  Imports do not queue `guide.draft`: the AI part of the draft runs the first time a manager opens
  the guide, so a 40-property import spends no AI budget up front (R16). The API queues it at
  once for properties created one by one.
- **Conflicts carry the revision, not the section.** Problem bodies hold plain values only, so
  `409 section_changed` returns `{revision}` and the portal reloads the guide (FR-012).
- **Fixtures.** The GPS-tagged JPEG lives in `apps/sandbox/test/fixtures/media/` and is shared with
  the worker and end-to-end tests; synthetic MP4 and MOV files are built in the tests (T037). Test
  helpers stayed in each test file.
- **Media signing locally.** Local media URLs are signed with a secret derived from
  `FEED_URL_PEPPER`, so the API and the worker sign alike without another setting; a
  development-only route serves them with `nosniff` and a sandboxing CSP.
- **Editor budget.** The Tiptap chunk measured 123.7 KB gzip; the budget is 130 KB (plan updated).
  The section editor route is 148.6 KB, under the 150 KB route budget.
- **`@aws-sdk/s3-request-presigner`** was added for presigned GET URLs (part of the plan's S3
  decision in R9).
- **Locked-field node location (T069).** The `lockedField` node lives in
  `apps/portal/components/guide/text-item-editor.tsx` with the rest of the editor, so it stays in
  the on-demand chunk; the "Insert locked field" picker is a toolbar select fed by the guide's
  locked fields.
- **Step-up dialog on demand.** `useStepUp` loads the step-up dialog only when the API answers
  `step_up_required`; the section editor route is 149.2 KB with the move action. US3 to US7 must
  keep new section-editor code in on-demand chunks.
- **Code-warning tests (T061)** live in `guides.test.ts` (warning and `keepCodeWarning`) and
  `locked-fields.test.ts` (move to a locked field) instead of a separate file.
- **Publishing (US3).** The revision hash is the SHA-256 of the draft snapshot with sorted keys,
  so a stored jsonb copy hashes alike; a repeated publish of identical content returns the current
  version. Unpublishing clears `published_version_id`. `GET /versions/{number}` answers in the
  preview's shape. Restore hides default sections the version did not show and removes custom
  ones. Publish p95 for 50 items measured 33 ms locally. The section editor route is 149.6 KB.
- **Interview (US4).** `draftAnswer` and its prompt landed with the foundations (T026), so T086
  is covered by `anthropic.adapter.ts` and `llm/guide/prompts.ts`; the catalog questions (T090)
  landed with US1. Typed answers pass the detector in the API before they are stored; transcripts
  pass it in the worker. The API takes the request from the daily AI limit, so the job does not.
  The worker and the eval runner read the catalog questions from `@guidesk/i18n`. A voice note
  that passes the sandbox `audio` check stays in the uploads bucket for Transcribe and is deleted
  by the worker right after transcription. Starting an interview twice at once (React runs effects
  twice in development) returns one session.
- **Microphone policy.** The portal's `Permissions-Policy` blocks the microphone everywhere except
  the interview page, and links to the interview load the page fully so its policy applies. The
  end-to-end test records from a Web Audio fixture stream, because headless Chromium on macOS
  waits on the system microphone prompt.
- **Translation (US5).** `translateBlocks` landed with the foundations (T026); the adapter now
  answers `invalid` when the number of blocks differs. Saves schedule one job per section and
  language 20 seconds later (pg-boss `stately`, singleton key `section:language`); a sweep every
  minute (`guide.translate-sweep`) picks up texts nothing scheduled, such as drafts from the worker,
  restored versions, and added guide languages, and retries `pending` texts after 10 minutes.
  Empty texts schedule nothing. Removing a guide language keeps texts written in that language as
  their item's source.
- **Documents (US6).** `suggestFromDocument` landed with the foundations (T026), and its contract
  test lives in `guide.contract.test.ts`. The sandbox reads PDFs with `pdfjs-dist` 6 (no eval, no
  fonts, no XFA) and renders scanned pages with `@napi-rs/canvas` only when
  `GUIDE_SCANNED_PDF=true` (the Lambda has it `false` until the R22 gate). The reading takes one
  request from the daily AI limit only when it reaches the model; a refused one ends `rejected`
  with `ai_limit`. Photos that the browser cannot open never upload. A photo read in this visit can
  be added to a section as an image through the media flow.
- **Shared content (US7).** Override copies are marked with `guide_item.copied_from_block_id`
  (migration 0020), so "Reset to shared" removes exactly those copies. The fan-out compares
  snapshots with `canonicalJson` (sorted keys), the same serialization the publish hash uses,
  because `jsonb` reorders keys. The 50-guide performance check (T113) lives in
  `shared-block-publish.test.ts` and measured under 0.1 seconds locally. Blocks are kept in both
  languages and translated by the same job as sections. The guide view lists the workspace's
  published blocks with this guide's mode and whether an override is behind.
- **Performance and accessibility (T122, T123).** `perf/k6/guides.js` covers the guide read, an
  item save, an approval, a topic mark, and the publish check (p95 ≤ 300 ms); guide pages need a
  signed-in session, so Lighthouse CI adds the shared content page, and the bundle check covers
  every guide route and the editor chunk. axe finds no WCAG 2.2 A/AA violations on the guide review,
  publish dialog, section editor, locked fields, interview, uploads, translations, versions,
  preview, and shared content screens.
- **Duplicate, remove, retention (T119, T120).** Duplicating a property copies its guide in the
  same request (sections, custom sections, hidden flags, items as unreviewed `copy` items labeled
  with the original's name, shared-block links, and locked fields with labels and no values, with
  every `lockedField` reference remapped); media is copied to new keys by a new `media.copy` job,
  and the copy gets no `guide.draft`. Purging a property removes its guide by cascade; its media
  becomes unused and `retention.daily` deletes it a day later, with the other feature 003 rules
  (interview content and document text after 7 days, versions beyond 20 except the current one, AI
  rows after 12 months).
- **Security review (T121).** `security-review-003.test.ts` runs the API-owned criteria in one
  guide and searches every captured log line, response, and security-log row for the codes used;
  `cross-tenant.test.ts` covers 31 feature 003 routes. A code the host keeps as text in the editor
  comes back to the host by design (FR-023) but never reaches a log.
- **Quickstart run (T125), 2026-11-17, locally with the fake model and fake speech:** scenarios 1
  to 8 pass as the end-to-end specs `guide-us1` to `guide-us7` (with `GUIDE_INTERVIEW_VOICE=true`
  for the voice note), scenario 9 as `property-lifecycle.test.ts` and `purge-properties.test.ts`,
  and scenario 10 as `cross-tenant.test.ts` and `security-review-003.test.ts`; axe passes on every
  guide screen. Run the end-to-end specs with `--workers=1`: in parallel they reach the limit of
  20 sign-in codes per hour per IP. The scanned-PDF step needs `GUIDE_SCANNED_PDF=true` and is
  covered by the sandbox test. The real-model eval run and the staging run stay open (R22).
