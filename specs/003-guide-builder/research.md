# Research: Guide Builder

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Date**: 2026-11-17

Each entry gives the decision, the rationale, and the alternatives considered. This feature builds
on the pieces feature 002 shipped (sandbox, vault, uploads bucket, restricted-value detector,
`LlmPort`, eval harness); see [002 research](../002-property-onboarding/research.md). Provider
facts not checked first-hand against the provider's documentation on 2026-11-17 are marked
**unverified** and are covered by a gate in R22.

## R1. Modules and ports

- **Decision:** the feature adds these pieces to the monorepo:
  - **Domain (`packages/domain/src/guides/`):** the template and section kinds, the content
    document schema (R2), key topics and the coverage matcher (R10), completeness scoring, the
    translation segmenter and state rules (R7), publish checks (R13), the version snapshot
    builder (R12), and the shared-block resolver (R14). Pure TypeScript, no I/O.
  - **Ports and adapters (`packages/integrations`):**
    - `LlmPort` gains `draftFromListing`, `draftAnswer`, `suggestFromDocument`, and
      `translateBlocks` (R6).
    - New `SpeechToTextPort` with an Amazon Transcribe adapter and a fake (R8).
    - `SandboxPort` gains the `document`, `media`, and `audio` modes (R9).
    - `ObjectStoragePort` gains the media bucket and presigned GET URLs (R9).
  - **API modules (`apps/api/src`):** `guides` (sections, items, approvals, topics, preview,
    publish, versions), `locked-fields` (the only API module that decrypts, R4), `guide-media`,
    `guide-documents`, `interviews`, and `shared-blocks`.
  - **Worker jobs:** `guide.draft`, `guide.translate`, `interview.answer`, `guide.document`,
    `media.process`, `shared-block.publish`, and new rules in `retention.daily` (R15).
  - **Portal:** the guide screens H-12 to H-19 and H-29, with the editor loaded on demand (R3).
- **Rationale:** the same layering as feature 002 (constitution IV). The domain rules that decide
  what guests see (snapshots, coverage, publish checks) are testable without a database.
- **Alternatives:** a separate `packages/guide` package was rejected; the domain package already
  holds per-feature folders and the guide rules depend on property rules.

## R2. Content model: items with a rich-text document per language

- **Decision:** a section is an ordered list of **items**. Each item has a kind (`text`, `image`,
  `video`, `recommendation`, `fact`), a source label, a review state, topic tags, and, for every
  guide language, a **document**: a JSON tree in a fixed subset of the ProseMirror format.
  - **Allowed nodes:** `doc`, `paragraph`, `heading` (levels 3 and 4), `bulletList`,
    `orderedList`, `listItem`, `hardBreak`, `text`, and the inline `lockedField` node with one
    attribute, the locked field's ID.
  - **Allowed marks:** `bold`, `italic`, `link` with an `href` that must be `https:`, `http:`,
    `mailto:`, or `tel:`.
  - A Zod schema in `packages/contracts` validates every document on every write: unknown nodes,
    marks, or attributes are rejected, never stored. No HTML is stored anywhere.
  - Images and videos keep a short caption document; recommendations keep a description
    document; facts have none (their value comes from the property at view time, FR-006).
  - Size: at most 20,000 characters of text per section and language, counted over the plain
    text of its items (FR-010).
- **Rendering:** a small renderer in `packages/ui` turns documents into React elements (no
  `dangerouslySetInnerHTML`). Links get `rel="noopener noreferrer nofollow"`. The same renderer
  serves the preview here and the guest guide in spec 004 (SEC-11, AC-SEC-008).
- **Rationale:** items give each piece of content its own source label and review state (FR-005,
  FR-051), and let shared blocks, publishing, and translation work on whole pieces. A typed
  document makes sanitization a schema check instead of an HTML sanitizer.
- **Alternatives:** one HTML document per section, sanitized with DOMPurify, was rejected: review
  states would need markers inside the HTML, and an HTML sanitizer is a larger attack surface than
  a JSON schema. Markdown was rejected because inline locked-field references and strict link
  rules are harder to enforce in it.

## R3. Editor

- **Decision:** **Tiptap** (MIT, on ProseMirror) for text items, with only the extensions that
  match R2 (StarterKit pieces, Link, and a custom `lockedField` inline node rendered as a chip
  that shows the label). Pasted content is reduced to the schema by ProseMirror's parser.
  - The editor is loaded on demand (`next/dynamic`) only when a host opens a section, so the guide
    review page keeps its initial JavaScript under the 150 KB budget. The editor chunk is checked
    separately in the bundle check (≤ 120 KB gzip).
  - Autosave: changes are saved 1 second after typing stops. Unsent text is kept in
    `localStorage` per item, as the core-facts form does, and sent when the connection returns
    (FR-011, FR-070).
  - Mobile: a toolbar above the keyboard with bold, list, link, and "Insert locked field".
- **Rationale:** Tiptap produces the JSON format of R2 directly, has mature mobile support, and
  makes custom inline nodes simple.
- **Alternatives:** Lexical was rejected because its JSON format is its own, so the guest renderer
  and the translation segmenter would need a second schema. A plain textarea with Markdown was
  rejected for the reasons in R2 and because hosts on phones expect formatting buttons.

## R4. Locked fields and the reveal service

- **Decision:** locked fields extend feature 002's `restricted_value` table (the table name stays;
  the product calls them locked fields): a required label, `host` and `copy` sources, a nullable
  value (a duplicated property's fields arrive unset, FR-067), the section they belong to, and the
  public Wi-Fi option (FR-021). See [data model §2](data-model.md#2-locked-fields).
  - **Writes:** the API encrypts with the vault (002 R5), as before.
  - **Reveal:** a new `RevealService` in `apps/api/src/locked-fields/` is the only API file that
    may import `@guidesk/vault/decrypt`; the ESLint rule from 002 gets that single exception.
    SEC-06 already says "only the reveal and integration services decrypt".
  - The reveal endpoint needs step-up within 10 minutes (and MFA above the threshold), consumes
    the per-member limit of 20 reveals per hour (`rate_limit_bucket`, key
    `reveal:{workspace}:{user}`), writes `restricted_value.revealed` to the security log, and
    answers with `Cache-Control: no-store` (SEC-04). The portal hides the value after 60 seconds
    and on page change (FR-016).
  - Going over the limit writes `restricted_value.reveal_limited`, refuses with `429`, and emails
    the owners once per member and hour ([emails](contracts/emails.md)) (FR-018, AC-SEC-003).
  - **Public Wi-Fi password (FR-021):** switching to public decrypts once in `RevealService`,
    stores the value as plain text in `public_value`, and deletes the ciphertext; switching back
    encrypts it again. Both need step-up and are logged.
  - **Reveal history:** read from the security log, filtered by property and event type
    (FR-017). Owners and admins see it; agents get `404`.
- **Rationale:** reveal must return a value in one request. Running it through a worker job, as
  002 did for PMS listings, would write the plaintext into the job table.
- **Alternatives:** a separate reveal Lambda was rejected as more infrastructure for one route;
  the lint rule, the guard, and the single file keep the decrypting code auditable.

## R5. Codes never reach the AI

- **Decision:** feature 002's deterministic detector (002 R4) runs before **every** AI call in
  this feature: listing text, interview answers, transcripts, document and photo text, and text
  sent for translation.
  - **Extensions:** spelled-out digits in Spanish and English ("cuatro ocho dos uno", "four eight
    two one"), digit groups split by spaces or dashes ("48 21", "4-8-2-1"), and the phrasings the
    interview produces ("the code is…", "se abre con…"). The labeled corpus grows to at least 120
    snippets, recall 100%.
  - **Reversible masking for translation:** each match becomes a placeholder `{{R1}}` before the
    call and is put back unchanged afterwards (FR-025). Locked-field references never contain a
    value, so they travel as `{{F1}}`.
  - **Editor warnings (FR-023):** the API runs the detector on every saved text item and returns
    warnings with the matched kind and position (never the value). "Keep as text" stores a hash of
    the item's text, so the same text does not warn again.
  - **Output check:** the detector also runs on every AI output; a match there is removed and
    counted as an eval failure.
- **Rationale:** the AI cannot be its own filter (002 R4). One detector, one corpus.
- **Alternatives:** none new; see 002 R4.

## R6. AI calls

- **Decision:** four structured calls through `LlmPort`, following ADR-0005 and the pattern of
  002 R6 (`messages.create` with a Zod output format, `stop_reason` checked first, the server-side
  refusal fallback, no tools, input in a delimited block framed as data).

  | Call | Input (always after R5) | Output | Model and effort |
  |---|---|---|---|
  | `draftFromListing` | Listing description, house rules text, amenity keys, the section list | Items per section kind, each with topic IDs; nothing invented | `claude-opus-5-5`, `medium` (ADR-0005: guide drafting) |
  | `draftAnswer` | The question's topic, the answer or transcript, the target section's current text | Items for one or more sections, topic IDs, an optional follow-up question | `claude-opus-5-5`, `medium` |
  | `suggestFromDocument` | Up to 60,000 characters of document text, the section list | Items per section kind with topic IDs | `claude-opus-5-5`, `medium` |
  | `translateBlocks` | An array of block strings with inline tokens (R7) and the target language | The same number of strings, tokens kept | `claude-opus-5-5`, `low` |

  - Output documents are built by Guidesk from the model's strings, never taken as JSON trees
    from the model, so the schema of R2 holds by construction.
  - Links in model output are kept only when the exact address appears in the input, and are
    marked for review (FR-027, AC-SEC-007).
  - Static system prompts use prompt caching.
  - **Usage:** each call writes a `guide_ai_request` row with kind, model, tokens, cost, and
    outcome, never content (constitution VIII).
- **Daily limit (FR-064):** `max(100, 50 × property limit)` per workspace per UTC day, or
  `workspace.guide_ai_daily_limit` when Guidesk sets one, counted in `rate_limit_bucket` before
  the call. A refused request makes no call (AC-SEC-012). Feature 002's extraction limit is
  separate and unchanged.
- **Cost (list prices, estimates):** a listing draft or interview answer is about 3,000 input and
  1,500 output tokens with medium effort, about $0.04–0.08; a 60-page manual about $0.15–0.30; a
  section translation about $0.01–0.02. A full guide built from a listing, a 25-answer interview,
  two manuals, and translations costs about $2–4 once.
- **Evals (constitution V):** one new package, `evals/guide`, next to `evals/extraction/`, with
  three suites, gated the same way (they run in CI when the repository secret is present):
  - `drafting`: the 30 synthetic listings of the extraction suite → section placement
    ≥ 90% and invented facts 0 (SC-002), plus injection cases.
  - `interview`: 40 synthetic answers (20 Spanish, 20 English, half written as voice
    transcripts) → right section ≥ 90%, invented facts 0, no code in the output (SC-003).
  - `translation`: 30 items with formatting, links, and locked-field tokens → tokens kept
    100%, nothing added or dropped, judged by rules plus a reference check.
- **Rationale:** structured output keeps every call a draft generator with no side effects.
- **Alternatives:** a cheaper model for translation is likely fine but needs the eval suite and
  the founder's approval (ADR-0005); it is a later change behind the same port.

## R7. Translation

- **Decision:** translation works per section and language, on blocks.
  - **Segmenter (domain):** each block (paragraph, heading, list item, caption) becomes one string
    with inline tokens: `**bold**`, `_italic_`, `[link text]{L1}`, `{{F1}}` for a locked-field
    reference, and `{{R1}}` for a masked code (R5). After the call, the strings are parsed back
    into the same blocks. If any token is missing, duplicated, or invented, the section is retried
    once, then marked `failed` with the reason (FR-047).
  - **Triggers:** saving a text changes its source hash. Other languages become `stale` (machine
    translations) or `out_of_date` (reviewed ones, FR-046). A `guide.translate` job per section and
    language starts 20 seconds after the last save (pg-boss `stately` with a singleton key and
    `startAfter`), so autosave does not translate every keystroke. It translates every stale item
    of the section in one call. Target: ready within 2 minutes of the last save (FR-044, SC-005).
  - **States per item and language:** `current` (machine or reviewed), `stale` (waiting for the
    job), `out_of_date` (reviewed text whose source changed; never retranslated automatically),
    `pending` (waiting for the daily limit or a retry), `failed`.
  - Core facts and locked-field labels are rendered by Guidesk in each language and never
    translated by the model.
  - Shared blocks use the same machinery, once per workspace.
- **Rationale:** blocks keep structure safe, and per-section batching keeps calls and cost low.
- **Alternatives:** translating the whole guide in one call was rejected: one edit would
  retranslate everything. A machine-translation service was rejected as a new vendor, and it
  keeps placeholders less reliably than a model with a validated output.

## R8. Speech to text for voice notes

- **Decision:** **Amazon Transcribe** batch jobs behind a new `SpeechToTextPort`.
  - **Recording:** the portal records with `MediaRecorder` (WebM with Opus on Chrome and Firefox,
    MP4 with AAC on Safari), stops at 2 minutes, and uploads with a presigned POST to the uploads
    bucket (purpose `voice`, at most 10 MB).
  - **Job `interview.answer`:** the file processor checks the container by magic bytes (`audio`
    mode); the worker starts a transcription with automatic language identification limited to
    `es-US` and `en-US`, writes the result to the uploads bucket (`transcripts/`, deleted after 1
    day), reads it, deletes the audio and the transcription job, runs R5 on the transcript, and
    then makes the `draftAnswer` call. The host sees the transcript next to the draft (FR-037).
  - Supported inputs include WebM, Ogg, MP4, and M4A (**unverified**: checked from memory, to be
    confirmed in the gate).
  - **Latency:** batch jobs on 2-minute clips are expected to take 10–30 seconds
    (**unverified**). FR-036 asks for the draft within 30 seconds. R22 adds a gate on 20 real
    recordings before `interview.voice` is turned on in production.
  - **Privacy:** Amazon is already Guidesk's hosting provider (ADR-0009). An AWS Organizations
    AI-services opt-out policy must be in place before production, so recordings are not used to
    improve the service (same condition 002 R3 set for Textract).
  - **Local and test:** `FakeSpeechToText` returns transcripts from a fixture map keyed by the
    audio file's hash, with a default text.
- **Rationale:** the spec requires a speech-to-text step separate from the AI that drafts. Amazon
  Transcribe adds no new vendor, keeps audio inside the AWS account, and supports Spanish and
  English.
- **Alternatives:**
  - The OpenAI Whisper API, Deepgram, and similar services: rejected as new vendors and
    subprocessors.
  - Whisper running in a Lambda (for example with `transformers.js`): rejected for now; model
    downloads of 150 MB or more, cold starts, and CPU time put the 30-second target at risk. It
    stays possible behind the same port.
  - The browser's Web Speech API: rejected; Chrome sends audio to Google (an unlisted processor),
    and support differs across browsers.

## R9. Uploads, media, and documents

- **Decision:** the uploads bucket and presigned POST forms of 002 R9 are reused for every file;
  a new private **media bucket** keeps what becomes guide content.
  - **Purposes:** `document` (PDF), `photo` (read for knowledge), `media` (image or video kept in
    a section), and `voice` (R8).
  - **Malware scanning:** GuardDuty Malware Protection (002 R9) now **blocks** media and documents:
    `media.process` and `guide.document` wait for the scan tag `NO_THREATS_FOUND` (up to 2 minutes,
    then retry) before reading the file. Images and screenshots read only for text stay
    non-blocking, as in 002. Local development skips the scan.
  - **Images kept as media:** `file-processor` (`media` mode) checks magic bytes (JPEG, PNG,
    WebP), applies the orientation, re-encodes with `sharp` into WebP at 1,600 px and 640 px on
    the long side (which drops EXIF and GPS, AC-SEC-010), and writes the variants to the media
    bucket. HEIC is converted in the browser as in 002.
  - **Videos:** `file-processor` checks the ISO base media format (`ftyp` brand of MP4 or
    QuickTime), reads the duration from `mvhd` (≤ 90 seconds, FR-009) and the codec from the
    sample description (H.264 or HEVC). It removes metadata **in place**: every `udta`, `meta`,
    and XMP `uuid` box is renamed `free` and zero-filled, so no offsets move. It then copies the
    file to the media bucket. HEVC videos get a portal note that some Android phones may not play
    them; transcoding for guests belongs to spec 004's performance work.
  - **PDFs (`document` mode):** `pdfjs-dist` reads the text of up to 60 pages; an encrypted file
    is rejected as `password_protected`. Pages with almost no text are treated as scanned: they
    are rendered with `@napi-rs/canvas` and read with Tesseract (002 R3), at most 20 pages per
    file, behind the `guide.scannedPdf` flag. The text (at most 200,000 characters) goes back to
    the worker.
  - **Photos read for knowledge:** the existing `screenshot` mode (normalize and Tesseract). The
    image never reaches the AI (2026-11-17 clarification).
  - **Permissions:** the file processor may write only `media/*` in the media bucket, in addition
    to its 002 permissions.
  - **Serving:** the portal shows media through presigned GET URLs on the media bucket's own
    origin (SEC-11), valid for 15 minutes, with `Content-Disposition: inline` and the stored type.
    The portal CSP allows that origin in `img-src` and `media-src`. Spec 004 adds a CDN for guests.
- **Storage limit (FR-065):** the sum of `media_object.bytes` per workspace, against
  `workspace.media_storage_limit_mb` or 1 GB × property limit. The API checks the declared size
  when it creates the form, and the worker checks the real size before the object counts.
- **Rationale:** one upload path and one isolation boundary for every untrusted file (SEC-10).
- **Alternatives:**
  - Transcoding videos with FFmpeg in the sandbox: rejected for now as a large native binary;
    in-place box neutralization removes location data without re-encoding.
  - AWS Elemental MediaConvert: rejected as a new service; revisit in spec 004 if guests need
    adaptive streams.
  - Serving media through the API: rejected; large files would pass through the API, and the
    API's origin must not serve user content (SEC-11).

## R10. Key topics, coverage, and the completeness score

- **Decision:** a Guidesk-defined topic list in the domain (`GUIDE_TOPICS`), about 35 topics over
  the nine default sections. Each topic has an ID, a section kind, a weight from 1 to 5 (how often
  guests ask about it), and one or more coverage rules:
  - `keywords`: Spanish and English keyword families matched on the section's text
    (accent-insensitive);
  - `lockedField`: a set locked field of a kind (for example the lockbox code);
  - `media`: an image in the section (for example "photo of the entrance or access point");
  - `recommendations`: a number of recommendation items (for example 3 or more), and
    `personalTip`: a recommendation with the host's own note;
  - `fact`: a core fact that is set (check-in time, checkout time).
  - Items drafted by the AI also carry the topic IDs the model assigned (R6), validated against
    the list.
- **Coverage (FR-030 to FR-032):** a topic is covered when the host marked it, when any item tags
  it, or when one of its rules matches, including inherited shared blocks. Host marks win.
  Computed in the API on every save (deterministic, no AI), so it keeps working at the daily limit
  (FR-031). The section and guide scores are stored for the property list.
- **Scoring:** a section's score is covered weight divided by applicable weight (topics marked
  "Doesn't apply" are left out). The guide's score is the same ratio over every visible default
  section.
- **Initial weights:** from Guidesk's desk research of the questions guests send most often
  (arrival and access, Wi-Fi, checkout, parking, appliances such as air conditioning and hot water,
  groceries and restaurants), recorded with the topic list in the domain. They are revised with
  real guest questions once spec 005 runs (spec assumption).
- **Rationale:** deterministic rules are fast, free, testable, and explainable to the host ("No
  photo of the access point").
- **Alternatives:** asking the model which topics a section covers after every save was rejected:
  it costs an AI call per save and fails at the daily limit.

## R11. The AI interview

- **Decision:** questions come from Guidesk's catalog, not from the model: each topic has a
  question in Spanish and English in the message catalogs. The interview walks the missing topics
  in order of weight (FR-034); the model only drafts answers and may propose **one** follow-up
  question per topic when the answer leaves the topic uncovered.
  - Topics that need a code open the locked-field form instead of a question (FR-038).
  - A text answer is drafted synchronously-looking but runs as an `interview.answer` job; the
    portal polls the turn every 2 seconds (as the 002 extraction screen does). Targets: 15 seconds
    for text, 30 seconds for voice (FR-036).
  - Sessions and turns are stored, so the interview resumes on any device (FR-035). Answers and
    transcripts are kept 7 days for the host's reference, then deleted (R15).
- **Rationale:** catalog questions are cheap, reviewed, and never leak instructions from content;
  the model's job stays narrow and testable by the interview eval suite.
- **Alternatives:** a free conversational interview driven by the model was rejected: harder to
  evaluate, more expensive, and more open to injection from earlier answers.

## R12. Publishing and versions

- **Decision:** publishing builds an immutable **snapshot** with the domain snapshot builder:
  - every visible section in order, with only its **reviewed** items (FR-051); items needing
    review are listed by the publish check and left out;
  - each item's documents in every guide language (unreviewed machine translations of reviewed
    items included, FR-051);
  - inherited shared blocks from their published snapshot, tagged with the block's ID;
  - locked fields as references only, and facts as keys; values are resolved at view time
    (FR-052);
  - recommendations with their benefit answer (FR-014), and media as IDs.
  - The snapshot is stored in `guide_version` with a schema version, the number, who, and when.
    The table is insert-only for the application role.
- **Draft vs live:** every draft write sets `guide.has_unpublished_changes`. Guests (spec 004) and
  the agent (spec 005) read only `guide.published_version_id`.
- **Restore (FR-055):** copies a version's snapshot back into draft items (keeping their source
  labels and review states) inside one transaction; nothing goes live until the host publishes.
- **Retention:** the latest 20 versions per guide; older ones are deleted by `retention.daily`.
  Media referenced only by deleted versions becomes unreferenced (R15).
- **Rationale:** snapshots make "guests never see draft edits" (SC-009) a property of the data,
  and keep spec 004's read path a single row.
- **Alternatives:** copy-on-write rows per item version were rejected as more joins on the guest
  read path for no benefit at this scale.

## R13. Publish checks and platform policies

- **Decision:** a domain function returns the left-out items and the warnings of FR-050:
  - **Essentials:** the topics "how to get in", "emergency contacts", and "checkout steps" are not
    covered.
  - **Unset locked fields:** a reference to a field without a value.
  - **Code-like text:** R5 matches in reviewed text that the host has not kept explicitly.
  - **Off-platform (PC-06):** Spanish and English phrase families ("book direct", "reserva
    directo", "págame por", "pay me via", "transferencia", "SINPE", "descuento si reservas") and
    payment or booking link domains (for example `paypal.me`, `venmo.com`, `wise.com`, direct
    booking engines on the host's own domain are flagged by phrase only).
  - **Translations:** counts of machine translations not reviewed and translations out of date.
- **PC-07:** recommendation items require the benefit answer before they can be approved
  (FR-014).
- **Rationale:** warnings, never blocks (spec), so false positives cost one tap.

## R14. Shared blocks

- **Decision:**
  - A shared block has its own items (the same item tables, owned by the block instead of a
    section), its own draft, and a **published snapshot** stored on the block with a revision
    number.
  - Property guides resolve inheritance at read time: every published block of the workspace for
    that section kind, after the property's own items, unless the guide has an `override` or
    `exclude` link for it (FR-058, FR-059).
  - **Override:** copies the block's published items into the property's section as items with
    source `copy` ("Copied from shared: Checkout steps"), reviewed, and records the block revision
    it started from, so the portal can show "The shared version changed" (FR-061).
  - **Publish fan-out (FR-060):** publishing or deleting a block runs a `shared-block.publish`
    job. For each guide with a published version that inherits the block, it writes a new
    `guide_version` from the **previous published snapshot** with that block's content replaced,
    added, or removed. Draft edits of those guides never go live this way. SC-007: 50 guides in
    one job within 1 minute.
- **Rationale:** guests get the new shared content at once, as the clarification asks, without
  publishing anyone's unfinished drafts.
- **Alternatives:** re-publishing each property's draft was rejected because it would publish
  drafts the host never meant to publish.

## R15. Background jobs and retention

| Queue | Trigger | Notes |
|---|---|---|
| `guide.draft` | Property created; first guide open for properties created before 003 | Deterministic placement, then one `draftFromListing` call when a description exists |
| `guide.translate` | Text saved (20-second debounce, one per section and language) | R7 |
| `interview.answer` | Answer submitted | Audio check and transcription for voice, R5, `draftAnswer` |
| `guide.document` | Upload completed | Scan wait, sandbox reading, R5, `suggestFromDocument` |
| `media.process` | Media upload completed | Scan wait, sandbox processing, size check against the limit |
| `shared-block.publish` | Shared block published or deleted | R14 fan-out |
| `retention.daily` (extended) | Daily cron | Voice files and documents left over after 24 hours; answers, transcripts, and document text after 7 days; versions beyond 20; media unreferenced for 24 hours; AI request rows after 12 months |

- Jobs carry IDs only. Every job runs in an OpenTelemetry span with the workspace ID, counts, and
  outcome codes; no content, transcript, or value reaches span attributes or logs (existing
  allowlist).
- **Notifications:** the reveal-limit email to owners ([emails](contracts/emails.md)). Everything
  else shows as statuses in the portal; web push arrives with spec 006.

## R16. Draft from property data

- **Decision:** when a property is created (any 002 path except duplication), the API creates the
  guide and its nine sections in the same transaction, with `fact` items for check-in time (Arrival
  and access), checkout time (Checkout), maximum guests (House rules), and address (Arrival and
  access). It then sends `guide.draft`, which:
  - places house rules as a text item in House rules and amenities as a list item in Amenities
    (rendered from amenity keys in each language, so no translation call is needed);
  - links imported restricted values as locked fields of Arrival and access or Wi-Fi (FR-022);
  - calls `draftFromListing` with the description, when there is one, to place its pieces;
  - labels every item with its source (`listing` or the PMS name) and leaves it unreviewed.
- **Existing properties:** a migration creates the guide, sections, and fact items for every
  property; `guide.draft` runs the first time the guide is opened (FR edge case).
- **Duplication (FR-067):** copies sections, items, documents, links, and media (objects copied
  to new keys), labels items `copy`, and creates locked fields with labels and no values.
- **Redraft (FR-007):** runs the same call for one section; results arrive as new unreviewed
  items.

## R17. Concurrency and autosave

- **Decision:** each section and shared block has a `revision` integer. Every item write sends the
  revision the editor last saw; the API compares and increments it in one statement, or answers
  `409 section_changed` with the current section so the portal can show both versions (FR-012).
- **Rationale:** optimistic checks are enough for a few editors per workspace; live
  collaboration is out of scope (spec assumption).

## R18. Roles, step-up, and limits

- **Capabilities (spec 001), no new ones:** `properties.manage` (owners and admins) covers every
  guide write: editing, approving, uploads, the interview, publishing, shared blocks, and adding,
  changing, or deleting locked fields. `restricted.reveal` (owners and admins) covers reveals,
  the public Wi-Fi switch, and the reveal history. Locked-field writes and reveals use
  `WorkspaceAction` with `stepUp: true` and the MFA threshold. Every member can read guides.
  Agents get `403` on writes with `access.role_denied` logged (AC-SEC-001), and never receive
  locked-field values or the reveal history.
- **Pending deletion:** writes refused with `409` (FR-049, edge case).
- **Pilot overrides:** `workspace.guide_ai_daily_limit` and `workspace.media_storage_limit_mb`,
  set by staff like `property_limit`.

## R19. Security log events

New event types in the spec 001 catalog, with allowlisted fields only (never values):
`restricted_value.added`, `restricted_value.changed`, `restricted_value.deleted`,
`restricted_value.revealed`, `restricted_value.reveal_limited`, `restricted_value.made_public`,
`restricted_value.made_locked`, `guide.published`, `guide.unpublished`, `guide.version_restored`,
`shared_block.published`, `shared_block.deleted`. Fields: property ID, locked field ID and kind,
version number, block ID, and counts.

## R20. Testing

- **Unit (domain):** document schema (allowed and rejected trees), segmenter round trips with every
  token kind, the extended detector corpus (≥ 120 snippets), coverage rules and scores, publish
  checks (essentials, off-platform phrases, unset fields), the snapshot builder (reviewed-only,
  shared resolution, no values), shared-block fan-out on snapshots, translation state rules.
- **Contract (adapters):** Anthropic recorded responses for the four calls (including refusal and
  truncation), Transcribe recorded responses (job lifecycle, failure, language identification),
  the sandbox `document`, `media`, and `audio` modes on fixture files (text PDF, scanned PDF,
  encrypted PDF, iPhone-style MOV with location metadata, MP4, WebM audio, renamed archive), and
  presigned GET URLs.
- **Integration (API and database, Testcontainers):**
  - RLS and cross-tenant tests on every new table (AC-SEC-011).
  - Role refusals (AC-SEC-001), step-up on locked fields (AC-SEC-002), the reveal limit
    (AC-SEC-003).
  - A spying fake `LlmPort` records every input: no locked value or detected code ever appears
    (AC-SEC-004 to AC-SEC-006, SC-004).
  - Snapshots never contain values; draft edits never change the published version (SC-009).
  - Conflicts (`409`), limits (AI and media), and the shared-block fan-out.
- **End to end (Playwright, phone viewport):** draft review, editing with text, image, and video,
  approval, publishing and versions; locked fields with reveal; the interview with a fake model and
  fake speech to text; translations with a fake model; uploads with fixture files; shared blocks
  across two properties.
- **Evals:** guide drafting, interview, and translation suites (R6).
- **Performance:** k6 for the guide endpoints (p95 ≤ 300 ms), Lighthouse CI for the guide pages,
  the bundle check for the guide routes and the editor chunk.

## R21. Documentation follow-ups

- Security architecture: the data classification notes that a host may make a property's Wi-Fi
  password public (2026-11-17 clarification); SEC-06 names the reveal service.
- ADR-0009: the service table adds Amazon Transcribe and the media bucket.
- The subprocessor register (SEC-19) notes Transcribe under AWS.
- UX gaps 4, 5, and 8 are marked resolved by this spec.

## R22. Rollout, flags, and production gates

- **Feature flags:** `guide.interviewVoice` (voice answers; text answers are always on),
  `guide.scannedPdf` (OCR of scanned pages).
- **Gates before production:**

  | Gate | Blocks | Status |
  |---|---|---|
  | Transcribe check on 20 real recordings (10 Spanish, 10 English, phone microphones): draft ready within 30 seconds for 90%, and formats from R8 accepted | `guide.interviewVoice` in production | Open |
  | AWS Organizations AI-services opt-out policy covering Transcribe | `guide.interviewVoice` in production | Open |
  | GuardDuty Malware Protection enabled on the uploads bucket (002 gate) and blocking for media and documents | Media and document uploads in production | Open |
  | The three eval suites pass with the real model | Merging prompt or schema changes; production | Open |
  | The quickstart run on staging | Release | Open |
