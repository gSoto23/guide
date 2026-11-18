# Quickstart and Validation: Guide Builder

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **API**: [contracts/http-api.md](contracts/http-api.md) · **Emails**: [contracts/emails.md](contracts/emails.md)

This guide proves the feature works end to end, with the repository's own scripts. It builds on
the [feature 002 quickstart](../002-property-onboarding/quickstart.md), which covers properties,
listing text, PMS imports, and the local sandbox. All data below is fictional.

## Prerequisites

- Everything from the feature 002 quickstart (`KMS_MODE=local`, `STORAGE_MODE=local`,
  `SANDBOX_MODE=in-process`, `LLM_MODE=fake`).
- New environment variables in `.env.example` (real values never go in the repository):
  - `SPEECH_MODE=fake` for fixture transcripts, or `SPEECH_MODE=transcribe` with AWS credentials
    ([research R8](research.md#r8-speech-to-text-for-voice-notes));
  - `MEDIA_BUCKET` (ignored when `STORAGE_MODE=local`) and `MEDIA_REQUIRE_SCAN=false` locally;
  - feature flags `GUIDE_INTERVIEW_VOICE` and `GUIDE_SCANNED_PDF`.
- Fixture files in `e2e/fixtures/guide/`: an entrance photo with GPS metadata, a 40-second MP4,
  a washer manual PDF with a text layer, a scanned PDF, an encrypted PDF, a voice note (WebM)
  whose fake transcript contains "the door code is 4821", and a file named `.jpg` that is an
  archive.

## Setup

```bash
docker compose up -d postgres mailpit
```

```bash
pnpm install
```

```bash
pnpm db:migrate
```

```bash
pnpm dev
```

## Validation scenarios

Run on a phone viewport (375 × 812) in Spanish unless a step says otherwise.

### 1. Draft from listing text (US1, SC-002)

1. Create a property from the listing text sample `es-01` (002 quickstart 3) and confirm its
   facts.
2. Open the guide: nine sections in order; House rules and Amenities hold the listing content
   labeled "From your listing"; the parking sentence of the description sits in Parking and
   transport; check-in at 3:00 pm shows in Arrival and access as a live fact.
3. Change the check-in time in the property details: Arrival shows the new time.

### 2. Edit, approve, hide, and custom sections (US1)

1. Add text with a list and a link to Appliances and how-tos, an entrance photo, and the 40-second
   video. The photo's stored variants carry no GPS data (AC-SEC-010).
2. Approve Amenities; edit House rules: both become Ready.
3. Hide Parking and transport: its topics leave the score. Add a custom section "Pool", rename it,
   and move it after Amenities.
4. Open the same section in a second browser, save there, then save in the first: the conflict
   dialog appears (FR-012).
5. Paste `<img src=x onerror=alert(1)>` and a styled document into a text item: only supported
   formatting remains; nothing runs (AC-SEC-008).

### 3. Locked fields (US2, AC-SEC-002, AC-SEC-003)

1. Add a lockbox code and the Wi-Fi password: the step-up dialog appears when the last sign-in is
   older than 10 minutes.
2. Insert the lockbox code into Arrival's text: the editor shows the label chip.
3. Reveal the lockbox code: it hides after 60 seconds; the reveal history lists it.
4. Type "door code 4821" in House rules: the code warning offers "Move to a locked field".
5. Make the Wi-Fi password public, then locked again: both events are in the security log.
6. As an agent of the workspace, open the guide: locked fields show only "Locked", and every
   write button is absent; a direct write call returns `403` and is logged (AC-SEC-001).
7. Run 21 reveals as one admin within an hour (seeded through the API): the 21st returns `429`,
   and Mailpit holds the owners' "reveal limit" email (FR-018).

### 4. Publish, edit, restore (US3, SC-009)

1. Before confirming the core facts of a CSV property, try to publish it: blocked.
2. On the first property, open Publish: unreviewed items are listed; warnings show missing
   emergency contacts and the phrase "reserva directo conmigo" placed in House rules (PC-06).
3. Publish: version 1. Edit Checkout: the status becomes "Published · unpublished changes", and
   the published preview still shows version 1.
4. Change the lockbox code: the published preview shows the placeholder, and the guest-facing
   value (spec 004) is the new one without republishing.
5. Publish version 2, restore version 1 as the draft, publish it as version 3, then unpublish.

### 5. Completeness and interview (US4, AC-SEC-004)

1. The guide shows its score and the missing topics in order.
2. Mark "Parking" as "Doesn't apply": the score rises.
3. Start the interview: the first question is the heaviest missing topic.
4. Answer one question by text in English and one by voice note (fixture WebM): "Transcribing…",
   then the transcript and the drafted text, labeled "From your interview", in the right section.
   The fake model's recorded input contains no "4821"; the host is told a code was removed.
5. Reach the lockbox topic: the locked-field form opens instead of a question.
6. Leave and come back: the interview resumes at the next question.

### 6. Translation (US5)

1. With Spanish and English as guide languages, save a Spanish section: within 2 minutes the
   English text appears as "machine translation" (fake model), with the locked-field chip, bold
   text, and link kept.
2. Edit the English text: it becomes "reviewed". Edit the Spanish source: English shows "out of
   date" with "Translate again" and "Keep as is".
3. Use up the daily AI limit (set `guide_ai_daily_limit = 1` for the workspace): translations show
   "pending" with the reset time, and editing still works (AC-SEC-012).

### 7. Uploads (US6, AC-SEC-005, AC-SEC-009)

1. Upload the washer manual: checking, reading, done; a suggestion appears in Appliances and how-tos
   labeled with the file name. Accept it with an edit; discard another.
2. Upload the scanned PDF with `GUIDE_SCANNED_PDF=true`: its text is recognized.
3. Upload the encrypted PDF and the fake `.jpg`: both rejected with their reasons.
4. Upload a photo of a lockbox showing "4821" for reading: the fake model's recorded input has no
   "4821", and no image was sent.

### 8. Shared content (US7, SC-007)

1. As an owner with two published properties, create a Checkout shared block and publish it: both
   guides show it marked "Shared", and each has a new version.
2. Override it in the second property, then edit and publish the shared block: only the first
   property changes; the second shows "The shared version changed".
3. Exclude the block in the first property: it disappears from that guide's draft.

### 9. Duplicate and remove (FR-067, FR-068)

1. Duplicate the first property: the copy's guide holds the sections, media, and custom sections,
   labeled "Copied from …"; its locked fields have labels and no values.
2. Remove the original and restore it: the guide returns as it was.

### 10. Tenant isolation and logging (AC-SEC-006, AC-SEC-011)

1. From workspace B, request workspace A's guide, items, versions, media, locked fields, and shared
   blocks by ID: every request returns `404`.
2. Search the API logs, worker logs, and the fake model's recorded inputs for the codes used above:
   none appears.

## Automated checks

```bash
pnpm test
```

```bash
pnpm test:integration
```

```bash
pnpm lint:rls
```

```bash
pnpm test:e2e
```

```bash
pnpm --filter @guidesk/portal run build && pnpm --filter @guidesk/portal run bundle:check
```

The guide drafting, interview, and translation eval suites need `ANTHROPIC_API_KEY` and run in CI
on every pull request when the secret is present ([research R6](research.md#r6-ai-calls)).

## Done when

- Every scenario above passes, locally and on staging.
- CI is green: lint, typecheck, unit, integration (including RLS and cross-tenant tests), end to
  end, bundle and Lighthouse budgets, and the eval suites.
- Production flags stay off until their gates close ([research R22](research.md#r22-rollout-flags-and-production-gates)).
