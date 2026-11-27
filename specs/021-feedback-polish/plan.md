# Implementation Plan: Staging Feedback Polish (Phase 2)

**Branch**: `021-feedback-polish` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

## Summary

Medium and low items of the staging feedback of 2026-11-26: clearer onboarding texts and steps, the
country prefilled, the calendar link explained per platform, the feed channel named, a next-step
button, drafted pieces on one topic saved as one item, item buttons grouped, codes with show/hide,
shared content renamed, the property list filtered as the host types, and clearer assistant texts.

## Technical Context

TypeScript 6 on Node 24; NestJS API, pg-boss worker, Next.js portal; no new dependency, no migration,
no prompt change, no new API route (shared content rename uses the existing `PATCH
/shared-blocks/:blockId` with `name`; the country comes from `GET /me/onboarding`).

## Decisions

- **G-03 (FR-007)**: a pure `mergeDraftPieces` helper in `packages/domain` joins pieces that share
  their main topic (first topic) within a group (the section), in first-seen order, drops repeated
  paragraphs, leaves untagged pieces apart, and starts a new piece past 4,000 characters (items allow
  20,000). Both the listing draft job and the interview answer job call it before saving. The fake
  model now returns one piece per paragraph so tests exercise the merge.
- **O-02 (FR-002)**: the facts form asks for the onboarding country once, only for a new property
  without a country from an extraction or a draft, and only fills it while the field is still empty.
- **L-01 (FR-011)**: the list search updates 300 ms after the last key; Enter still searches at once.
- **G-04 (FR-008)**: a flex row (approve, the two arrows together, delete pushed to the end) instead
  of the two-column grid that mixed the arrows with approve and delete on phones.
- **G-05 (FR-009)**: a small `SecretInput` shows what was typed; a saved value still needs the
  identity check to reveal.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-First | Spec 021 with clarifications | [x] |
| III. Human-in-the-Loop | Merged drafts stay unreviewed items | [x] |
| V. Test-First | Domain unit tests for the merge; worker test for the interview path | [x] |
| VI. Security | Show/hide only shows what the host is typing; saved codes keep the identity check (SEC-05, SEC-06) | [x] |
| VII. Simplicity | No new route, table, or dependency | [x] |
| Performance | Portal route budget 175 KB | [x] |

## Project Structure

```text
packages/domain/src/guides/drafting.ts            # mergeDraftPieces, MERGED_PIECE_MAX
apps/worker/src/jobs/guide-draft.ts               # merge before saving listing drafts
apps/worker/src/jobs/interview-answer.ts          # merge before saving interview drafts
packages/integrations/src/llm/fake.adapter.ts     # fake answer: one piece per paragraph
apps/portal/components/properties/listing-input.tsx    # example placeholder
apps/portal/components/properties/core-facts-form.tsx  # onboarding country
apps/portal/components/properties/calendar-feeds.tsx   # per-platform how-to
apps/portal/components/properties/stays-list.tsx       # "Synced from {channel}"
apps/portal/components/properties/property-facts.tsx   # next-step button
apps/portal/components/properties/property-list.tsx    # filter as you type
apps/portal/components/guide/item-card.tsx             # grouped item buttons
apps/portal/components/guide/locked-fields.tsx         # Code label, show/hide
apps/portal/components/shared-content/block-editor.tsx # rename
apps/portal/app/globals.css
packages/i18n/messages/{es,en}.json, guest.es.json, public/es.json
```
