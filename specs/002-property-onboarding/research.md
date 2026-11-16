# Research: Property Onboarding

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-15

Each entry gives the decision, the rationale, and the alternatives considered. Provider facts
were checked against the providers' own documentation on 2026-11-15; anything not verified
first-hand is marked **unverified**.

## R1. Modules and ports

- **Decision:** the feature adds these pieces to the existing monorepo:
  - **Domain (`packages/domain`):** core-fact validation and setup status, the restricted-value
    detector (R4), feed-entry classification and stay deduplication (R8), CSV row rules (R10),
    time zone suggestion (R11), and limits (R12). Pure TypeScript, no I/O.
  - **Ports and adapters (`packages/integrations`):** `PmsPort` (Beds24, Hostex), `LlmPort`
    (Anthropic), `KeyManagementPort` (AWS KMS, local), `ObjectStoragePort` (S3, local
    filesystem), and `SandboxPort` (Lambda, in-process) for the isolated functions in R2.
  - **Encryption (`packages/vault`, new):** envelope encryption over `KeyManagementPort` (R5),
    used by the API and the worker.
  - **Sandbox (`apps/sandbox`, new):** two small Lambda handlers that touch untrusted bytes (R2).
  - **API modules:** `properties`, `stays`, `calendar-feeds`, `extractions`, `imports`, `pms`,
    `uploads`, `time-zones`.
  - **Worker jobs:** extraction, CSV validation and import, PMS import and refresh, calendar
    refresh, retention, and property purge (R13).
- **Rationale:** constitution IV (no provider in the domain core) and the layout in the
  architecture overview. The domain stays testable without a database or network.
- **Alternatives:** putting encryption inside `packages/integrations` was rejected: the vault is
  used by every module that stores restricted data, and keeping it separate makes its imports
  easy to audit.

## R2. Isolated sandbox for untrusted content (SEC-09, SEC-10)

- **Decision:** host-supplied URLs and uploaded files are handled only by two AWS Lambda
  functions that are **not attached to the VPC**, so they have internet access but no route to
  RDS, the API, or the worker:
  - **`feed-reader`:** fetches one iCal link and returns normalized entries
    `{uid, start, end, kind: reservation | block | unlabeled}`, plus `etag` and
    `lastModified`. Summaries, descriptions, reservation links, and phone digits never leave the
    function (FR-022). It has **no IAM permissions** at all.
  - **`file-processor`:** reads one uploaded object, checks its real type by magic bytes,
    re-encodes images with `sharp` (which strips EXIF and GPS), runs text recognition (R3), or
    parses a CSV file (R10), and returns text or rows. Its IAM role can only read and delete
    `uploads/*` in the uploads bucket.
  - The worker and the API call them through `SandboxPort` with a synchronous invoke (response
    limit 6 MB). Inputs and outputs are never logged.
- **SSRF rules inside `feed-reader`:** HTTPS only. DNS is resolved first, and any private,
  loopback, link-local (including `169.254.0.0/16`, which holds Lambda's metadata endpoint),
  carrier-grade NAT, multicast, or IPv6 unique-local address is refused. The check runs again
  on every redirect (at most 3), and the connection is pinned to the checked address. Limits: 2
  MB and 10 seconds. Uses `undici` with a custom `lookup` and `ipaddr.js`.
- **Rationale:** SEC-09 asks for a fetcher with no route to internal services, which the current
  worker cannot satisfy because it talks to the database. Lambda outside a VPC gives that
  boundary with the same language and the same deploy tool (SST already deploys Lambdas for
  OpenNext). Credentials are only in environment variables; `feed-reader` gets a role with no
  permissions, so even a leak exposes nothing.
- **Local and test:** `InProcessSandbox` runs the same handler code inside the worker, with a
  fake DNS resolver for the SSRF tests. To reach the local iCal fixture server, test and
  development configs may allowlist that single host (`SANDBOX_TEST_ALLOW_HOST`) with a
  test-only certificate authority. The config loader refuses that setting in staging and
  production.
- **Alternatives:**
  - Fetching from the worker with an IP blocklist only: rejected, because one bypass would reach
    the database network.
  - A separate ECS service in an isolated subnet: rejected as more infrastructure for the same
  boundary.
- **Docs follow-up:** SEC-09 in the security architecture says "fetched only by the worker".
  Tasks update it to "an isolated fetcher with no route to internal services".

## R3. Text recognition for screenshots

- **Decision:** **Tesseract** (`tesseract.js`, Apache-2.0, WebAssembly) with the Spanish and
  English models, running inside `file-processor` (R2), behind a `TextRecognitionPort`.
  - Images are normalized first: grayscale PNG, longest side at most 2,560 px.
  - Screenshots run in parallel, one invocation each, to stay inside the 60-second budget
    (FR-016).
  - **Gate:** an early task measures character accuracy on 30 sample screenshots (15 Spanish, 15
    English). The target is 95% or more. Below that, the alternative adapter is used.
- **Alternative kept behind the same port:** Amazon Textract `DetectDocumentText`.
  - It costs $0.0015 per page in us-east-1 and has a VPC endpoint.
  - **Spanish support is unclear:** the supported-languages page lists text detection as
    English-only, while a 2 Nov 2026 announcement says a new model with 40+ languages, Spanish
    included, applies to it.
  - It accepts only JPEG, PNG, PDF, and TIFF, up to 10 MB.
  - Using it requires an AWS Organizations AI-services opt-out policy so that hosts' screenshots
    are not used to improve the service.
- **Rationale:** the clarification requires a recognition step that is not the AI. Tesseract
  adds no vendor or service, keeps screenshots inside Guidesk's own functions, and works well on
  rendered UI text, which is what listing screenshots are.
- **Alternatives:** sending images to Claude (vision) was rejected by the 2026-11-15
  clarification. OCR in the browser was rejected: it adds megabytes to the portal and fails the
  bundle budget.

## R4. Restricted-value detection before any AI call

- **Decision:** a deterministic detector in `packages/domain`, run on pasted text, recognized
  text, and imported PMS text **before** the text is stored or sent to the AI (FR-012, FR-031).
  - It looks for keyword families in Spanish and English: código, clave, contraseña, PIN, puerta,
    portón, caja de seguridad, alarma, Wi-Fi, red, door, gate, lockbox, keypad, alarm, password,
    passcode, network. A value is a nearby token of 4 to 12 characters (digits, or a mix of
    letters and digits) on the same line or after a colon. Wi-Fi network names are kept;
    passwords are removed.
  - Each match is replaced with a marker such as `[door code removed]`, and the response reports
    counts per kind (US2 scenario 2).
  - For PMS text, a match is not discarded: it is stored as a `restricted_value` (encrypted) with
    its `source_field`, and removed from the listing content.
  - The same detector runs on the AI's output, and on listing content the host edits, as a
    second line of defense (FR-013).
- **Test corpus:** at least 60 labeled snippets in Spanish and English: codes in many phrasings,
  plus look-alikes that must survive (prices, phone numbers, street numbers, check-in times, and
  room counts). The target is recall of 100% on the corpus. False positives are acceptable
  because the host is told what was removed.
- **Rationale:** the AI cannot be the detector, because then the AI would see the code. A rules
  engine is auditable and testable.
- **Alternatives:** a local named-entity model was rejected as a new runtime with no clear
  accuracy gain on this narrow pattern.

## R5. Field-level encryption (SEC-06)

- **Decision:** envelope encryption with **AWS KMS** (ADR-0009), first used by this feature.
  - **One customer-managed KMS key** for restricted data, with yearly rotation.
  - **Data keys:** one active data key per workspace, created with `GenerateDataKey`. Only the
    wrapped copy is stored, in `workspace_data_key`, with encryption context
    `{workspace_id: <id>}`.
  - **Values:** AES-256-GCM with a random 96-bit IV. The additional authenticated data is
    `workspace_id|table|column|row_id`, so a ciphertext copied to another row fails to decrypt.
    The stored format is `version || iv || ciphertext || tag`.
  - **Key policy:** `GenerateDataKey` and `Decrypt` require the `workspace_id` encryption-context
    key (`kms:EncryptionContextKeys` with `ForAnyValue:StringEquals`). Only the API and worker
    task roles may use the key.
  - **Caching:** unwrapped data keys stay in memory for at most 5 minutes, which keeps KMS calls
    low ($0.03 per 10,000 requests; $1 per key per month).
- **Who decrypts:** only the worker, to read PMS credentials and feed links during imports and
  refreshes. The API encrypts but never reads plaintext back. A lint rule limits imports of the
  vault's `decrypt` to worker modules. Imported codes are never decrypted in this feature; the
  reveal flow is spec 003.
  - Two API routes need a stored credential: listing PMS listings again, and revoking a Beds24
    token on disconnect. The API sends a worker job and waits up to 15 seconds for its output,
    so it still never decrypts.
- **Local and test:** `LocalKeyManagement` wraps data keys with a key from the environment, used
  only in development and CI.
- **Alternatives:**
  - `pgcrypto` in the database: rejected, because the key would sit next to the data (SEC-06).
  - KMS `Encrypt` per value: rejected because of cost and latency on bulk imports.

## R6. Listing extraction with Claude

- **Decision:** one structured call per extraction through `LlmPort` (ADR-0005).
  - **Model:** `claude-opus-5-5` with `output_config.effort: "low"`, the ADR-0005 default. A
    cheaper model needs the eval suite and the founder's approval, as that ADR says.
  - **Structured output:** `client.messages.parse` with
    `output_config.format: zodOutputFormat(ExtractionSchema)`. The schema holds title,
    description, house rules, amenities, proposed facts (check-in and checkout times, maximum
    guests), and the detected language. Every field is nullable, so "not found" is valid and
    nothing has to be invented (FR-010). Check `stop_reason` before reading the result, and use
    the server-side refusal fallback from ADR-0005.
  - **Prompt-injection defense (FR-014, AC-SEC-004):** the system prompt says the input is listing
    data, never instructions. The text goes in a delimited block, the model has no tools, and the
    output is limited to the schema. URLs in the output are kept only as plain text marked for
    review, and nothing is ever published by this flow.
  - **Input:** only redacted text (R4). Images never reach the model (R3). No guest data is sent.
  - **Budget:** a 60-second time limit for the whole job (FR-016). The input is at most 20,000
    characters of text, about 6,000 tokens, so a call costs about $0.03–0.06 at list prices.
- **Evals (constitution V, SC-002):** `evals/extraction/` holds 30 sample listings (15 Spanish,
  15 English) with expected fields. The suite scores field placement (≥ 90%), invented facts (0),
  and injection resistance (5 injection cases). Changes to the prompt, schema, model, or effort
  must pass it before merge. CI runs it on every pull request (constitution V), with the API key
  as a repository secret. One run is 35 calls, about $1–2.
- **Test data:** the repository is public, so the sample listings, and the screenshots rendered
  from them, are synthetic: written for the suite, with no copied listing text, real addresses,
  host or guest names, or real codes.
- **Alternatives:** tool use with a strict tool was rejected because structured output is simpler
  and returns the same guarantee for a single extraction.

## R7. PMS adapters: Beds24 and Hostex

Both adapters implement `PmsPort`: `validateCredential`, `listListings`, `getListing`,
`listReservations`, and `revoke`. Each adapter parses provider responses with an **allowlist
schema**, so fields such as guest email, phone, notes, lock codes, and custom fields are dropped
at the boundary and never stored or logged (FR-030). Contract tests run against recorded fixtures
(constitution IV).

### Beds24 (API V2, `https://beds24.com/api/v2`)

- **Credential:** the host creates an **invite code** in Beds24 (Settings → Marketplace → API)
  with the scopes `read:properties`, `read:bookings`, and `read:bookings-personal`. The portal
  offers a link that pre-fills those scopes. The code lasts 24 hours.
  - Guidesk exchanges it once (`/authentication/setup`) for a refresh token and stores only the
    refresh token, encrypted.
  - Access tokens (24 hours) are cached in memory and never stored.
  - The refresh token stays valid while it is used at least every 30 days, which the 3-hour
    refresh guarantees.
  - On disconnect, Guidesk calls `DELETE /authentication/token` and then deletes its copy
    (SEC-13). If that call fails or takes more than 15 seconds, the copy is deleted anyway, and
    the host is told to remove the token in Beds24.
  - `read:bookings-personal` is needed for guest names (the 2026-11-15 decision) and also exposes
    contact data. The adapter drops that data.
- **Mapping:**
  - **Listing:** one Guidesk property per Beds24 **room type**, because room types are what the
    channels list. `external_id` = `{propertyId}:{roomTypeId}`. The name is the property name,
    plus the room type name when the property has several.
  - **Facts:** address, city, state, postcode, and country come from the property. Check-in and
    checkout times come from `checkInStart` and `checkOutEnd`. Maximum guests comes from the room
    type's `maxPeople`.
  - **Time zone:** Beds24 has no time zone per property, so the domain suggests one from country
    and city (R11). An ambiguous result leaves the property in `needs_details`.
  - **Content:** `texts` (headline, property description, house rules) and room descriptions,
    in each available language. `featureCodes` are mapped to amenity labels through a static
    table; unknown codes are dropped.
  - **Not imported:** templates 1–8, unit notes, info items, custom fields, and channel settings,
    which are where hosts and lock integrations put codes. Imported texts still go through the
    detector (R4).
  - **Bookings:** `confirmed` and `new` become `active`; `cancelled` becomes `cancelled`;
    `request`, `inquiry`, and `black` (blocked) are skipped. The guest count is `numAdult` +
    `numChild`. The guest name is first and last name. The booking reference is the Beds24
    booking ID. The channel comes from `referer`.
- **Rate limits:** 100 credits per 5 minutes per Beds24 account, **shared with the host's other
  tools**. The adapter reads the credit headers (`X-FiveMinCreditLimit-Remaining` and the
  `x-five-min-limit-*` variant), never spends below 30 remaining credits, and waits for the reset
  instead (edge case: rate limits).
  - The import uses one paged `GET /properties?includeTexts=all` and one paged `GET /bookings`
    for all selected properties.
  - Refreshes use `modifiedFrom = last refresh` with every status, plus a daily full pass with
    `departureFrom = today`.
- **Terms (OQ-26):** the invite-code flow is documented for third parties, and no developer
  registration is needed. **Unverified:** whether commercial use without a Marketplace partnership
  is allowed. Production use waits for written confirmation from Beds24 support.

### Hostex (Open API v3, `https://api.hostex.io/v3`)

- **Credential:** the host creates an access token in Hostex (OpenAPI settings) with the
  **read-only** scope; it requires the Hostex Pro edition. Guidesk sends it in the
  `Hostex-Access-Token` header and checks the result with `GET /accounts/me`, which also gives
  `external_account_id`. HTTP status is always 200, so the adapter reads `error_code`.
  - Tokens do not expire, and **Hostex has no endpoint to revoke them**. Disconnect deletes
    Guidesk's copy and tells the host to delete the token in Hostex.
- **Mapping:**
  - **Listing:** one Guidesk property per Hostex property. `external_id` = the property ID.
  - **Facts:** name from `title`, and `address` into the street line. Hostex provides no time
    zone, check-in or checkout times, maximum guests, description, house rules, or amenities.
    Hostex properties therefore arrive in `needs_details` with the missing facts listed.
  - **Partial help:** for Airbnb-linked listings, `GET /listings/airbnb/price_and_rules` gives
    check-in and checkout times. Its `max_guests` is the base-price guest count, not the maximum,
    so it is not used.
  - **Reservations:** `accepted` becomes `active`; `cancelled`, `denied`, and `timeout` become
    `cancelled`; `wait_accept` and `wait_pay` are skipped until accepted. The guest count is
    `number_of_guests`, the guest name is `guest_name`, and the booking reference is
    `reservation_code`. Dropped: phone, email, `guests[]`, remarks, custom fields, and
    `check_in_details` (which holds lock codes).
- **Rate limits:** generous (600 per minute per endpoint, 100,000 per day per account). Pages hold
  up to 100 items. There is no "updated since" filter, so each refresh reads reservations with
  checkout from today to 365 days ahead.
- **Terms (OQ-26):** the access token is "the standard way" to use the API, and Hostex's help
  center shows hosts pasting tokens into third-party apps. **Unverified:** explicit permission
  for commercial third-party use. Production use waits for written confirmation from Hostex
  support.

### Rollout

Each provider sits behind a feature flag (`pms.beds24`, `pms.hostex`), off in production until
OQ-26 is closed for that provider. Development and staging use recorded fixtures and test
accounts.

## R8. Calendar feeds

- **Parsing:** `ical.js` (Mozilla, MPL-2.0) inside `feed-reader`. Only `VEVENT` entries with
  `DTSTART` and `DTEND` dates are kept; past entries are dropped.
- **Classification (FR-022):** a keyword table in the domain:
  - **Reservation:** "Reserved", "Reservado", or a summary carrying a guest or booking reference.
  - **Block:** "Not available", "Blocked", "No disponible", "Bloqueado", and Airbnb's "Airbnb
    (Not available)".
  - **Unlabeled:** anything else, for example a summary like "CLOSED - Not available" when the
    channel uses it for every closed date. Unlabeled entries become stays with
    `may_be_block = true`. The exact Booking.com wording is **unverified**; fixtures from real
    exports are collected before launch.
- **Refresh:** a pg-boss cron every 15 minutes enqueues feeds whose last success is older than
  3 hours (FR-023). It spreads them by feed ID so they do not all run at once. Each feed has a
  singleton key, so one feed never runs twice in parallel. Conditional requests use `ETag` and
  `Last-Modified`. "Refresh now" enqueues at high priority.
- **Changes:** entries missing from a successful read are marked `cancelled` (FR-023). A failing
  read keeps the last known stays and sets `failing_since`. After 24 hours, owners and admins get
  one email (FR-024).
- **Deduplication (edge cases):** a PMS stay wins over a feed stay with the same property and
  dates. An unlabeled entry that matches a labeled reservation from another feed is marked as a
  duplicate.
- **Saving a link (FR-021):** the API calls `feed-reader` synchronously (10-second limit) before
  storing anything, so a rejected link is never saved.

## R9. Uploads

- **Decision:**
  - **Bucket:** a private S3 bucket on its own origin (SEC-11), encrypted with SSE-KMS. Public
    access is blocked, CORS allows only the portal origin, and a lifecycle rule deletes objects
    after 1 day (FR-015 backstop).
  - **Upload:** the browser sends files straight to the bucket with presigned POST forms. Each
    form fixes the key, the content type, and the size range, and expires in 10 minutes.
  - **Client normalization:** the portal re-encodes each image to JPEG with the canvas API
    before upload. This shrinks large photos, strips metadata early, and converts HEIC on Apple
    devices, whose browsers decode HEIC. A browser that cannot decode a HEIC file asks for a JPEG
    or PNG instead.
  - **Server check:** `file-processor` verifies magic bytes (JPEG, PNG, or WebP), re-encodes, and
    rejects anything else (AC-SEC-005). Objects are deleted right after processing.
  - **Malware scanning:** Amazon GuardDuty Malware Protection for S3 on the bucket, with object
    tagging enabled. It costs $0.09 per GB and $0.215 per 1,000 objects. Scans are **not
    blocking** in this feature: these files are never served to anyone, and images are decoded
    and re-encoded before use. `THREATS_FOUND` results go to the operations alert topic. Spec
    003, where documents are served to guests, will block on the scan result.
- **Rationale:** SEC-10 controls with no file bytes passing through the API, and nothing kept
  longer than 24 hours.
- **Alternatives:** ClamAV in a container was rejected: one more image to patch, with signature
  updates to run, for files that are never served.

## R10. CSV import

- **Parsing:** `csv-parse` inside `file-processor`, with BOM handling and the delimiter chosen by
  counting commas and semicolons in the header line (FR-038). Rows above 500, or files above
  2 MB, are rejected before parsing.
- **Headers:** Spanish and English aliases map to canonical columns (FR-037), case- and
  accent-insensitive. The template is generated per language with one example row and
  instructions. The instructions are leading lines that start with `#`, which the parser skips.
- **Validation:** domain rules per row (FR-039) run in the worker. All errors are collected,
  never just the first. Duplicate rows and matches with existing properties are warnings
  (FR-040). Calendar links are checked for format at validation; an invalid link is an error
  for that column only, and the row can still be created without it. Links are read only after
  the property is created, under FR-020 to FR-026; a link rejected then is reported as a column
  error on that row (FR-042).
- **Error file:** written with `csv-stringify`. Any cell starting with `=`, `+`, `-`, `@`, tab,
  or carriage return is prefixed with `'` (FR-041, AC-SEC-006). Calendar-link cells are left
  empty (data model §4).
- **Timing:** SC-005 asks for 200 rows validated within 10 seconds, and the performance doc for
  500 rows within 30 seconds. Parsing is in-memory, so the budget goes to queue pickup and the
  sandbox call.

## R11. Time zone suggestion without an outside service

- **Decision:** a generated reference file in `packages/domain`, served only by the API:
  - **Country to zones:** from the IANA time zone database's `zone1970.tab`. A single-zone
    country (for example CR) gets its zone directly.
  - **City to zone:** for countries with several zones, from the GeoNames `cities15000` dataset
    (CC BY 4.0, attribution in the repository's notices), filtered to those countries.
    Accent-insensitive matching on the name and its alternate names.
  - **Fallback:** when the city is not found, the API returns the country's zones for the host
    to choose from (2026-11-15 clarification).
  - A script regenerates the file; CI checks that every zone exists in the runtime's
    `Intl.supportedValuesOf("timeZone")`.
- **Rationale:** no address leaves Guidesk, and there is no new vendor or cost. Daylight saving
  is handled by `Intl` at display time.
- **Alternatives:** a map service was rejected by the clarification. A country-only list fails
  for Mexico, Brazil, the United States, Chile, Spain, and Portugal.

## R12. Limits and the MFA threshold

- **Property limit (FR-047):** `workspace.property_limit` (pilot, set by staff), else 2 (Free
  plan). Every creation path locks the workspace row, counts `active` properties, and inserts in
  the same transaction, so parallel imports and creations cannot exceed it.
- **Extraction limit (FR-017):** `max(10, 2 × property limit)` per workspace per UTC day, in the
  existing `rate_limit_bucket` (no Redis).
- **"Refresh now" limits:** 5 minutes per property for feeds and per connection for PMS, stored
  as timestamps on the rows.
- **MFA threshold (FR-048):** `PropertyCountProvider` (spec 001) gets its real implementation:
  the count of `active` properties. Owners and admins of workspaces with 3 or more properties
  must have a second factor for the actions spec 001 lists.

## R13. Background jobs and notifications

| Queue | Trigger | Notes |
|---|---|---|
| `extraction.run` | API submit | Recognition in parallel, redaction, one AI call, result stored; 60-second time limit |
| `csv.validate`, `csv.import` | API | Validation, then creation of the confirmed rows |
| `pms.import` | API | One job per run; items processed in order with progress updates; credit-aware (R7) |
| `pms.refresh` | Cron every 15 minutes, or "Refresh now" | Connections due every 3 hours |
| `calendar.refresh` | Cron every 15 minutes, or "Refresh now" | Feeds due every 3 hours (R8) |
| `retention.daily` | Daily cron | Extraction input text after 7 days, guest names 12 months after checkout, CSV row values 7 days after the run, and unconfirmed CSV runs after 7 days |
| `properties.purge` | Daily cron | Removed properties after 30 days (FR-045) |

- **Notifications (FR-029, FR-024, FR-035):** emails through the existing outbox and React Email
  templates in Spanish and English ([contracts/emails.md](contracts/emails.md)). "In the portal"
  means the import progress banner and status badges on the property list. A notification
  center and web push arrive with spec 006.
- **Observability:** every job runs in an OpenTelemetry span with the workspace ID and counts.
  Restricted values and guest names are kept out of span attributes by the existing allowlist.
  Import and refresh failures are counted per provider and error code. Every sandbox call runs in
  a span with the function name, duration, and outcome code. The sandbox functions write
  structured JSON logs (request ID, error code, duration) and report errors to Sentry with the
  existing allowlist; their inputs and outputs are never logged.

## R14. Testing

- **Unit (domain):** core facts and setup status, the restricted-value corpus (R4), feed
  classification fixtures, CSV rules (BOM, semicolons, accents, formula cells), time zone
  suggestions, limits.
- **Contract (adapters):** Beds24 and Hostex against fixtures recorded from test accounts,
  including revoked tokens, rate-limit responses, and payloads with contact data that must be
  dropped. Cases a test account cannot produce may be synthetic and are marked as such. Recorded
  data is scrubbed: names, contacts, and codes are replaced with synthetic values before commit. Also Anthropic
  against a recorded response, S3 presigned forms, and KMS (local) round trips.
- **Integration (API and database, Testcontainers):**
  - RLS and cross-tenant tests on every new table (AC-SEC-009).
  - Role refusals (AC-SEC-001) and step-up (AC-SEC-007).
  - The plan limit under concurrency.
  - Restricted values never appearing in responses or logs (AC-SEC-003, AC-SEC-008).
  - SSRF cases through the in-process sandbox (AC-SEC-002).
  - Refresh skipping after disconnect or removal (AC-SEC-011).
  - Guest-data minimization (AC-SEC-012).
  - Read-only requests (AC-SEC-013).
  - Screenshot redaction (AC-SEC-014).
- **End to end (Playwright):** blank creation on a phone viewport, listing text with a fake
  `LlmPort`, a calendar feed served by a local fixture server, a PMS import with fixture
  adapters, the CSV flow, and duplicate and remove.
- **Evals:** the extraction suite (R6).

## R15. Rollout and open items

- **Feature flags:** `pms.beds24` and `pms.hostex` (OQ-26), and `extraction.screenshots`, on
  only after the R3 accuracy gate passes.
- **Before production:**
  - written confirmation from Beds24 and Hostex (OQ-26);
  - real Booking.com and Vrbo iCal fixtures (R8);
  - the GuardDuty plan enabled on the uploads bucket (R9).
- **Unchanged:** OQ-03 (which PMS the design partners use) may add or remove a provider later; the
  port keeps that change contained.
