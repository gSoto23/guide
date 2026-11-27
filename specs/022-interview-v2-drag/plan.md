# Implementation Plan: Interview v2, Drag and Drop, and Setup Steps (Phase 3)

**Branch**: `022-interview-v2-drag` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

## Summary

The interview stops waiting for drafts: one question per screen, a fixed "Guardar y seguir" bar,
answers drafted in the background with their state listed, and the number of questions left. Section
items get a drag handle that works with mouse, touch, and keyboard. The property page shows the setup
steps as cards with their state.

## Technical Context

TypeScript 6 on Node 24; NestJS API, Next.js portal; no new dependency, no migration, no prompt
change. Tests: API integration (interview `remaining`, property detail `guide`), portal unit tests
for the pure ordering helper.

## Decisions

- **Questions left**: `nextQuestion` becomes `pendingQuestions` (same rules); the view returns the
  first as `question` and the count as `remaining`. Topics with an answer in flight are not counted.
- **Background drafts**: after an answer the portal reloads the session (the next question comes
  from the API) and polls the session every 3 seconds while any turn is in flight, for at most 3
  minutes. The question on screen changes only on the host's action, never under their typing.
- **Retry**: "Responder de nuevo" shows that topic's catalog question again; the API already accepts
  an answer for any topic in scope.
- **Codes in answers**: the POST answer response already carries the redaction counts; when any is
  positive the code form shows before the next question.
- **Drag and drop**: pointer events on a handle (`touch-action: none`), the target place from the
  other items' midpoints, live preview order, one `PUT items/order` on drop; arrow keys, Home, End on
  the focused handle write at once and keep focus; an `aria-live` region announces the place. A pure
  `moveItem(ids, from, to)` helper is unit tested. Shared items keep their slots.
- **Setup steps**: computed in the portal from `PropertyDetail` (`setupStatus`, `calendarStatus`,
  `source`, new `guide`), replacing the single next-step card.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-First | Spec 022 with clarifications | [x] |
| III. Human-in-the-Loop | Drafts stay unreviewed items | [x] |
| V. Test-First | API tests for `remaining` and `guide`; unit tests for ordering | [x] |
| VI. Security | Codes still never stored in answers; protected fields keep the identity check | [x] |
| VII. Simplicity | No new route, table, or dependency | [x] |
| Performance | Portal route budget 175 KB | [x] |
| Accessibility | Keyboard ordering, announcements, focus kept; WCAG 2.2 AA (2.5.7 dragging alternative) | [x] |

## Project Structure

```text
packages/contracts/src/guides.ts                    # InterviewView.remaining
apps/api/src/interviews/interviews.service.ts       # pendingQuestions, remaining
apps/api/src/properties/properties.service.ts       # detail.guide
apps/portal/components/guide/interview.tsx          # v2 flow
apps/portal/components/guide/interview-code-field.tsx # submit label, continue without saving
apps/portal/lib/use-sortable.ts (new)               # drag and keyboard ordering
apps/portal/components/guide/section-editor.tsx     # sortable list
apps/portal/components/guide/item-card.tsx          # handle instead of arrows
apps/portal/components/properties/setup-steps.tsx (new)
apps/portal/components/properties/property-facts.tsx
apps/portal/app/globals.css
packages/i18n/messages/{es,en}.json
```
