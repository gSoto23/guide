---

description: "Task list for feature 002: property onboarding"
---

# Tasks: Property Onboarding

**Input**: Design documents from `/specs/002-property-onboarding/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. The constitution (Principle V) mandates test-first. Within each story, test
tasks come first and must fail before the implementation tasks start. The extraction eval suite
(research R6) is part of User Story 2.

**Organization**: Tasks are grouped by user story, so each story can be implemented and tested
on its own.

> **Production gates (not development gates):** written confirmation from Beds24 and Hostex
> (OQ-26, flags `PMS_BEDS24` and `PMS_HOSTEX`); the text-recognition accuracy check (R3, flag
> `EXTRACTION_SCREENSHOTS`); real Booking.com and Vrbo iCal fixtures (R8); and the GuardDuty plan
> on the uploads bucket (R9). See T129.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US6)
- Include exact file paths in descriptions

## Path Conventions

This is the monorepo from feature 001 (see [plan.md](plan.md#project-structure)):

- `apps/portal`, `apps/api`, `apps/worker`, and the new `apps/sandbox`
- `packages/*`, including the new `packages/vault`
- `evals/extraction` (new)
- `infra/` (SST), `e2e/` (Playwright), `perf/k6/`

Conventions that apply to every task:

- New API modules are registered in `apps/api/src/app.module.ts`, and new jobs in
  `apps/worker/src/main.ts`.
- Every creating `POST` accepts `Idempotency-Key` through the existing
  `apps/api/src/common/idempotency.interceptor.ts`.
- Writes check the capability in code (`properties.manage` or `integrations.manage`) and again
  through RLS. Refusals are logged as `access.role_denied`.
- Restricted values (feed links, PMS credentials, imported codes) never appear in a response, a
  log line, a span attribute, an error report, or an email.
- Test data committed to the public repository is synthetic: no copied listing text, real
  addresses, host or guest names, or real codes. Recordings from provider test accounts are
  scrubbed the same way before commit.

## Decisions made while writing these tasks

These refine the plan without adding scope. The contract and research were updated to match.

1. **All 11 tables and their RLS land in the Foundational phase**, in two migrations. Foreign
   keys cross stories (property and stay to PMS connection and feed; listing content and upload
   to extraction request and import run), and a single cross-tenant suite then covers every
   table. The stories add behavior, not tables.
2. **The API never decrypts (R5).** Two contract routes need a stored credential: listing PMS
   listings again, and revoking a Beds24 token on disconnect. For these, the API sends a worker
   job and waits up to 15 seconds for its output (`JobQueueService.call`).
3. **A URL-only extraction makes no AI call and does not count toward the daily limit.**
4. **The CSV template carries its instructions** as leading lines that start with `#`. The
   parser skips them.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: New packages, dependencies, configuration, infrastructure, and CI.

- [X] T001 Add `evals/*` to the packages in `pnpm-workspace.yaml`. Record an `allowBuilds` decision for each new dependency that requests an install script (SEC-12)
- [X] T002 [P] Scaffold `apps/sandbox` (package `@guidesk/sandbox`):
  - `package.json`, `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`;
  - empty handlers `src/feed-reader/handler.ts` and `src/file-processor/handler.ts`;
  - dependencies `undici`, `ipaddr.js`, `ical.js`, `sharp`, `tesseract.js`, `csv-parse`;
  - an ESLint `no-restricted-imports` rule that forbids `@guidesk/db`, `pg`, `pg-boss`, and `@guidesk/vault`. The sandbox never reaches the database (R2);
  - `src/observability.ts` (constitution VIII, R13): structured JSON logs with the request ID, error code, and duration only, and Sentry with the existing `beforeSend` allowlist. Inputs and outputs are never logged. Test it in `apps/sandbox/test/observability.test.ts`: an error raised while handling a feed link and recognized text leaves neither in the log line or the Sentry event
- [X] T003 [P] Scaffold `packages/vault` (`@guidesk/vault`) with two entry points in `package.json` `exports`:
  - `@guidesk/vault` for data keys and encryption;
  - `@guidesk/vault/decrypt` for decryption only (R5)
- [X] T004 [P] Scaffold `evals/extraction` (`@guidesk/evals-extraction`): `package.json`, `tsconfig.json`, the `cases/` folder, and a placeholder `src/run.ts`
- [X] T005 [P] Add dependencies:
  - to `packages/integrations/package.json`: `@anthropic-ai/sdk`, `@aws-sdk/client-kms`, `@aws-sdk/client-s3`, `@aws-sdk/s3-presigned-post`, and `@aws-sdk/client-lambda`;
  - to `apps/api/package.json`: `csv-stringify`.

  Pin exact versions that respect the 3-day minimum release age
- [X] T006 Extend the configuration schemas in `apps/api/src/config/config.ts` and `apps/worker/src/config.ts`, and list the names (never values) in `.env.example`:
  - keys: `KMS_MODE` (`aws|local`), `KMS_KEY_ID`, and `LOCAL_KMS_KEY` (32 bytes, base64);
  - storage: `STORAGE_MODE` (`s3|local`), `UPLOADS_BUCKET`, and `LOCAL_STORAGE_DIR`;
  - sandbox: `SANDBOX_MODE` (`lambda|in-process`), `SANDBOX_FEED_READER_FUNCTION`, `SANDBOX_FILE_PROCESSOR_FUNCTION`, `SANDBOX_TEST_ALLOW_HOST`, and `SANDBOX_TEST_CA_FILE`;
  - AI: `LLM_MODE` (`anthropic|fake`) and `ANTHROPIC_API_KEY`;
  - PMS: `PMS_MODE` (`live|fixtures`);
  - `FEED_URL_PEPPER`, at least 32 characters;
  - flags `PMS_BEDS24`, `PMS_HOSTEX`, and `EXTRACTION_SCREENSHOTS`: booleans, default `false`.

  Production refuses `KMS_MODE=local`, `STORAGE_MODE=local`, `SANDBOX_MODE=in-process`, `LLM_MODE=fake`, `PMS_MODE=fixtures`, and any `SANDBOX_TEST_*` value (R2). Add unit tests in `apps/api/test/unit/config.test.ts` and `apps/worker/test/config.test.ts`
- [X] T007 [P] Add the infrastructure in SST (ADR-0009):
  - `infra/keys.ts`: one customer-managed KMS key for restricted data, with yearly rotation. The key policy allows `GenerateDataKey` and `Decrypt` only to the API and worker task roles, and only with the `workspace_id` encryption-context key (`kms:EncryptionContextKeys` with `ForAnyValue:StringEquals`) (R5);
  - `infra/storage.ts`: the private uploads bucket:
    - SSE-KMS, public access blocked, and CORS for the portal origin only;
    - a lifecycle rule that deletes objects after 1 day;
    - GuardDuty Malware Protection for S3 with object tagging, with `THREATS_FOUND` routed to the operations alert topic (R9);
  - `infra/sandbox.ts`: the Lambda functions `feed-reader` and `file-processor`, both outside the VPC, on Node.js 24 (R2):
    - `feed-reader`'s role has no permissions;
    - `file-processor`'s role allows only `s3:GetObject` and `s3:DeleteObject` on `uploads/*`;
    - `sharp` is installed for the Lambda architecture;
    - the Tesseract Spanish and English language files are bundled, so nothing is downloaded at runtime (R3);
    - the Sentry DSN is passed to both functions;
  - `infra/secrets.ts`: `AnthropicApiKey` and `FeedUrlPepper`;
  - `infra/services.ts`: link the key, the bucket, the functions, and the secrets to the API and worker, and grant `lambda:InvokeFunction` on the two functions
- [X] T008 [P] Extend `.github/workflows/ci.yml`:
  - build, lint, and test `apps/sandbox` and `packages/vault`;
  - run the time zone data check from T038;
  - add an `evals-extraction` job. It runs on every pull request with the `ANTHROPIC_API_KEY` repository secret, and blocks the merge on failure (constitution V). One run is 35 calls, about $1–2 (R6)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: All tables with RLS, encryption, storage, the sandbox port, the restricted-value
detector, limits, listing content, shared errors, and test helpers.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests first ⚠️ (write first, must fail)

- [X] T009 [P] Integration test for RLS on all 11 new tables, run as `guidesk_app`, in `packages/db/test/integration/property-onboarding-rls.test.ts` (SEC-14, AC-SEC-009):
  - a member of workspace A reads nothing of workspace B;
  - agents cannot insert or update any of these tables;
  - agents read calendar feeds only through `calendar_feed_public`;
  - a member of workspace A gets no rows of B through `calendar_feed_public`, and without a workspace context the view returns nothing;
  - `guidesk_app` cannot select any ciphertext column;
  - for the request role, feed and PMS stays only allow the hide transition and guest name removal;
  - the system context used by refreshes can update and cancel feed and PMS stays;
  - inserting a property into a workspace pending deletion fails
- [X] T010 [P] Restricted-value detector tests (R4):
  - a corpus of at least 60 labeled Spanish and English snippets in `packages/domain/test/properties/restricted-values.corpus.ts`. It holds codes in many phrasings, and look-alikes that must survive: prices, phone numbers, street numbers, check-in times, room counts, and Wi-Fi network names;
  - `packages/domain/test/properties/restricted-values.test.ts`, asserting 100% recall on the corpus, the replacement markers, and the counts per kind
- [X] T011 [P] Unit tests for limits in `packages/domain/test/properties/limits.test.ts`:
  - the property limit is `property_limit`, or 2 when it is null;
  - the extraction limit is `max(10, 2 × property limit)`;
  - "Refresh now" is allowed once every 5 minutes
- [X] T012 [P] Vault tests in `packages/vault/test/vault.test.ts` (R5):
  - encryption round trip;
  - a ciphertext copied to another row, column, or workspace fails to decrypt;
  - the stored format is `version || iv || ciphertext || tag`;
  - a retired key still decrypts;
  - an unwrapped data key is dropped from the cache after 5 minutes

### Implementation

- [X] T013 Create the Drizzle schemas:
  - files `packages/db/src/schema/properties.ts`, `extractions.ts`, `stays.ts`, `pms.ts`, `imports.ts`, and `keys.ts`, exported from `packages/db/src/schema/index.ts`;
  - generate `packages/db/migrations/0016_property_onboarding.sql`;
  - follow [data-model.md](data-model.md) for every column and foreign-key rule.

  Constraints to carry exactly:
  - `property`:
    - `name` "text, 1–120 characters";
    - `address_line1` "text, 1–200, nullable";
    - `city` "text, 1–120, nullable";
    - `country` "char(2), nullable", ISO 3166-1 alpha-2;
    - `address_key` indexed, "Not unique";
    - `max_guests` "smallint 1–50, nullable";
    - `guide_languages` "text[] of `es`, `en`", "At least one";
    - `setup_status` enum `needs_details`, `to_confirm`, `ready`;
    - `source` enum `manual`, `listing_text`, `csv`, `pms`, `duplicate`;
    - `source_provider` enum `beds24`, `hostex`, nullable;
    - `pms_status` enum `linked`, `not_found`, nullable;
    - `status` enum `active`, `removed`;
    - a partial unique index on `(workspace_id, source_provider, external_id)`;
  - `workspace.property_limit`: "int, nullable, > 0";
  - `listing_content`:
    - unique on `(property_id, kind)`;
    - `kind` enum `title`, `description`, `house_rules`, `amenities`;
    - `body` "text, ≤ 20,000 characters, nullable";
    - `items` "≤ 200 items, ≤ 120 characters each";
    - `source` enum `listing_text`, `screenshot`, `pms`, `duplicate`;
    - `review_state` enum `unreviewed`, `edited`, `approved`;
  - `restricted_value`:
    - `kind` enum `door_code`, `gate_code`, `lockbox_code`, `alarm_code`, `wifi_password`, `other`;
    - `label` "text, ≤ 80, nullable";
    - `value_ciphertext` bytea;
    - `source` enum `pms`;
    - `source_field` text;
  - `workspace_data_key`: `status` enum `active`, `retired`, and a partial unique index allowing one `active` key per workspace;
  - `upload`:
    - `purpose` enum `screenshot`, `csv`;
    - `status` enum `pending`, `received`, `processed`, `rejected`, `deleted`;
    - `expires_at` = created + 24 hours;
  - `extraction_request`:
    - `status` enum `awaiting_uploads`, `queued`, `running`, `succeeded`, `failed`;
    - `input_text` "text, ≤ 20,000, nullable";
    - `screenshot_count` "smallint 0–10";
    - usage columns `model`, `input_tokens`, `output_tokens`, `cost_usd_micros`;
    - `retry_of_id` uuid, nullable, FK → extraction_request (`ON DELETE SET NULL`);
  - `calendar_feed`:
    - `channel` enum `airbnb`, `booking`, `vrbo`, `other`;
    - `channel_label` "text, ≤ 40, nullable", "Required when `channel = other`" (check constraint);
    - partial unique indexes on `(property_id, channel)` where `channel <> 'other'`, and on `(property_id, channel_label)` where `channel = 'other'` (FR-020);
    - `url_fingerprint` unique per property;
    - `status` enum `active`, `failing`;
  - `stay`:
    - `source` enum `ical`, `pms`, `manual`;
    - unique `(calendar_feed_id, external_uid)`, and `(pms_connection_id, external_uid)` while set;
    - check `checkout_date` > `check_in_date`;
    - `channel` "text, ≤ 40";
    - `status` enum `active`, `cancelled`, `hidden`;
    - `guest_name` "text, ≤ 120, nullable";
    - `guest_name_removed_at` timestamptz, nullable;
    - `booking_reference` "text, ≤ 80, nullable";
  - `pms_connection`:
    - `provider` enum `beds24`, `hostex`;
    - `account_label` "text, ≤ 80";
    - status enum `active`, `failing`, `disconnected`;
    - a partial unique index on `(workspace_id, provider, external_account_id)` where `status <> disconnected`;
  - `import_run`:
    - `kind` enum `pms`, `csv`;
    - `status` enum `validating`, `awaiting_confirmation`, `running`, `completed`, `failed`, `cancelled`;
    - the progress counters;
  - `import_item`:
    - `label` "text, ≤ 120";
    - `outcome` enum `pending`, `created`, `updated`, `needs_details`, `failed`, `skipped`;
    - `row_values` stored "without the calendar link";
    - `calendar_url_ciphertext` bytea, nullable
- [X] T014 Write the custom migration `packages/db/migrations/0017_property_onboarding_rls.sql`:
  - **All tables:** `ENABLE` and `FORCE ROW LEVEL SECURITY` on all 11 tables, plus the system policies for the owner connection, using the role helper from `0005_tenancy_rls.sql`.
  - **`property`:**
    - members read `active` rows; owners and admins also read `removed` rows;
    - inserts and updates need the owner or admin role;
    - the insert `WITH CHECK` refuses a workspace in `pending_deletion` (FR-049).
  - **`calendar_feed`:**
    - owners and admins only;
    - a security-barrier view `calendar_feed_public`, without `url_ciphertext`, `url_fingerprint`, and `display_hint`, readable by every member (FR-025). The view runs with its owner's rights, so it filters itself with `workspace_id = current_setting('app.workspace_id')::uuid` and `app_current_workspace_role() IS NOT NULL`;
    - a trigger that allows at most 5 feeds per property (FR-020).
  - **`stay`:**
    - members read;
    - owners and admins write `manual` rows;
    - on feed and PMS rows, a trigger allows only `active` → `hidden` when `may_be_block` is true, and removing the guest name (`guest_name` to null with `guest_name_removed_at` set) (FR-053). The trigger applies only in the request context (`current_user = 'guidesk_app'`); the system context used by refreshes updates and cancels feed and PMS stays.
  - **Other tables:** `pms_connection`, `import_run`, `import_item`, `upload`, `extraction_request`, `workspace_data_key`, and `restricted_value` are for owners and admins only.
  - **Column grants:** `guidesk_app` gets `INSERT` and `UPDATE`, but no `SELECT`, on `url_ciphertext`, `credential_ciphertext`, `value_ciphertext`, and `calendar_url_ciphertext`. API queries therefore name their columns.
  - **Check:** `pnpm lint:rls` passes
- [X] T015 [P] Extend the security event catalog in `packages/domain/src/security-events.ts` with the events in data model §5. Add `assertSafeMetadata` rules:
  - feed events carry the channel only;
  - manual stay events and `stay.guest_name_removed` carry the stay ID and dates only, never guest names;
  - `integration.disconnected` carries `providerRevoked`;
  - import events carry counts only.

  Extend `packages/domain/test/security-events.test.ts`
- [X] T016 [P] Implement `packages/domain/src/properties/limits.ts`: `FREE_PLAN_PROPERTY_LIMIT = 2`, `propertyLimit`, `extractionLimit`, and `refreshAllowed`
- [X] T017 Implement the detector in `packages/domain/src/properties/restricted-values.ts` (R4):
  - Spanish and English keyword families: código, clave, contraseña, PIN, puerta, portón, caja de seguridad, alarma, Wi-Fi, red, door, gate, lockbox, keypad, alarm, password, passcode, and network;
  - a value is a nearby token of 4 to 12 characters (digits, or letters and digits), on the same line or after a colon;
  - Wi-Fi network names are kept and passwords are removed;
  - returns the redacted text with markers such as `[door code removed]`, the counts per kind, and, for PMS text, each match with its kind
- [X] T018 [P] Define `KeyManagementPort` in `packages/integrations/src/kms/port.ts`, with `generateDataKey(context)` and `decryptDataKey(wrapped, context)`:
  - the AWS adapter in `aws-kms.adapter.ts`, with encryption context `{workspace_id}`;
  - `LocalKeyManagement` in `local.adapter.ts`, which wraps data keys with `LOCAL_KMS_KEY` and is for development and CI only;
  - a contract test in `packages/integrations/test/kms.contract.test.ts`: the local round trip, and the AWS adapter against recorded responses
- [X] T019 Implement `packages/vault` (R5):
  - `src/data-keys.ts`: one active key per workspace in `workspace_data_key`, created with `GenerateDataKey`; only the wrapped copy is stored; unwrapped keys are cached for at most 5 minutes;
  - `src/encrypt.ts`: AES-256-GCM with a random 96-bit IV, and AAD `workspace_id|table|column|row_id`;
  - `src/decrypt.ts`: exported only from `@guidesk/vault/decrypt`
- [X] T020 Add an ESLint `no-restricted-imports` rule in `packages/config/` that allows `@guidesk/vault/decrypt` only under `apps/worker/src/` (R5). Check that `pnpm lint` fails on a test import from `apps/api`
- [X] T021 [P] Define `ObjectStoragePort` in `packages/integrations/src/storage/port.ts`, with `createPresignedPost({key, contentType, maxBytes})` (forms expire after 10 minutes), `get`, and `delete`:
  - the S3 adapter fixes the key, the content type, and `content-length-range` in each form;
  - the local adapter targets a development-only route, `apps/api/src/uploads/local-upload.controller.ts`. That route is registered only when `STORAGE_MODE=local` and enforces the same key, type, size, and expiry with an HMAC-signed token;
  - a contract test in `packages/integrations/test/storage.contract.test.ts`
- [X] T022 Implement `UploadsService` in `apps/api/src/uploads/uploads.service.ts`:
  - it creates `upload` rows with `object_key` = `uploads/{workspace_id}/{upload_id}` (never derived from the file name), `expires_at` = +24 hours, and their presigned forms;
  - an integration test in `apps/api/test/integration/uploads.test.ts`: each form fixes the key, type, and size range, and expires after 10 minutes
- [X] T023 [P] Define `SandboxPort` in `packages/integrations/src/sandbox/port.ts` (R2):
  - `readFeed({url, etag?, lastModified?})` returns `{entries: [{uid, start, end, kind}], etag, lastModified}` or `{error}`;
  - `processFile({objectKey, purpose})` returns `{text}`, `{rows}`, or `{error}`;
  - request and response Zod schemas are shared with `apps/sandbox/src/protocol.ts`;
  - the Lambda adapter uses a synchronous invoke (6 MB response limit) and never logs inputs or outputs;
  - every adapter call runs in an OpenTelemetry span with the function name, duration, and outcome code, never inputs or outputs (constitution VIII);
  - the in-process adapter receives the handler functions by injection, so `packages/integrations` does not depend on `apps/sandbox`;
  - a contract test in `packages/integrations/test/sandbox.contract.test.ts`
- [X] T024 Create `apps/api/src/properties/properties.module.ts` and `PropertyLimitService` in `apps/api/src/properties/property-limit.service.ts` (FR-047, R12):
  - `withCreationSlot(tx, workspaceId, count)` locks the workspace row (`SELECT … FOR UPDATE`);
  - it refuses a workspace pending deletion with `409 workspace_pending_deletion`;
  - it counts `active` properties, and refuses with `409 plan_limit_reached` and `{limit, used}`;
  - it returns the free slots for capped imports.

  Add an integration test in `apps/api/test/integration/property-limit.test.ts`: two parallel creations at `limit − 1` create exactly one property
- [X] T025 Replace `noPropertiesYet` with the real `PropertyCountProvider` in `apps/api/src/properties/property-count.provider.ts`, which counts `active` properties. Wire it in `apps/api/src/security/security.module.ts`.

  Extend `apps/api/test/integration/mfa-threshold.test.ts`: the second-factor requirement applies at 3 active properties, and not at 2 active plus 1 removed (FR-048)
- [X] T026 [P] Add the feature-specific errors from [contracts/http-api.md](contracts/http-api.md#feature-specific-errors) to `apps/api/src/common/problem.ts`, and extend `apps/api/test/unit/problem.filter.test.ts`. The codes: `plan_limit_reached`, `workspace_pending_deletion`, `feed_limit_reached`, `duplicate_feed`, `refresh_too_soon`, `confirmation_mismatch`, `feed_rejected`, `invalid_credential`, and `extraction_limit_reached`
- [X] T027 [P] Create `JobQueueService` in `apps/api/src/jobs/job-queue.service.ts`:
  - it moves the pg-boss client out of `apps/api/src/notifications/outbox.service.ts`;
  - `send(queue, data, options)` queues a job;
  - `call(queue, data, timeoutMs)` sends a job and waits for its output (decision 2);
  - a unit test with a fake queue in `apps/api/test/unit/job-queue.service.test.ts`
- [X] T028 Implement the listing content backend in `apps/api/src/listing-content/`, shared by US2, US4, and US6. Write its integration test first, in `apps/api/test/integration/listing-content.test.ts`.
  - `ListingContentService.upsertFromSource()` replaces a row only while it is `unreviewed` (FR-033).
  - `GET /properties/{id}/listing-content` is for owners, admins, and agents.
  - `PUT …/{kind}` sets `edited`. It runs the detector and refuses text that looks like a restricted value with `422` and a pointer to the guide's locked fields (FR-013).
  - `POST …/{kind}/approve` sets `approved`.
  - Zod contracts go in `packages/contracts/src/listing-content.ts`.
  - The test covers the source labels, edit, approve, the refused code, agent read-only access with the refusal logged, and the re-import rule
- [X] T029 [P] Add property test helpers in `apps/api/test/integration/property-helpers.ts`:
  - seed a workspace with an owner, an admin, and an agent;
  - insert properties in each setup status, and feeds, stays, and PMS connections;
  - a log capture that fails the test when a given secret appears in API or worker output (used by AC-SEC-003 and AC-SEC-008)
- [X] T030 [P] Add a job span helper in `apps/worker/src/jobs/span.ts` (R13, constitution VIII):
  - it wraps each job in an OpenTelemetry span with the workspace ID and counts;
  - it counts failures per provider and error code;
  - a unit test in `apps/worker/test/span.test.ts` checks that restricted keys never become attributes
- [X] T031 [P] Add the portal's shared pieces:
  - `apps/portal/lib/properties-api.ts`: a typed client over `apps/portal/lib/api.ts`;
  - `apps/portal/lib/use-online.ts`: offline, creation, imports, uploads, and feed changes are disabled with an explanation, and form drafts stay in `sessionStorage` until the connection returns (edge case);
  - a "Properties" entry in `apps/portal/components/app-header.tsx`;
  - the shared `properties` strings (setup statuses, sources, errors) in `packages/i18n/messages/es.json` and `en.json`, keeping `packages/i18n/test/catalogs.test.ts` green

**Checkpoint**: Foundation ready. User stories can begin.

---

## Phase 3: User Story 1 - Create a property and confirm its core facts (Priority: P1) 🎯 MVP

**Goal**: An owner or admin creates a property from a blank start, confirms its core facts with a
suggested time zone, and sees it in the list. Agents only read.

**Independent Test**: Quickstart scenarios 1 and 2. An owner creates a property on a phone, edits a
fact, and sees it in the list. An agent of the same workspace views it but cannot edit it.

### Tests for User Story 1 ⚠️ (write first, must fail)

- [X] T032 [P] [US1] Unit tests for core facts in `packages/domain/test/properties/core-facts.test.ts`:
  - required facts: name, street line, city, country, time zone, check-in, checkout, maximum guests, and at least one language (FR-001);
  - `missingFacts`;
  - setup status: `ready` when confirmed with every fact, `needs_details` when a fact is missing, `to_confirm` for complete imports, and `ready` → `needs_details` when a required fact is cleared;
  - filling the last missing fact makes a manual, listing-text, or duplicate property `ready`, and a CSV or PMS property `to_confirm` (data model §7);
  - `address_key` normalization: case, accents, and spacing;
  - guide languages default to the workspace language first (FR-003)
- [X] T033 [P] [US1] Unit tests for time zone suggestion in `packages/domain/test/properties/time-zones.test.ts` (FR-002):
  - CR → `America/Costa_Rica`;
  - MX with "Cancún" or "cancun" → `America/Cancun`;
  - MX with "Ciudad Inventada" → no suggestion, and Mexico's zones as choices;
  - a zone outside the country → mismatch warning;
  - every zone in the data exists in `Intl.supportedValuesOf("timeZone")`
- [X] T034 [P] [US1] Unit tests for the order of starting options in `packages/domain/test/properties/start-options.test.ts` (FR-008):
  - path `individual` → listing text first;
  - PMS answer `beds24` or `hostex` with its flag on → PMS import first;
  - `manager` without a supported PMS → CSV first;
  - a PMS whose flag is off is never offered
- [X] T035 [P] [US1] Contract tests in `apps/api/test/contract/properties.contract.test.ts` for:
  - `GET /properties`, `GET /properties/limits`, and `GET /properties/start-options`;
  - `POST /properties`, and `GET` and `PATCH /properties/{id}`;
  - `GET /properties/address-check`;
  - `GET /time-zones` and `GET /time-zones/suggest`
- [X] T036 [P] [US1] Integration tests in `apps/api/test/integration/properties.test.ts`:
  - a blank creation is `ready`, listed with source `manual`, and found by name search;
  - a missing fact → `422` with field errors, and nothing created;
  - an admin changes the checkout time, and times come back in the property's zone;
  - a `PATCH` that fills the last missing fact of a manual property makes it `ready`;
  - agents: `GET` works; `POST` and `PATCH` → `403` with `access.role_denied` logged (AC-SEC-001);
  - a property of workspace B → `404` (AC-SEC-009);
  - at the limit → `409 plan_limit_reached` with `{limit, used}`;
  - a workspace pending deletion → `409 workspace_pending_deletion`;
  - a second property at the same address appears in `address-check`;
  - once the workspace has 3 active properties, an owner without a second factor gets `mfa_enrollment_required` on `POST /properties` (FR-048)
- [X] T037 [P] [US1] End-to-end test on a phone viewport in `e2e/specs/properties-us1-blank.spec.ts` (quickstart 1 and 2):
  - blank creation with the suggested time zone;
  - choosing among Mexico's zones;
  - the agent's read-only view;
  - the limit explanation

### Implementation for User Story 1

- [X] T038 [US1] Generate the time zone reference data (R11):
  - a script `packages/domain/scripts/generate-time-zones.ts` that reads the IANA `zone1970.tab` and GeoNames `cities15000`. It downloads them into an ignored folder, and keeps cities only for countries with several zones;
  - output `packages/domain/src/properties/time-zone-data.ts`: country → zones, and accent-folded city names and alternate names → zone;
  - a `pnpm tz:check` script that fails when a zone is missing from `Intl.supportedValuesOf("timeZone")`;
  - the GeoNames CC BY 4.0 attribution in `NOTICE.md`
- [X] T039 [US1] Implement `packages/domain/src/properties/core-facts.ts` and `packages/domain/src/properties/time-zones.ts` (`suggestTimeZone(country, city)`, `zonesForCountry(country)`, `timeZoneMatchesCountry`)
- [X] T040 [P] [US1] Implement `packages/domain/src/properties/start-options.ts`, using `derivePath` and `PMS_OPTIONS` from feature 001
- [X] T041 [P] [US1] Write the Zod contracts in `packages/contracts/src/properties.ts` and `packages/contracts/src/time-zones.ts`:
  - core facts:
    - name 1–120;
    - street line 1–200;
    - city 1–120;
    - country ISO 3166-1 alpha-2;
    - times as `HH:MM`;
    - maximum guests 1–50;
    - languages a subset of `es` and `en`, at least one;
    - an IANA zone;
  - list and detail responses, and limits;
  - start options, with `screenshotsEnabled` and the enabled PMS providers
- [X] T042 [US1] Implement `PropertiesService` and `PropertiesController` in `apps/api/src/properties/`:
  - **List:** search by name, with a cursor.
  - **`limits`:** returns `{limit, used, extractionLimit, extractionsUsedToday}`.
  - **`start-options`:** paths not built yet are left out.
  - **Create:** from the confirmation step, with source `manual`, inside `PropertyLimitService.withCreationSlot`.
  - **Get.**
  - **`PATCH`:**
    - recomputes the setup status and `missing_facts`. Filling the last missing fact makes a manual, listing-text, or duplicate property `ready`, and a CSV or PMS property `to_confirm`;
    - records `edited_facts` for imported properties (FR-033).
  - **`address-check`.**
  - **Guards:** writes need `properties.manage`. Creation honors `requiresMfa` through the existing step-up guard
- [X] T043 [P] [US1] Implement `apps/api/src/time-zones/time-zones.controller.ts` (`GET /time-zones` and `GET /time-zones/suggest`). It returns local names and current UTC offsets, and makes no outside call (FR-002)
- [X] T044 [US1] Build the core-facts confirmation step in `apps/portal/components/properties/core-facts-form.tsx`. Every creation path uses it:
  - required markers and clear messages;
  - the time zone suggestion, or the choice among the country's zones;
  - the mismatch warning;
  - the dismissible duplicate-address warning;
  - guide languages defaulting to the workspace language first;
  - offline drafts from T031
- [X] T045 [US1] Build the property list and the starting options:
  - the list in `apps/portal/app/[locale]/(app)/properties/page.tsx` with `apps/portal/components/properties/property-list.tsx`: name, setup status, source, and search. The empty state shows the starting options;
  - replace the handoff page `apps/portal/app/[locale]/(app)/properties/new/page.tsx` with the starting options (recommended first) and the blank flow;
  - point `apps/portal/components/first-property.tsx` there
- [X] T046 [US1] Build the property detail page `apps/portal/app/[locale]/(app)/properties/[propertyId]/page.tsx`, with the facts panel `apps/portal/components/properties/property-facts.tsx`:
  - owners and admins can edit, and agents only read;
  - times are shown in the property's zone;
  - a "Next: build the guide" call to action, a placeholder until spec 003
- [X] T047 [P] [US1] Add the US1 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`: starting options, facts, time zone messages, the limit explanation, and offline notes

**Checkpoint**: US1 works on its own: blank creation, editing, the list, and read-only agents.

---

## Phase 4: User Story 2 - Start from my listing text or screenshots (Priority: P1)

**Goal**: A host pastes listing text or uploads screenshots. Codes are removed before the AI
sees anything, and the structured content and proposed facts arrive for review within a minute.
Guidesk never opens a listing URL.

**Independent Test**: Quickstart scenarios 3 to 6. A Spanish and an English sample listing give
structured content labeled "From your listing". A door code in the text or in a screenshot never
reaches the AI.

### Tests for User Story 2 ⚠️ (write first, must fail)

- [X] T048 [P] [US2] Unit tests in `packages/domain/test/properties/extraction.test.ts`:
  - URL-only detection: `https://www.airbnb.com/rooms/123`, with surrounding spaces, or several URLs alone → true; text that includes a URL → false (FR-011);
  - the model output maps to content items and proposed facts, keeping the detected language (FR-019);
  - URLs in the output stay plain text, marked for review (AC-SEC-004);
  - the detector runs again on the output and drops items that look like restricted values (FR-013)
- [X] T049 [P] [US2] Contract tests for `AnthropicLlmAdapter` against recorded responses, in `packages/integrations/test/llm/anthropic.contract.test.ts`:
  - each request uses `claude-opus-5-5`, `output_config.effort: "low"`, the structured output format, no tools, and the delimited listing block;
  - `stop_reason` `refusal` and `max_tokens` are handled as ADR-0005 says;
  - usage and cost are mapped;
  - a call is aborted at the deadline
- [X] T050 [P] [US2] Sandbox tests in `apps/sandbox/test/file-processor.test.ts`:
  - magic bytes accept JPEG, PNG, and WebP, and reject a ZIP or a script named `.png` (AC-SEC-005);
  - re-encoding strips EXIF and GPS data, and gives a grayscale PNG with its longest side at most 2,560 px;
  - the object is deleted after processing;
  - Tesseract reads the Spanish and English sample screenshots in `apps/sandbox/test/fixtures/screenshots/`. They are rendered from synthetic listings written for the suite
- [ ] T051 [P] [US2] Integration tests in `apps/api/test/integration/extractions.test.ts`, with `LLM_MODE=fake` and the in-process sandbox:
  - pasted text with "Door code 4821" and "Wi-Fi password: Colibri2026" → counts `{door_code: 1, wifi_password: 1}`. Neither value appears in the fake model's recorded input, in the stored `input_text`, or in the logs (AC-SEC-003);
  - the injection text from quickstart 3: the instruction is not followed, the URL is only listing text marked for review, and nothing is published (AC-SEC-004);
  - a URL only → `urlOnly: true`, no outbound request, no AI call, and no limit used (FR-011);
  - a screenshot showing "Door code 4821": the text is recognized, the code is removed, the fake model receives no image and no code, and the upload is deleted (AC-SEC-014, FR-015);
  - an unreadable screenshot → `failedScreenshots: 1`, and the other content is kept;
  - input with nothing useful → `failed` with `nothing_found`;
  - a model that takes longer than 60 seconds → `failed` with `timeout`, and the input is kept (FR-016);
  - `POST /extractions/{id}/retry` on that request creates a new request with `retry_of_id`, from the stored redacted and recognized text, with no new upload; it counts toward the limit; a retry of a request that is not `failed` with `timeout` or `ai_unavailable` → `409 conflict`;
  - with `property_limit` 2, the 11th extraction of the day → `429 extraction_limit_reached` with `{limit, resetsAt}`, and no AI call (AC-SEC-010);
  - `POST /properties` with `extractionRequestId` stores the accepted items as `unreviewed`, with source `listing_text` or `screenshot`. It sets `property_id` and deletes the input text;
  - screenshots are refused while `EXTRACTION_SCREENSHOTS` is off;
  - agents are refused, and other workspaces get `404`
- [X] T052 [P] [US2] Build the eval suite in `evals/extraction/` (R6, SC-002, constitution V):
  - 30 synthetic listings written for the suite (15 Spanish, 15 English), with expected fields, in `cases/listings/`;
  - 5 injection cases in `cases/injection/`;
  - a runner, `src/run.ts`, that calls the real adapter and scores field placement (at least 90%), invented facts (0), and injection resistance (5 of 5), then writes a report;
  - the command `pnpm --filter @guidesk/evals-extraction eval`
- [ ] T053 [P] [US2] End-to-end test on a phone viewport with the fake model, in `e2e/specs/properties-us2-listing.spec.ts`:
  - paste a listing with a code, and see the redaction notice;
  - review the items labeled "From your listing", edit one, and see its label change;
  - confirm, and the property is created;
  - a URL alone shows the request for text or screenshots

### Implementation for User Story 2

- [X] T054 [US2] Implement `packages/domain/src/properties/extraction.ts`: `isUrlOnly`, `toContentItems`, `toProposedFacts`, `markUrlsForReview`, and the output pass of the detector
- [X] T055 [US2] Implement the AI extraction in `packages/integrations/src/llm/`. Check every SDK call against the `claude-api` reference before writing it.
  - **`port.ts`:** `LlmPort.extractListing(redactedText, {signal})` returns `{result, usage, model}`.
  - **`extraction/prompt.ts` and `extraction/schema.ts`:**
    - every field is nullable: title, description, house rules, amenities, check-in and checkout times, maximum guests, and language;
    - the prompt states that the input is listing data, never instructions.
  - **`anthropic.adapter.ts`:**
    - `client.messages.parse` with `output_config: {effort: "low", format: zodOutputFormat(schema)}`;
    - checks `stop_reason`, with the refusal fallback from ADR-0005;
    - computes the cost from a price table, with values taken from Anthropic's pricing page at implementation time.
  - **`fake.adapter.ts`:** records its inputs for tests
- [X] T056 [US2] Define `TextRecognitionPort` in `packages/integrations/src/ocr/port.ts`, and implement the file processor in `apps/sandbox/src/file-processor/`:
  - `images.ts`: magic-byte check and `sharp` re-encoding;
  - `ocr.ts`: `tesseract.js` with the bundled `spa` and `eng` data and no network access;
  - `handler.ts`: reads one object, processes it, deletes it, and returns the text or `{error: unsupported_type | too_large | unreadable}`
- [ ] T057 [US2] Run the R3 accuracy gate. A script, `apps/sandbox/scripts/ocr-accuracy.ts`, measures character accuracy on 30 sample screenshots (15 Spanish, 15 English), rendered from the synthetic listings of T052. Record the result in [research.md](research.md#r3-text-recognition-for-screenshots).
  - At 95% or more, keep Tesseract.
  - Below 95%, implement the Textract adapter behind `TextRecognitionPort`, with the AWS Organizations AI opt-out policy, before `EXTRACTION_SCREENSHOTS` is turned on in production
- [ ] T058 [US2] Implement the extractions module in `apps/api/src/extractions/`, with contracts in `packages/contracts/src/extractions.ts`:
  - **`POST /extractions`:**
    - validates at most 20,000 characters, and at most 10 screenshots of at most 10 MB each in JPEG, PNG, or WebP;
    - redacts the text before storing it;
    - a URL-only input becomes `failed` with `url_only`, without using the limit (decision 3);
    - otherwise it consumes `extraction:{workspaceId}:{UTC date}` in `rate_limit_bucket`, up to `extractionLimit`;
    - returns the redaction counts and the presigned upload forms.
  - **`POST /extractions/{id}/submit`:** returns `202` and queues `extraction.run`.
  - **`GET /extractions/{id}`.**
  - **`POST /extractions/{id}/retry`:** only after `failed` with `timeout` or `ai_unavailable`. Creates a new request with `retry_of_id`, copying the stored redacted `input_text` and `recognized_text`, consumes the daily limit, and queues `extraction.run`; screenshots are not uploaded again.
- [ ] T059 [US2] Implement the worker job `apps/worker/src/jobs/extraction.ts` (`extraction.run`):
  - a 60-second deadline for the whole job;
  - screenshots processed in parallel through `SandboxPort.processFile`, and the recognized text redacted;
  - one `LlmPort` call on the combined redacted text, followed by the output pass;
  - stores the result, usage, model, and cost;
  - fails with `timeout`, `ai_unavailable`, or `nothing_found`;
  - sets the upload rows to `deleted`.

  Add a worker test in `apps/worker/test/extraction-job.test.ts`
- [ ] T060 [US2] Extend `POST /properties` in `apps/api/src/properties/properties.service.ts` for source `listing_text`, with `extractionRequestId` and `contentItems`:
  - store the accepted items as `unreviewed` through `ListingContentService`;
  - set `extraction_request.property_id`;
  - clear `input_text` and `recognized_text`, and set `input_deleted_at`
- [X] T061 [P] [US2] Implement `apps/portal/lib/image-normalize.ts`, loaded on demand:
  - re-encodes each image to JPEG with the canvas API, with its longest side at most 2,560 px;
  - decodes HEIC where the browser can, and otherwise asks for a JPEG or PNG
- [ ] T062 [US2] Build the listing flow in `apps/portal/app/[locale]/(app)/properties/new/listing/page.tsx`. It ends in the confirmation step, prefilled with the proposed facts.
  - `apps/portal/components/properties/listing-input.tsx`:
    - the paste box, with the warning not to include codes and a 20,000-character counter;
    - the screenshot picker with camera capture, shown when the flag is on, with the same warning not to include codes (FR-012);
    - uploads through the presigned forms.
  - `apps/portal/components/properties/extraction-review.tsx`:
    - status polling;
    - the redaction notice ("1 door code removed") with the pointer to the guide's locked fields;
    - "Paste the text instead" for failed screenshots;
    - "Try again" after a failure or timeout, through the retry route, keeping the host's input (FR-016);
    - items labeled "From your listing";
    - "nothing found", which offers a blank start;
    - the limit message with the reset time;
    - the URL-only message
- [ ] T063 [US2] Build the listing content panel on the property detail page, `apps/portal/components/properties/listing-content.tsx`:
  - items with their source label ("From your listing", "From Beds24", "Copied");
  - owners and admins edit and approve, and the label shows the item was reviewed;
  - agents only read;
  - the message for refused codes (`422`)
- [ ] T064 [P] [US2] Add the US2 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`

**Checkpoint**: US1 and US2 work: the MVP's two creation paths.

---

## Phase 5: User Story 3 - Connect my OTA calendar so Guidesk knows my stays (Priority: P2)

**Goal**: Owners and admins add iCal links, which are read through the isolated feed reader.
Reservations become stays, refreshed at least every 3 hours. Direct bookings are added by hand.

**Independent Test**: Quickstart scenarios 7 and 8. A valid link shows upcoming stays. A booking
added to the feed appears after a refresh, and a cancelled one is marked. An internal link is
rejected. A direct booking added by hand appears in the same list.

### Tests for User Story 3 ⚠️ (write first, must fail)

- [X] T065 [P] [US3] Build the iCal fixture server, `e2e/helpers/ical-server.ts`, with a script that creates its test certificate authority:
  - HTTPS feeds with reservations, blocks, and unlabeled entries;
  - a feed that redirects to `127.0.0.1`, a slow feed, an oversized feed, and a feed whose content can be changed during a test.

  The API, worker, and end-to-end tests reuse it
- [X] T066 [P] [US3] Unit tests in `packages/domain/test/properties/feeds.test.ts`:
  - **Classification:**
    - reservation: "Reserved", "Reservado", or a summary with a booking reference;
    - block: "Not available", "Blocked", "No disponible", "Bloqueado", and "Airbnb (Not available)";
    - anything else is unlabeled.
  - **Channel detection** from the link's host: `airbnb.*`, `booking.com`, `vrbo.com`, or `other`.
  - **URL normalization** for the fingerprint.
  - **The display hint mask,** for example `airbnb.com/…/a1b2.ics`
- [X] T067 [P] [US3] Unit tests in `packages/domain/test/properties/stays.test.ts`:
  - past entries are dropped;
  - entries missing from a successful read are marked `cancelled`;
  - hidden stays stay hidden;
  - refreshes never touch manual stays;
  - a PMS stay wins over a feed stay with the same property and dates;
  - an unlabeled entry that matches a labeled reservation from another feed gets `duplicate_of_id`;
  - overlaps are flagged;
  - "upcoming" is computed in the property's zone
- [X] T068 [P] [US3] Sandbox tests in `apps/sandbox/test/feed-reader.test.ts`, with a fake DNS resolver (FR-026, AC-SEC-002):
  - `http://` is refused;
  - these addresses are refused: `169.254.169.254`, `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, `::1`, `fc00::/7`, `fe80::/10`, and IPv4-mapped IPv6;
  - a public name that resolves to a private address is refused;
  - a redirect to `127.0.0.1` is refused, because every hop is checked again;
  - a 4th redirect is refused;
  - the connection uses the address that was checked (DNS rebinding);
  - reads stop at 2 MB and at 10 seconds;
  - a body that is not iCal → `not_ical`;
  - the output holds only `{uid, start, end, kind}`, with no summary, description, link, or phone digits (FR-022)
- [X] T069 [P] [US3] Integration tests in `apps/api/test/integration/calendar-feeds.test.ts`, with the fixture server:
  - saving a feed returns a preview of the upcoming stays. Blocks are not stays, and unlabeled entries have `mayBeBlock`;
  - `http://` links, `https://169.254.169.254/latest`, and a redirect to `127.0.0.1` → `422 feed_rejected`, with nothing stored (AC-SEC-002);
  - a 6th feed → `409 feed_limit_reached`; the same link twice → `409 duplicate_feed` with `reason: same_link`; a second Airbnb feed → `409 duplicate_feed` with `reason: same_channel`; two `other` feeds with different labels are allowed (FR-020);
  - a workspace pending deletion → `409 workspace_pending_deletion` (FR-049);
  - responses carry only `displayHint`, the stored column holds ciphertext, and the link never appears in logs (AC-SEC-008);
  - agents get `404` on feed routes, and each refusal is logged as `access.role_denied` (AC-SEC-001); they still see stays and the calendar status;
  - "Refresh now" twice within 5 minutes → `409 refresh_too_soon`;
  - `calendar_feed.added`, `calendar_feed.changed`, and `calendar_feed.removed` are logged with the channel only
- [X] T070 [P] [US3] Integration tests in `apps/api/test/integration/stays.test.ts`:
  - a manual stay gets the channel "Direct" and the property's times by default (FR-052);
  - an overlapping stay is flagged (FR-054);
  - manual stays can be edited and cancelled;
  - `PATCH` on a feed stay → `409 conflict`, except `{status: "hidden"}` when `mayBeBlock` is true (FR-053);
  - `POST /stays/{id}/remove-guest-name` on a PMS stay and on a manual stay sets the name to null and `guest_name_removed_at`, and logs `stay.guest_name_removed` without the name (FR-053);
  - agents are refused and the refusal is logged;
  - `stay.added_manually`, `stay.changed_manually`, and `stay.cancelled_manually` carry dates only
- [ ] T071 [P] [US3] Worker tests in `apps/worker/test/calendar-refresh.test.ts`:
  - the cron picks feeds whose last success is older than 3 hours, only for active properties;
  - a feed never runs twice at the same time;
  - "Refresh now" runs ahead of scheduled refreshes, within 1 minute (SC-006);
  - a `304` response keeps the stays;
  - a new booking is added, and one that disappears is marked `cancelled`;
  - hidden stays stay hidden;
  - a failing read keeps the stays and sets `failing_since`;
  - after 24 hours of failures, one `properties.feed_failing` email is queued and `alerted_at` is set
- [ ] T072 [P] [US3] End-to-end test in `e2e/specs/properties-us3-calendar.spec.ts` (quickstart 7 and 8):
  - add the fixture feed and see the stays;
  - hide a "may be a block" stay, refresh, and it stays hidden;
  - add a direct stay by hand

### Implementation for User Story 3

- [X] T073 [US3] Implement in the domain:
  - `packages/domain/src/properties/feeds.ts`: the classification table, channel detection, normalization, and the display hint;
  - `packages/domain/src/properties/stays.ts`: deduplication, overlaps, cancellations, and the upcoming filter
- [X] T074 [US3] Implement the feed reader in `apps/sandbox/src/feed-reader/` (R2, R8):
  - `safe-fetch.ts`:
    - `undici` with a custom `lookup` and `ipaddr.js` range checks;
    - HTTPS only;
    - at most 3 redirects, each checked again;
    - the connection pinned to the checked address;
    - limits of 2 MB and 10 seconds;
    - conditional request headers;
  - `parse.ts`: `ical.js`, keeping `VEVENT` entries with `DTSTART` and `DTEND` dates, dropping past entries, and classifying with the domain table;
  - `handler.ts`.

  `SANDBOX_TEST_ALLOW_HOST` and the test certificate authority are honored only outside production (T006)
- [X] T075 [US3] Implement the calendar feeds module in `apps/api/src/calendar-feeds/`, with contracts in `packages/contracts/src/calendar-feeds.ts`:
  - **`POST`:**
    - reads the link through `SandboxPort.readFeed` before saving anything (FR-021);
    - encrypts the link with the vault, with the AAD bound to the new row;
    - stores the fingerprint, an HMAC-SHA-256 with `FEED_URL_PEPPER`;
    - creates the upcoming stays from the preview.
  - **`GET`:** for owners and admins; agents get `404`.
  - **`PATCH`:** changes the channel label, or replaces the link, which is checked again.
  - **`DELETE`:** removes the feed and its future stays.
  - **`POST …/refresh`:** sets `manual_refresh_at` and queues a high-priority job
- [X] T076 [US3] Implement the stays module in `apps/api/src/stays/`, with contracts in `packages/contracts/src/stays.ts`:
  - `GET /properties/{id}/stays`: upcoming stays by default, with `possiblyOutdated` when the source feed or connection is failing;
  - `POST`: a manual stay, with the overlap flag (FR-052, FR-054);
  - `PATCH`: editing a manual stay, or hiding a stay;
  - `POST /stays/{id}/cancel`;
  - `POST /stays/{id}/remove-guest-name`: any stay; sets `guest_name` to null and `guest_name_removed_at`, and logs `stay.guest_name_removed` (FR-053)
- [ ] T077 [US3] Implement the worker job `apps/worker/src/jobs/calendar-refresh.ts` (`calendar.refresh`):
  - a cron every 15 minutes queues the feeds that are due, spread by feed ID, with a singleton key per feed;
  - the handler decrypts the link with `@guidesk/vault/decrypt`, reads it through `SandboxPort`, and applies `stays.ts`;
  - it records success or failure, and queues `properties.feed_failing` once after 24 hours of failures
- [X] T078 [P] [US3] Create the email template `properties.feed_failing` (ES/EN) in `packages/emails/src/properties/feed-failing.tsx`, as [contracts/emails.md](contracts/emails.md) describes. It carries no link and no guest name. Add a render test in `packages/emails/test/properties.test.ts`
- [ ] T079 [US3] Build the property's calendars and stays panels:
  - `apps/portal/components/properties/calendar-feeds.tsx`, hidden from agents:
    - add a link with its channel;
    - the masked hint;
    - the status, last success, and failure reason;
    - "Refresh now";
  - `apps/portal/components/properties/stays-list.tsx`, with `apps/portal/components/properties/stay-form.tsx`:
    - upcoming stays in the property's zone, with source and channel;
    - the "may be a block" badge with Hide;
    - overlap and "possibly out of date" notices;
    - adding, editing, and cancelling manual stays;
    - "Remove guest name" on any stay that has one, with a confirmation, for owners and admins
- [ ] T080 [US3] Add the calendar status to the property list (FR-006) in `apps/api/src/properties/properties.service.ts` and `apps/portal/components/properties/property-list.tsx`
- [ ] T081 [P] [US3] Add the US3 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`

**Checkpoint**: US3 works on its own: feeds, refreshes, and manual stays.

---

## Phase 6: User Story 4 - Import my properties from my PMS (Priority: P2)

**Goal**: An owner or admin connects Beds24 or Hostex with their own credential, after step-up,
and imports the selected listings in the background. Stays are then refreshed read-only every 3
hours until they disconnect.

**Independent Test**: Quickstart scenario 9, using recorded provider data. A connection,
selection, and background import give one property per listing with content, upcoming stays, and
a per-listing result. A changed reservation appears after a refresh, and nothing is written to
the PMS.

**Prerequisite (founder):** test accounts for Beds24 and for Hostex (Hostex needs the Pro
edition), so that T082 records real responses (constitution IV).

### Tests for User Story 4 ⚠️ (write first, must fail)

- [ ] T082 [P] [US4] Record fixtures from the Beds24 and Hostex test accounts into `packages/integrations/test/fixtures/beds24/` and `packages/integrations/test/fixtures/hostex/`. Scrub them before commit: names, contacts, and codes become synthetic values. Cases a test account cannot produce (a revoked token, the credit floor) may be synthetic, built from the documented response shapes, and are marked as such in the file name. The fixtures cover:
  - properties with several room types, texts in two languages, and known and unknown `featureCodes`;
  - bookings in every status, with guest email, phone, and notes;
  - house rules that contain "Door code 4821";
  - a revoked token;
  - Beds24 credit headers near the floor;
  - a Hostex `error_code` with HTTP 200;
  - pages of 100 items;
  - `check_in_details` with a lock code.

  If a test account is not available yet, start from synthetic fixtures and replace them with recordings before production (T129)
- [ ] T083 [P] [US4] Contract tests for the Beds24 adapter in `packages/integrations/test/pms/beds24.contract.test.ts` (R7):
  - **Credential:**
    - the invite code is exchanged once for a refresh token;
    - access tokens are cached in memory only.
  - **Listings:**
    - listings map to `{propertyId}:{roomTypeId}`, with their names;
    - facts come from `checkInStart`, `checkOutEnd`, and `maxPeople`;
    - texts and amenities are mapped, and unknown codes are dropped;
    - templates, unit notes, info items, and custom fields are never read.
  - **Bookings:**
    - `confirmed` and `new` become `active`, and `cancelled` becomes `cancelled`;
    - `request`, `inquiry`, and `black` are skipped;
    - the guest count is `numAdult` + `numChild`;
    - no output type has a field for contact data.
  - **Rate limits:** the adapter never goes below 30 remaining credits; it waits for the reset.
  - **Revoke:** `revoke` calls `DELETE /authentication/token`.
  - **Read-only:** every import and refresh request is a `GET` (AC-SEC-013)
- [ ] T084 [P] [US4] Contract tests for the Hostex adapter in `packages/integrations/test/pms/hostex.contract.test.ts` (R7):
  - **Credential:** validation with `GET /accounts/me`, and handling of `error_code`.
  - **Properties:**
    - they map with their missing facts;
    - check-in and checkout times come from `price_and_rules` for Airbnb-linked listings, and its `max_guests` is ignored.
  - **Reservations:**
    - `accepted` becomes `active`;
    - `cancelled`, `denied`, and `timeout` become `cancelled`;
    - `wait_accept` and `wait_pay` are skipped;
    - `check_in_details`, phone, email, `guests[]`, remarks, and custom fields are dropped.
  - **Pagination.**
  - **Read-only:** only `GET` requests.
  - **Revoke:** `revoke` reports `providerRevoked: false`
- [ ] T085 [P] [US4] Integration tests in `apps/api/test/integration/pms-connections.test.ts`:
  - connecting without step-up → `step_up_required` (AC-SEC-007);
  - with 3 or more properties and no second factor → `mfa_enrollment_required`;
  - an invalid credential → `422 invalid_credential` with `{provider, helpUrl}`, and nothing stored;
  - a valid credential → the connection with its listings and `alreadyImported`. The credential is stored only as ciphertext, and never appears in responses or logs (AC-SEC-008);
  - agents get `404`, and each refusal is logged as `access.role_denied` (AC-SEC-001); a provider's routes are refused while its flag is off;
  - `GET …/listings` works through the worker, and the API never decrypts;
  - disconnect:
    - the credential is set to null in the same transaction;
    - Beds24's revoke is called, and the response has `providerRevoked: true`;
    - Hostex returns `{providerRevoked: false, instructionsUrl}`;
    - with the worker unavailable (no answer within 15 s), the credential is still set to null, the status is `disconnected`, and the response is `{providerRevoked: false, instructionsUrl}`;
    - `integration.disconnected` is logged with `providerRevoked`;
    - properties keep their source label (FR-036)
- [ ] T086 [P] [US4] Integration tests for the import in `apps/api/test/integration/pms-import.test.ts`, with the fixture adapters:
  - **Running the import:**
    - the selection is capped at the remaining limit;
    - the run answers `202` and continues in the background, with progress counts.
  - **Outcomes:**
    - every listing ends `created`, `needs_details`, or `failed` with a reason (SC-004);
    - Hostex listings arrive in `needs_details` with their missing facts;
    - Beds24 time zones are suggested from country and city.
  - **Content and codes:**
    - content is labeled with the provider;
    - the code in the house rules is stored as an encrypted `restricted_value` with its `source_field`, removed from the content, masked in responses, and never sent to the AI (FR-031).
  - **Guest data:** stays keep only dates, channel, booking reference, guest count, and guest name. The fixture's email, phone, address, and notes are absent from the database (AC-SEC-012).
  - **Limits and failures:**
    - when the plan limit is reached mid-import, the remaining items are `skipped` with `plan_limit`;
    - when the token is revoked mid-import, the remaining items are `failed` with `reconnect_pms`;
    - a failed item can be retried on its own (FR-032).
  - **Re-import:** no duplicates, and `edited_facts` and reviewed content are kept (FR-033).
  - **Edge cases:**
    - the same listing can be imported into two workspaces;
    - a member removed mid-import: the run finishes under the workspace, and that member then gets `404` for it.
  - **Events:** `import.started` and `import.finished` are logged, and `properties.import_finished` is queued
- [ ] T087 [P] [US4] Worker tests in `apps/worker/test/pms-refresh.test.ts`:
  - **Scheduling:**
    - connections are refreshed every 3 hours;
    - "Refresh now" is allowed once every 5 minutes per connection.
  - **Applying changes:**
    - new, changed, and cancelled reservations are applied;
    - core facts, listing content, and manual stays are never touched;
    - a guest name removed on request is not restored, even when the PMS changes it (FR-053);
    - a PMS stay wins over a matching feed stay.
  - **Failures:**
    - a listing gone from the PMS gets `pms_status = not_found`, and its stays stop refreshing;
    - after 24 hours of failures, one `properties.pms_reconnect` email is queued.
  - **No request (AC-SEC-011):** a disconnected connection, or a removed property, makes no request
- [ ] T088 [P] [US4] End-to-end test in `e2e/specs/properties-us4-pms.spec.ts` (quickstart 9, `PMS_MODE=fixtures`):
  - step-up and connect;
  - unselect one listing and import;
  - the progress banner;
  - the results with retry;
  - "Confirm all";
  - disconnect

### Implementation for User Story 4

- [ ] T089 [US4] Define `PmsPort` and its normalized types in `packages/integrations/src/pms/port.ts`: `validateCredential`, `listListings`, `getListing`, `listReservations`, and `revoke`. The types have no field for contact data
- [ ] T090 [US4] Implement the Beds24 adapter in `packages/integrations/src/pms/beds24/`:
  - `client.ts`: the token exchange, the in-memory access token cache, and the credit-aware throttle;
  - `schemas.ts`: allowlist Zod schemas;
  - `mapping.ts`: the `featureCodes` amenity table, the status mapping, and channels from `referer`;
  - `adapter.ts`
- [ ] T091 [P] [US4] Implement the Hostex adapter in `packages/integrations/src/pms/hostex/`:
  - `client.ts`: the `Hostex-Access-Token` header, and `error_code` handling;
  - `schemas.ts`, `mapping.ts`, and `adapter.ts`
- [ ] T092 [US4] Implement the fixture mode `PMS_MODE=fixtures` in `packages/integrations/src/pms/fixtures.ts`. It serves the recorded fixtures through the real adapters with an `undici` `MockAgent`, for development and end-to-end tests only
- [ ] T093 [US4] Implement the PMS module in `apps/api/src/pms/`, with contracts in `packages/contracts/src/pms.ts`:
  - **`POST /pms-connections`:**
    - step-up and MFA guards, and the provider's flag;
    - validates the credential with the adapter;
    - stores the credential encrypted. For Beds24 this is the refresh token, never the invite code;
    - returns the listings with `alreadyImported`;
    - logs `integration.connected`.
  - **`GET /pms-connections`.**
  - **`GET …/listings`:** through `JobQueueService.call("pms.listings")` (T027).
  - **`POST …/imports`:**
    - capped at the free slots;
    - creates the `import_run` and its items, and queues `pms.import`;
    - logs `import.started`.
  - **`POST …/refresh`.**
  - **`DELETE`:**
    - for Beds24, calls `pms.revoke` through `JobQueueService.call` and waits up to 15 s;
    - then, whatever the result, sets the credential to null and the status to `disconnected` in one transaction;
    - when the token was not revoked (Hostex, a failure, or a timeout), responds `{providerRevoked: false, instructionsUrl}`;
    - logs `integration.disconnected` with `providerRevoked`
- [ ] T094 [US4] Implement the import run endpoints shared with CSV, in `apps/api/src/imports/import-runs.controller.ts`:
  - `GET /imports?status=running`, `GET /imports/{id}`, and `GET …/items?outcome=`;
  - `POST …/items/{itemId}/retry`;
  - `POST /properties/confirm` in the properties module: it moves `to_confirm` properties to `ready`, and returns the incomplete ones as `needs_details` (FR-004).

  Contracts go in `packages/contracts/src/imports.ts`
- [ ] T095 [US4] Implement the worker job `apps/worker/src/jobs/pms-import.ts` (`pms.import`):
  - **Run:**
    - decrypts the credential;
    - processes items in order and updates the progress.
  - **Per item:**
    - takes a creation slot, or is skipped with `plan_limit`;
    - maps the facts and suggests the time zone;
    - sets `to_confirm` or `needs_details`.
  - **Content:**
    - runs the detector on imported texts;
    - stores matches as encrypted `restricted_value` rows, and the rest through `ListingContentService` with source `pms`.
  - **Re-import:** upserts by `external_id`, keeping `edited_facts` and reviewed content.
  - **Stays:** creates the upcoming stays, with checkout from today to 365 days ahead. A re-import never restores a guest name removed on request.
  - **Revoked credential:** the remaining items fail with `reconnect_pms`.
  - **End:** logs `import.finished`, sets `notified_at`, and queues `properties.import_finished`
- [ ] T096 [US4] Implement the remaining PMS worker jobs:
  - `apps/worker/src/jobs/pms-refresh.ts` (`pms.refresh`):
    - a cron every 15 minutes; connections due every 3 hours; a singleton per connection; high priority for "Refresh now";
    - Beds24 uses `modifiedFrom` plus a daily full pass; Hostex reads the full window;
    - stays are upserted, cancelled, and deduplicated. A stay with `guest_name_removed_at` set never gets its guest name back (FR-053);
    - `not_found` listings are flagged;
    - the failure state, and the 24-hour `properties.pms_reconnect` email;
    - skips disconnected connections and removed properties;
  - `apps/worker/src/jobs/pms-listings.ts` (`pms.listings`);
  - `apps/worker/src/jobs/pms-revoke.ts` (`pms.revoke`)
- [X] T097 [P] [US4] Create the email templates `properties.import_finished` and `properties.pms_reconnect` (ES/EN) in `packages/emails/src/properties/`, as [contracts/emails.md](contracts/emails.md) describes:
  - counts, the first five failure reasons, and the provider label;
  - no credential, code, or guest name.

  Add render tests in `packages/emails/test/properties.test.ts`
- [ ] T098 [US4] Build the PMS import flow in `apps/portal/app/[locale]/(app)/properties/new/pms/page.tsx`:
  - `apps/portal/components/properties/pms-connect.tsx`:
    - the provider choice, from the enabled flags;
    - instructions, including the Beds24 link that pre-fills the read scopes;
    - the step-up dialog;
    - the credential field;
    - help for `invalid_credential`;
  - `apps/portal/components/properties/pms-listing-select.tsx`: all listings selected, capped at the remaining limit, with already-imported listings marked
- [ ] T099 [US4] Build the import progress views:
  - the banner `apps/portal/components/properties/import-progress-banner.tsx` in `apps/portal/app/[locale]/(app)/layout.tsx` ("Importing 12 of 40");
  - the run page `apps/portal/app/[locale]/(app)/properties/imports/[importRunId]/page.tsx`, with per-item results, reasons, and retry
- [ ] T100 [US4] Show imported properties in the list and detail:
  - `to_confirm` and `needs_details` badges with the missing facts;
  - "Confirm all";
  - the "not found in the PMS" flag;
  - the masked restricted values panel, `apps/portal/components/properties/restricted-values.tsx` (kind, label, and "••••"), hidden from agents
- [ ] T101 [US4] Build the integrations settings page `apps/portal/app/[locale]/(app)/settings/integrations/page.tsx`:
  - connections with their status and last refresh;
  - "Refresh now" and reconnect;
  - disconnect, with instructions to delete the token at the provider whenever the response has `providerRevoked: false`
- [ ] T102 [P] [US4] Add the US4 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`

**Checkpoint**: US4 works with recorded fixtures: connection, import, refresh, and disconnect.

---

## Phase 7: User Story 5 - Create many properties from a spreadsheet (Priority: P3)

**Goal**: A host downloads the CSV template in their language, uploads a filled file, sees
per-row errors, and creates only the valid rows.

**Independent Test**: Quickstart scenario 10. A file with valid and invalid rows shows errors by
row and column. The error file is safe to open, and only the valid rows become properties.

### Tests for User Story 5 ⚠️ (write first, must fail)

- [ ] T103 [P] [US5] Unit tests in `packages/domain/test/properties/csv.test.ts`:
  - Spanish and English header aliases, matched without case or accents (FR-037);
  - every row is validated, with all its errors by row, column, and code (FR-039);
  - time zones are validated;
  - duplicate rows, and rows matching an existing property, are warnings (FR-040);
  - the calendar link column is checked for HTTPS syntax only;
  - `neutralizeCell` prefixes cells that start with `=`, `+`, `-`, `@`, tab, or carriage return with `'` (FR-041)
- [ ] T104 [P] [US5] Sandbox tests in `apps/sandbox/test/csv.test.ts` (FR-038):
  - UTF-8 with and without a byte-order mark;
  - comma or semicolon, detected from the header line;
  - accented characters;
  - `#` instruction lines are skipped;
  - more than 500 rows, or more than 2 MB, is rejected before parsing;
  - a binary file is rejected
- [ ] T105 [P] [US5] Integration tests in `apps/api/test/integration/csv-import.test.ts`:
  - the template in Spanish and in English, with headers, one example row, and instructions;
  - 25 rows with 2 invalid → per-row errors and `awaiting_confirmation`. Confirming creates 23 properties as `to_confirm`, and "Confirm all" makes them `ready`;
  - more valid rows than free slots → `rowNumbers` is required (US5 scenario 5);
  - cancelling a run clears every `calendar_url_ciphertext` of its items;
  - the error file neutralizes `=HYPERLINK("https://evil.example")` (AC-SEC-006) and leaves calendar link cells empty;
  - a link with an invalid format is a column error at validation, and the row can still be created without it (FR-042);
  - the calendar link is stored only as ciphertext. The feed is created after the property, and a link rejected then becomes a column error on that row; the property keeps no feed, and the row appears in the error file (FR-042);
  - after the import, no `import_item` holds a calendar link;
  - the CSV object is deleted after validation;
  - agents are refused;
  - 200 rows are validated within 10 seconds (SC-005)
- [ ] T106 [P] [US5] End-to-end test in `e2e/specs/properties-us5-csv.spec.ts` (quickstart 10)

### Implementation for User Story 5

- [ ] T107 [US5] Implement `packages/domain/src/properties/csv.ts`:
  - the canonical columns, with Spanish and English aliases;
  - row validation, reusing `core-facts.ts` and `time-zones.ts`;
  - warnings;
  - `neutralizeCell`
- [ ] T108 [US5] Add the CSV mode to the file processor in `apps/sandbox/src/file-processor/csv.ts`: `csv-parse`, byte-order mark handling, delimiter detection, and the size and row limits
- [ ] T109 [US5] Implement the CSV endpoints in `apps/api/src/imports/csv.controller.ts`:
  - `GET /imports/csv-template?lang=`: generated with `csv-stringify`, with the instructions as `#` lines (decision 4);
  - `POST /imports/csv`: creates the run and the presigned form, up to 2 MB;
  - `POST …/validate`: `202`, and queues `csv.validate`;
  - `POST …/confirm`: `rowNumbers` within the free slots, and queues `csv.import`;
  - `POST …/cancel`: also sets every `calendar_url_ciphertext` of the run's items to null;
  - `GET /imports/{id}/error-file?lang=`: every row with an error, including created rows whose calendar link was rejected; localized reasons, neutralized cells, and empty calendar links. Available for 7 days after the run finishes
- [ ] T110 [US5] Implement the worker jobs in `apps/worker/src/jobs/csv.ts`:
  - **`csv.validate`:**
    - parses the file through the sandbox and validates the rows;
    - stores each `import_item`, with `row_values` without the link and the link in `calendar_url_ciphertext`;
    - deletes the file.
  - **`csv.import`:**
    - creates the selected valid rows as `to_confirm` or `needs_details`, within the free slots;
    - then reads and saves each calendar link through the feed path, adding a column error when the link is rejected, and sets the item's `calendar_url_ciphertext` to null either way;
    - logs `import.finished`, and queues the email with the source "CSV"
- [ ] T111 [US5] Build the CSV flow in `apps/portal/app/[locale]/(app)/properties/new/csv/page.tsx` with `apps/portal/components/properties/csv-import.tsx`, loading the preview on demand:
  - the template download in the host's language;
  - upload from a phone;
  - errors by row and column, and the error file download;
  - the choice of rows within the limit;
  - create or cancel
- [ ] T112 [P] [US5] Add the US5 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`: column names and error reasons

**Checkpoint**: US5 works: template, validation, error file, and creation of valid rows.

---

## Phase 8: User Story 6 - Duplicate or remove a property (Priority: P3)

**Goal**: Owners and admins duplicate a property without its address, feeds, stays, codes, or
PMS link. They remove a property with a typed name and step-up, and can restore it within 30
days.

**Independent Test**: Quickstart scenario 11. A duplicate has the copied facts and content and
none of the excluded data. A removed property is restored.

### Tests for User Story 6 ⚠️ (write first, must fail)

- [ ] T113 [P] [US6] Integration tests in `apps/api/test/integration/property-lifecycle.test.ts`:
  - **Duplicate:**
    - `duplicate-draft` returns the facts without the address, the content, and the name "Copy of …";
    - it carries no feeds, stays, restricted values, or PMS link (FR-043);
    - `POST /properties` with `duplicateOf` creates a property with source `duplicate`, and content with source `duplicate`.
  - **Remove:**
    - a wrong typed name → `409 confirmation_mismatch`;
    - no step-up → `step_up_required` (AC-SEC-007);
    - `?dryRun=true` lists the upcoming stays;
    - `property.removed` is logged.
  - **While removed:**
    - the property does not count toward the limit;
    - its feeds and PMS refreshes make no request (AC-SEC-011);
    - `?status=removed` works only for owners and admins.
  - **Restore:**
    - restore works within 30 days when a slot is free, and logs `property.restored`;
    - with no free slot → `409 plan_limit_reached`.
  - **Agents:** duplicate, remove, and restore are refused (AC-SEC-001)
- [ ] T114 [P] [US6] Worker test in `apps/worker/test/purge-properties.test.ts`:
  - after `purge_after`, the property, its stays, content, feeds, and restricted values are deleted, and `property.purged` is logged;
  - before it, nothing is deleted
- [ ] T115 [P] [US6] End-to-end test in `e2e/specs/properties-us6-lifecycle.spec.ts` (quickstart 11)

### Implementation for User Story 6

- [ ] T116 [US6] Implement `GET /properties/{id}/duplicate-draft` and `duplicateOf` handling in `apps/api/src/properties/`: copy the facts except the address, copy the content, and set `duplicated_from_id`
- [ ] T117 [US6] Implement removal and restore in `apps/api/src/properties/`, and make feed and PMS refresh selection skip removed properties:
  - `DELETE /properties/{id}`: the typed name, step-up, `dryRun`, `status = removed`, `purge_after` = +30 days, and `property.removed`;
  - `POST /properties/{id}/restore`: the slot check, and `property.restored`
- [ ] T118 [US6] Implement the daily worker job `apps/worker/src/jobs/purge-properties.ts` (`properties.purge`)
- [ ] T119 [US6] Build the duplicate and remove actions:
  - the duplicate action opens the confirmation step with the draft;
  - the removal dialog `apps/portal/components/properties/remove-property-dialog.tsx`: typed name, upcoming stays warning, and step-up;
  - the list of removed properties, with restore and the days left
- [ ] T120 [P] [US6] Add the US6 strings (ES/EN) to `packages/i18n/messages/es.json` and `en.json`

**Checkpoint**: All six stories work on their own.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Retention, the security review, performance, accessibility, docs, and validation.

- [ ] T121 Implement the worker job `apps/worker/src/jobs/retention.ts` (`retention.daily`), with a test in `apps/worker/test/retention-job.test.ts` (data model §6):
  - clears extraction `input_text` and `recognized_text` 7 days after the request;
  - sets `stay.guest_name` to null 12 months after `checkout_date` (pending OQ-35);
  - deletes expired `upload` rows and their objects;
  - cancels CSV runs left in `awaiting_confirmation` for more than 7 days;
  - sets `import_item.row_values` to null 7 days after the run finishes, and clears any `calendar_url_ciphertext` left on finished or cancelled runs
- [ ] T122 [P] Write the security review sweep in `apps/api/test/integration/security-review-002.test.ts` (quickstart 12, SC-003):
  - run every flow with known secrets: a feed link, a PMS token, codes, guest names, and a guest email;
  - assert that none appears in API or worker logs, spans, Sentry events, responses, or emails;
  - assert the same `404` across workspaces on every new route (AC-SEC-009)
- [ ] T123 [P] Extend `apps/api/test/integration/cross-tenant.test.ts` to the new routes and the `calendar_feed_public` view
- [ ] T124 [P] Add the performance checks from the [Performance Budget](plan.md#performance-budget):
  - the property routes in `lighthouserc.json`;
  - `apps/portal/bundle-budget.json`: at most 150 KB of initial JavaScript per route, with `image-normalize` and the CSV preview loaded on demand;
  - `perf/k6/properties.js`: list, detail, stays, listing content, and import status, at p95 ≤ 300 ms;
  - timing tests: saving a feed at p95 ≤ 12 s, and extraction within 60 s;
  - a PMS import of 50 listings finishes within 10 minutes (SC-004), in `apps/api/test/integration/pms-import.perf.test.ts`, with a simulated clock and the fixture adapters' recorded latency and credit limits;
  - validating a PMS credential and listing the listings takes 15 s or less at p95, with the providers' recorded latency;
  - a 500-row CSV is validated within 30 seconds (R10);
  - "Refresh now" for a PMS connection is applied within 1 minute (SC-006)
- [ ] T125 [P] Extend `e2e/specs/a11y.spec.ts` to the new screens: the list, the starting options, the listing flow, the confirmation step, calendars, stays, PMS import, CSV, and removal
- [ ] T126 [P] Update the docs:
  - SEC-09 in `docs/architecture/security.md`: "an isolated fetcher with no route to internal services" (R2);
  - the service table in `docs/architecture/adr/0009-mvp-hosting-and-transactional-email.md`: the uploads bucket, the KMS key, the sandbox functions, and GuardDuty Malware Protection;
  - FR-02.5 in `docs/product/prd.md`: replace "keep them in sync" with the read-only reservation refresh;
  - flow 5.4 in `docs/architecture/overview.md`: drafting the guide belongs to spec 003
- [ ] T127 [P] Document the new commands in `README.md`: `pnpm tz:check`, the eval command, and the iCal fixture server
- [ ] T128 Run the scenarios 1 to 12 of `specs/002-property-onboarding/quickstart.md` locally, and record the results under "Implementation notes" in `specs/002-property-onboarding/tasks.md`
- [ ] T129 Close the production gates (founder) and record each outcome in R15 of `specs/002-property-onboarding/research.md`:
  - OQ-26: written confirmation from Beds24 and from Hostex, before `PMS_BEDS24` or `PMS_HOSTEX` is turned on;
  - the R3 gate (T057), before `EXTRACTION_SCREENSHOTS` is turned on;
  - real Booking.com and Vrbo iCal exports added to the classification fixtures (R8);
  - the GuardDuty plan enabled on the uploads bucket (R9);
  - the PMS fixtures replaced with recordings from test accounts, only if T082 had to start from synthetic fixtures;
  - the quickstart run on staging

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. Start immediately.
- **Foundational (Phase 2)**: Depends on Setup. Blocks every user story.
- **User Stories (Phases 3–8)**: Depend on Foundational.
- **Polish (Phase 9)**: Depends on the stories you ship.

### User Story Dependencies

- **US1 (P1)**: After Foundational. No dependency on other stories.
- **US2 (P1)**: After US1. It ends on the confirmation step and on `POST /properties`.
- **US3 (P2)**: After US1. It needs a property, not the extraction.
- **US4 (P2)**: After US1 and US3. Imported reservations use the stays model, the stays list, and
  deduplication. This matches the spec.
- **US5 (P3)**: After US1, US3, and US4. It reuses the import run endpoints and bulk confirm from
  US4, and the feed path from US3 for the calendar link column.
- **US6 (P3)**: After US1. Its exclusion tests use feeds and stays (US3) and restricted values
  (US4), so run it after those for full coverage.

### Within Foundational

- The schema (T013) comes before the RLS migration (T014), and the RLS test must fail
  before T014.
- `KeyManagementPort` comes before the vault (T019), and the vault before the lint rule.
- The detector (T017) comes before listing content (T028).
- `SandboxPort` (T023) is independent of the vault and storage work.

### Within Each User Story

- Tests are written first and must fail.
- Domain, then contracts, then API modules and worker jobs, then portal screens, then strings.
- The story is complete before moving to the next priority.

### Parallel Opportunities

- Setup: every task marked [P] after the workspace change.
- Foundational: the four test tasks; then the event catalog, limits, KMS port, storage port,
  sandbox port, errors, job queue, helpers, span helper, and portal pieces.
- Within each story: all test tasks marked [P], then the domain, contracts, and email templates.
- Sandbox work (feed reader, file processor, CSV) can proceed in parallel with API work once
  `SandboxPort` exists.

---

## Parallel Example: User Story 3

```bash
# Tests for US3 together:
Task: "Unit tests for feed classification in packages/domain/test/properties/feeds.test.ts"
Task: "Unit tests for stays in packages/domain/test/properties/stays.test.ts"
Task: "Sandbox SSRF tests in apps/sandbox/test/feed-reader.test.ts"
Task: "Integration tests in apps/api/test/integration/calendar-feeds.test.ts"
Task: "Integration tests in apps/api/test/integration/stays.test.ts"
Task: "Worker tests in apps/worker/test/calendar-refresh.test.ts"

# Then, in parallel:
Task: "Feed reader in apps/sandbox/src/feed-reader/"
Task: "Email template in packages/emails/src/properties/feed-failing.tsx"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Setup and Foundational.
2. Complete US1 (blank start, confirmation, list) and validate it on its own.
3. Complete US2 (listing text and screenshots, with codes removed) and run the eval suite.
4. **Stop and validate**: quickstart 1–6. Screenshots stay behind their flag until the R3 gate
   passes.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → demo.
3. US2 → validate and run the evals → the MVP: the two creation paths individual hosts need.
4. US3 → stays from calendars and by hand.
5. US4 → PMS import behind flags, until OQ-26 closes.
6. US5 → CSV.
7. US6 → duplicate and remove.
8. Polish → security review, performance, docs, and the production gates.

### Notes

- [P] tasks touch different files and have no dependency on an unfinished task.
- Commit after each task or logical group, and stop at any checkpoint to validate.
- Leave the untracked " 2" duplicate files out of every commit.
