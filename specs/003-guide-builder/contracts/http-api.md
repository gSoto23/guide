# HTTP API Contract: Guide Builder

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions and common errors**: [feature 001 contract](../../001-workspace-accounts/contracts/http-api.md#conventions) ·
[feature 002 contract](../../002-property-onboarding/contracts/http-api.md)

Every endpoint below is workspace-scoped (`/api/v1/workspaces/{workspaceId}/…`), requires a
session, and inherits the conventions of features 001 and 002: problem+json errors with a stable
`code`, `404` for other workspaces' resources (AC-SEC-011), `step_up_required`,
`mfa_enrollment_required`, `429` with `Retry-After`, and `Idempotency-Key` on creating `POST`s.
Guide routes below are relative to `/properties/{propertyId}/guide`.

Role columns: **O** owner, **A** admin, **Ag** agent. **SU** = re-authenticated within 10 minutes
(spec 001 FR-011). **MFA** = the second factor is required once the workspace has 3 or more
properties. Agents calling a write route get `403 role_denied`, logged as `access.role_denied`
(AC-SEC-001).

## Feature-specific errors

| HTTP | `code` | When |
|---|---|---|
| 409 | `section_changed` | The `revision` sent is older than the section's or block's. Body: the current section with its items (FR-012) |
| 409 | `not_ready_to_publish` | The property's setup status is not `ready`. Body: `{setupStatus, missingFacts}` (FR-049) |
| 409 | `workspace_pending_deletion` | Any write while the workspace is pending deletion |
| 409 | `locked_field_referenced` | Deleting a locked field that a published version references, without `?confirm=true`. Body: `{versions}` (FR-024) |
| 409 | `interview_active` | Starting an interview while one is active for the guide. Body: `{sessionId}` |
| 422 | `section_limit` | An 11th custom section (FR-002) |
| 422 | `item_limit` | More than 20 images or 3 videos in a section (FR-009) |
| 422 | `text_too_long` | A section and language would pass 20,000 characters (FR-010) |
| 422 | `invalid_document` | The document breaks the content schema; nothing is stored. Body: `{path}` (AC-SEC-008) |
| 422 | `benefit_required` | Approving a recommendation without the benefit answer (FR-014) |
| 422 | `wifi_only` | Making a field other than the Wi-Fi password public (FR-021) |
| 422 | `shared_block_limit` | A 51st shared block (FR-057) |
| 422 | `storage_limit_reached` | The media would pass the workspace's storage limit. Body: `{limitBytes, usedBytes}` (FR-065) |
| 429 | `ai_limit_reached` | The daily guide AI limit is used. Body: `{limit, resetsAt}` (FR-064, AC-SEC-012) |
| 429 | `reveal_limit_reached` | 20 reveals by this member in the last hour. Body: `{resetsAt}` (FR-018) |

## Guide and sections

| Method and path | Roles | Notes |
|---|---|---|
| `GET /` | O A Ag | The guide: status, `hasUnpublishedChanges`, published version number, `draftState`, completeness, languages, and sections in order. Each section: kind, title, hidden, `revision`, status, completeness, its items (with documents per language, source label, review state, translation states, media URLs), the inherited shared blocks resolved (marked `shared`), and its locked fields as `{id, kind, label, isSet, isPublic, valueSetAt, updatedBy}` (agents get only `{id, kind, label, locked: true}`). Triggers `guide.draft` for properties created before 003 (R16) |
| `GET /completeness` | O A Ag | Section and guide scores, and the missing topics ordered by weight, each `{topicId, sectionKind, weight}`; marks included (FR-030, FR-033) |
| `PUT /topics/{topicId}` | O A | Body: `{mark: covered \| not_applicable \| null}` (FR-032) |
| `POST /sections` | O A | Add a custom section. Body: `{title: {es?, en?}, position?}`. `201` (FR-002) |
| `PATCH /sections/{sectionId}` | O A | Body: `{revision, title?, hidden?}`. Hiding applies to default sections only |
| `PUT /sections/order` | O A | Body: `{sectionIds}` in the new order |
| `DELETE /sections/{sectionId}` | O A | Custom sections only; deletes their items |
| `POST /sections/{sectionId}/approve` | O A | Approves every item in the section. Body: `{revision}` |
| `POST /sections/{sectionId}/redraft` | O A | Drafts the section again from the listing content; results arrive as new unreviewed items. Counts toward the AI limit (FR-007) |

## Items

| Method and path | Roles | Notes |
|---|---|---|
| `POST /sections/{sectionId}/items` | O A | Body: `{revision, kind, position?, language, doc?, mediaId?, recommendation?}`. Items created here are `host` items, reviewed. Returns the item, the new `revision`, and `warnings` (code-like text: `[{kind, blockIndex}]`, never the value) (FR-023) |
| `PATCH /items/{itemId}` | O A | Body: `{revision, language, doc?, recommendation?, keepCodeWarning?}`. Editing the source language marks other languages stale or out of date; editing a translation makes it `reviewed`. An edit also reviews the item. Returns the item, `revision`, and `warnings` |
| `DELETE /items/{itemId}` | O A | Body: `{revision}`. Discarding a suggestion is a delete (FR-041) |
| `POST /items/{itemId}/approve` | O A | Body: `{revision}` (FR-005) |
| `PUT /sections/{sectionId}/items/order` | O A | Body: `{revision, itemIds}` |
| `POST /items/{itemId}/translations/{language}` | O A | Body: `{revision, action: translate_again \| keep \| mark_reviewed}` (FR-045, FR-046) |
| `POST /items/{itemId}/move-to-locked-field` | O A, SU, MFA | Body: `{revision, language, blockIndex, kind, label?}`. Takes the code the warning found, stores it as a new locked field, and replaces it in the text with a `lockedField` node, in one transaction. The value never travels back in the response. Logs `restricted_value.added` (FR-023) |

## Locked fields

| Method and path | Roles | Notes |
|---|---|---|
| `GET /locked-fields` | O A Ag | Masked list; agents get only kind, label, and `locked: true` (FR-063) |
| `POST /locked-fields` | O A, SU, MFA | Body: `{kind, label?, value?, sectionKind?}`. Value ≤ 200 characters. Logs `restricted_value.added`. `201` |
| `PATCH /locked-fields/{fieldId}` | O A, SU, MFA | Body: `{label?, value?}`. Logs `restricted_value.changed`. Takes effect for guests at once (FR-020) |
| `DELETE /locked-fields/{fieldId}?confirm=` | O A, SU, MFA | `409 locked_field_referenced` without `confirm=true` when a published version references it. Logs `restricted_value.deleted` |
| `POST /locked-fields/{fieldId}/reveal` | O A, SU, MFA | Returns `{value, hideAfterSeconds: 60}` with `Cache-Control: no-store`. Logs `restricted_value.revealed`. Over the limit: `429 reveal_limit_reached`, logs `restricted_value.reveal_limited`, and emails the owners (FR-016 to FR-018) |
| `PUT /locked-fields/{fieldId}/visibility` | O A, SU, MFA | Wi-Fi password only. Body: `{public: boolean}`. Logs `made_public` or `made_locked` (FR-021) |
| `GET /locked-fields/reveals?cursor=` | O A | Reveal history: `{items: [{fieldId, kind, label, revealedBy, at}]}`. Agents get `404` |

## Preview, publishing, and versions

| Method and path | Roles | Notes |
|---|---|---|
| `GET /preview?source=draft\|published\|{number}&lang=` | O A Ag | The guide as guests will see it: the snapshot of the draft (built on the fly with reviewed items only) or of a version, resolved for the language, locked fields as placeholders (FR-054) |
| `GET /publish-check` | O A | `{ready: boolean, blockers: [not_ready \| pending_deletion], leftOut: [{sectionId, itemIds}], warnings: [{kind, sectionId?, itemId?, count?}]}` with kinds `missing_essential`, `unset_locked_field`, `code_like_text`, `off_platform`, `unreviewed_translations`, `out_of_date_translations` (FR-050) |
| `POST /publish` | O A | Body: `{expectedRevisionHash}` from the publish check, so the host publishes what they reviewed; a newer draft answers `409 section_changed`. Creates version N, logs `guide.published`. `201 {versionNumber}` (FR-051) |
| `POST /unpublish` | O A | Logs `guide.unpublished` (FR-056) |
| `GET /versions` | O A Ag | Latest 20: `{number, cause, publishedBy, publishedAt}` (FR-055) |
| `GET /versions/{number}` | O A Ag | The snapshot, for viewing |
| `POST /versions/{number}/restore` | O A | Replaces the draft with the version; nothing goes live. Logs `guide.version_restored` |

## Media

| Method and path | Roles | Notes |
|---|---|---|
| `POST /media` | O A | Body: `{kind: image \| video, contentType, size, fileName}`. Checks type, size (FR-009), and the storage limit. Returns `{mediaId, upload: {url, fields}}` (presigned POST, 10 minutes) |
| `POST /media/{mediaId}/complete` | O A | Sends `media.process`. `202` |
| `GET /media/{mediaId}` | O A Ag | `{status, rejectReason?, kind, width, height, durationMs, videoCodec, urls: {large?, small?, original?}}` with presigned GET URLs valid 15 minutes |
| `GET /workspaces/{workspaceId}/guide-limits` | O A Ag | `{ai: {limit, usedToday, resetsAt}, media: {limitBytes, usedBytes}}` (FR-064, FR-065). Not under the guide prefix |

## Documents and photos (reading)

| Method and path | Roles | Notes |
|---|---|---|
| `POST /documents` | O A | Body: `{files: [{fileName, contentType, size}]}`, 1–10 files (FR-039). Returns one `{documentId, upload}` per file |
| `POST /documents/{documentId}/complete` | O A | Sends `guide.document`. `202`. Counts toward the AI limit when the reading reaches the model |
| `GET /documents` | O A Ag | Per file: status, reject reason, pages, redaction counts, and its suggestion item IDs (FR-040) |
| `DELETE /documents/{documentId}` | O A | Removes the file record and its unreviewed suggestions |

## Interview

| Method and path | Roles | Notes |
|---|---|---|
| `POST /interview` | O A | Body: `{sectionKind?}`. Starts or returns the active session with the next question: `{sessionId, question: {topicId, sectionKind, followUp?} \| null, opensLockedField?: kind}` (FR-034, FR-038) |
| `GET /interview/{sessionId}` | O A Ag | The session, the next question, and its turns |
| `POST /interview/{sessionId}/voice` | O A | Body: `{contentType, size}`. Returns a presigned POST for a voice note ≤ 10 MB (purpose `voice`). `guide.interviewVoice` flag |
| `POST /interview/{sessionId}/answers` | O A | Body: `{topicId, text}` (≤ 2,000 characters) or `{topicId, voiceUploadId}`. Sends `interview.answer`. Returns the turn, `202`. Refused at the AI limit with no call made |
| `GET /interview/{sessionId}/turns/{turnId}` | O A | `{status, errorCode?, transcript?, redactions, itemIds}`; the portal polls every 2 seconds |
| `POST /interview/{sessionId}/skip` | O A | Body: `{topicId}` |
| `POST /interview/{sessionId}/finish` | O A | — |

## Shared content

Paths relative to `/shared-blocks`, at the workspace level.

| Method and path | Roles | Notes |
|---|---|---|
| `GET /` | O A Ag | Blocks with name, section kind, status, `hasUnpublishedChanges`, and counts of inheriting, overriding, and excluding properties |
| `POST /` | O A | Body: `{sectionKind, name}`. `201` (FR-057) |
| `GET /{blockId}` | O A Ag | The block with its items, like a section, and its `revision` |
| `PATCH /{blockId}` | O A | Body: `{revision, name?, position?}` |
| `POST /{blockId}/items`, `PATCH /items/{itemId}`, `DELETE /items/{itemId}`, `POST /items/{itemId}/approve` | O A | As for sections; `lockedField` nodes are refused (`invalid_document`) |
| `POST /{blockId}/publish` | O A | Publishes the block and sends `shared-block.publish`. Logs `shared_block.published`. Returns `{publishedRevision, guidesToUpdate}` (FR-060) |
| `DELETE /{blockId}` | O A | Removes it from every guide through the same job. Logs `shared_block.deleted` |
| `GET /{blockId}/properties` | O A | `{inherit: [...], override: [{propertyId, name, behind: boolean}], exclude: [...]}` (FR-062) |

Per property, relative to the guide prefix:

| Method and path | Roles | Notes |
|---|---|---|
| `POST /shared-blocks/{blockId}/override` | O A | Copies the block into the property's section (FR-059) |
| `POST /shared-blocks/{blockId}/exclude` | O A | — |
| `DELETE /shared-blocks/{blockId}/link` | O A | "Reset to shared" or include again; deletes the override's items |

## Cross-cutting guarantees

- No response, page, log line, span, error report, job payload, or AI input carries a locked
  value, except the body of `POST /locked-fields/{id}/reveal` (AC-SEC-006).
- Every document in a request is validated against the content schema before anything is
  stored; the response returns the stored, normalized document.
- Every write checks the role, pending deletion, and the section or block `revision` in the same
  transaction, and marks the guide `has_unpublished_changes` when it is published.
- Guests (spec 004) and the agent (spec 005) read only published versions; no route here serves
  a draft to them.
- Guidesk never fetches a URL found in content, uploads, or listings (AC-SEC-013, PC-12).
