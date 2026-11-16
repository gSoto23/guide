# HTTP API Contract: Property Onboarding

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md) ·
**Conventions and common errors**: [feature 001 contract](../../001-workspace-accounts/contracts/http-api.md#conventions)

Every endpoint below is workspace-scoped (`/api/v1/workspaces/{workspaceId}/…`), requires a
session, and inherits feature 001's conventions: problem+json errors with a stable `code`, `404`
for other workspaces' resources (AC-SEC-009), `step_up_required`, `mfa_enrollment_required`,
`429` with `Retry-After`, and `Idempotency-Key` on creating `POST`s.

Role columns: **O** owner, **A** admin, **Ag** agent. **SU** = re-authenticated within 10
minutes (spec 001 FR-011). **MFA** = `requiresMfa` must be satisfied once the workspace has 3 or
more properties (FR-048).

## Feature-specific errors

| HTTP | `code` | When |
|---|---|---|
| 409 | `plan_limit_reached` | Creating, importing, duplicating, or restoring would exceed the property limit. Body: `{limit, used}` (FR-047) |
| 409 | `workspace_pending_deletion` | The workspace is pending deletion (FR-049) |
| 409 | `feed_limit_reached` | The property already has 5 calendar feeds (FR-020) |
| 409 | `duplicate_feed` | The same link is already saved for this property |
| 409 | `refresh_too_soon` | "Refresh now" was used less than 5 minutes ago. Body: `{retryAfterSeconds}` |
| 409 | `confirmation_mismatch` | The typed name does not match the property name (FR-044) |
| 422 | `feed_rejected` | The link is not HTTPS, resolves to a blocked address, redirects too often, is too large or slow, or is not iCal. Body: `{reason}` |
| 422 | `invalid_credential` | The PMS rejected the credential; nothing is stored. Body: `{provider, helpUrl}` |
| 429 | `extraction_limit_reached` | The daily extraction limit is used. Body: `{limit, resetsAt}` (FR-017) |

## Properties

| Method and path | Roles | Notes |
|---|---|---|
| `GET /properties?query=&cursor=` | O A Ag | List: name, setup status, source and provider, calendar status, `pmsStatus`. Search by name (FR-006). Removed properties are listed only for O and A, with `?status=removed` |
| `GET /properties/limits` | O A Ag | `{limit, used, extractionLimit, extractionsUsedToday}` |
| `GET /properties/start-options` | O A | Ordered options with the recommended one first, from the onboarding answers (FR-008) |
| `POST /properties` | O A, MFA | Create from the confirmation step. Body: core facts, `source` (`manual`, `listing_text`, `duplicate`), optional `extractionRequestId` or `duplicateOf`, and `contentItems` accepted from the extraction. Returns the property with `setupStatus` and `missingFacts`. `201`, or `409 plan_limit_reached` |
| `GET /properties/{propertyId}` | O A Ag | Core facts, setup status, source label, counts of feeds, stays, and restricted values. Agents get no feed or restricted-value details |
| `PATCH /properties/{propertyId}` | O A | Edit core facts (FR-005). Imported properties record the field in `edited_facts` |
| `POST /properties/confirm` | O A | Body: `{propertyIds}`. Confirms the facts of imported properties in `to_confirm` (one or many from the list), moving them to `ready` (FR-004). Properties still missing facts are returned as `needs_details` |
| `GET /properties/address-check?line1=&unit=&city=&country=` | O A | `{matches: [{propertyId, name}]}` for the dismissible duplicate warning (FR-007) |
| `GET /properties/{propertyId}/duplicate-draft` | O A | Prefill for the confirmation step: copied facts and content, name "Copy of …", empty address (FR-043). Nothing is created until `POST /properties` |
| `DELETE /properties/{propertyId}` | O A, SU | Body: `{typedName}`. Response lists upcoming stays to warn about when called with `?dryRun=true` (FR-044) |
| `POST /properties/{propertyId}/restore` | O A | Within 30 days and with a free slot (FR-045) |

## Time zones

| Method and path | Roles | Notes |
|---|---|---|
| `GET /time-zones?country=MX` | O A | Zones of the country, with local names and current UTC offsets |
| `GET /time-zones/suggest?country=MX&city=Cancún` | O A | `{suggested: "America/Cancun"}`, or `{suggested: null, choices: […]}` when the country has several zones and the city is not recognized. No outside service is called (FR-002) |

These two routes are not workspace-specific but are served under the workspace path so the role
check and rate limits apply.

## Listing extraction

| Method and path | Roles | Notes |
|---|---|---|
| `POST /extractions` | O A | Body: `{text?, screenshots: [{contentType, size}]}` (≤ 20,000 characters; ≤ 10 screenshots of ≤ 10 MB; JPEG, PNG, or WebP after the portal converts HEIC). Counts toward the daily limit. Returns `{extractionId, redactions, urlOnly, uploads: [{uploadId, url, fields}]}` with presigned upload forms. A URL-only input returns `urlOnly: true` and makes no AI call (FR-011) |
| `POST /extractions/{extractionId}/submit` | O A | Called after the uploads finish. Queues the job. `202` |
| `GET /extractions/{extractionId}` | O A | Status and, when done, `result`: content items with `source`, proposed facts, detected language, `failedScreenshots`, `redactions` |

The redaction summary is returned as counts per kind (for example "1 door code removed"), so the
portal can tell the host what was removed without echoing the value (FR-012).

## Listing content

| Method and path | Roles | Notes |
|---|---|---|
| `GET /properties/{propertyId}/listing-content` | O A Ag | Items with `kind`, text, `source`, `reviewState`, `language` |
| `PUT /properties/{propertyId}/listing-content/{kind}` | O A | Edit; sets `reviewState = edited` (US2 scenario 7). Text that looks like a restricted value is refused with `422` and a pointer to the guide's locked fields (FR-013) |
| `POST /properties/{propertyId}/listing-content/{kind}/approve` | O A | Sets `reviewState = approved` |

## Calendar feeds and stays

| Method and path | Roles | Notes |
|---|---|---|
| `GET /properties/{propertyId}/calendar-feeds` | O A | Channel, `displayHint`, status, last success, last error. Never the full link (FR-025) |
| `POST /properties/{propertyId}/calendar-feeds` | O A | Body: `{url, channel?, channelLabel?}`. Reads the feed through the isolated feed reader before saving (FR-021) and returns the feed with a preview of upcoming stays. `201`, or `422 feed_rejected` with nothing stored |
| `PATCH /calendar-feeds/{feedId}` | O A | Change the channel label, or replace the link (re-checked) |
| `DELETE /calendar-feeds/{feedId}` | O A | Removes the feed and its future stays |
| `POST /properties/{propertyId}/calendar-feeds/refresh` | O A | "Refresh now" for every feed of the property; once every 5 minutes (FR-023). `202` |
| `GET /properties/{propertyId}/stays?from=&status=` | O A Ag | Upcoming stays by default, with source, channel, `mayBeBlock`, `overlaps`, `possiblyOutdated`, and for PMS or manual stays the guest count and name |
| `POST /properties/{propertyId}/stays` | O A | Add a stay by hand: dates, guest count, optional guest name, channel (default "Direct"), optional times (FR-052). The response flags overlaps (FR-054) |
| `PATCH /stays/{stayId}` | O A | Manual stays: edit. Feed or PMS stays: only `{status: "hidden"}` when `mayBeBlock` is true (FR-022, FR-053). Anything else returns `409 conflict` |
| `POST /stays/{stayId}/cancel` | O A | Manual stays only |

## PMS connections and imports

| Method and path | Roles | Notes |
|---|---|---|
| `GET /pms-connections` | O A | Provider, account label, status, last refresh, last error. Never the credential |
| `POST /pms-connections` | O A, SU, MFA | Body: `{provider, credential}` where `credential` is the provider's own value (a Beds24 invite code, a Hostex access token; [research R7](../research.md#r7-pms-adapters-beds24-and-hostex)). The API validates it with the provider, stores it encrypted, and returns the connection with its listings (`externalId`, name, `alreadyImported`, `propertyId`). `201`, or `422 invalid_credential` with nothing stored (US4 scenario 3) |
| `GET /pms-connections/{connectionId}/listings` | O A | Lists the PMS listings again, for a later import (FR-033) |
| `POST /pms-connections/{connectionId}/imports` | O A | Body: `{externalIds}`; capped at the remaining limit (FR-028). Returns the `import_run`. `202` |
| `POST /pms-connections/{connectionId}/refresh` | O A | "Refresh now" for reservations; once every 5 minutes per connection (FR-035). `202` |
| `DELETE /pms-connections/{connectionId}` | O A | Disconnect: the credential is deleted in the same transaction, refreshes stop, and imported properties remain (FR-036). Beds24 tokens are also revoked at the provider. Hostex has no revoke endpoint, so the response tells the host to delete the token in Hostex as well (`{providerRevoked: false, instructionsUrl}`) |

## CSV import

| Method and path | Roles | Notes |
|---|---|---|
| `GET /imports/csv-template?lang=es` | O A | The template in the requested language: headers, one example row, and instructions (FR-037) |
| `POST /imports/csv` | O A | Body: `{contentType, size}` (≤ 2 MB). Returns `{importRunId, upload: {uploadId, url, fields}}` |
| `POST /imports/{importRunId}/validate` | O A | Called after the upload. `202`; the run moves to `awaiting_confirmation` with per-row results |
| `POST /imports/{importRunId}/confirm` | O A | Body: `{rowNumbers?}` when the valid rows exceed the limit (US5 scenario 5). Creates the valid rows. `202` |
| `POST /imports/{importRunId}/cancel` | O A | — |

## Import runs (PMS and CSV)

| Method and path | Roles | Notes |
|---|---|---|
| `GET /imports?status=running` | O A | Runs for the portal's progress banner, which is the "in the portal" notification of FR-029 |
| `GET /imports/{importRunId}` | O A | Progress counts and status |
| `GET /imports/{importRunId}/items?outcome=failed` | O A | Per-listing or per-row results with reasons |
| `POST /imports/{importRunId}/items/{itemId}/retry` | O A | Retry one failed PMS listing (FR-032) |
| `GET /imports/{importRunId}/error-file?lang=es` | O A | CSV of rejected rows with row number, column, and reason; formula cells neutralized (FR-039, FR-041); calendar links left empty |

## Uploads

Presigned uploads go straight from the browser to the uploads bucket on its own origin (SEC-10,
SEC-11). Each form fixes the object key, the content type, and a `content-length-range`, and
expires after 10 minutes. The API never accepts file bytes on its own routes.

## Cross-cutting guarantees

- Restricted values (feed links, PMS credentials, imported codes) never appear in any response,
  log line, trace, or error report (AC-SEC-008). Responses carry masks or `displayHint` only.
- Every write checks the role in code and again in RLS. A refusal is logged as
  `access.role_denied` (AC-SEC-001).
- Creating paths re-check the plan limit and the pending-deletion state inside the same
  transaction that inserts the property.
- Agents get `404 not_found`, not `403`, for feed and connection routes, so the existence of a
  feed or connection is not revealed to them.
