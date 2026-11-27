# Implementation Plan: Interview and Photo Upload Fixes

**Branch**: `020-interview-upload-fixes` | **Date**: 2026-11-26 | **Spec**: [spec.md](spec.md)

## Summary

Fixes for the high-priority staging feedback: codes saved inside the interview, no loops or freezes,
the interview follows the requested section, photo and video questions get an attach button, and
uploads explain failures; the staging upload root cause is fixed after reading the logs
([research](research.md)).

## Technical Context

TypeScript 6 on Node 24; NestJS API, pg-boss worker, Next.js portal; no new dependencies, no migration,
no prompt change. Tests: Vitest (domain, API and worker integration), portal unit tests.

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-First | Spec 020 with clarifications | [x] |
| III. Human-in-the-Loop | Drafts stay unreviewed items; codes saved only by owners and admins | [x] |
| V. Test-First | Tests per story; no prompt change, no evals | [x] |
| VI. Security | Codes still never stored in answers or sent to the AI; locked fields keep encryption and the identity check (SEC-05, SEC-06) | [x] |
| VII. Simplicity | Reuses the locked-field route, the step-up hook, and the upload button | [x] |
| Performance | Portal route budget 175 KB | [x] |

## Project Structure

```text
apps/api/src/interviews/interviews.service.ts   # resume scope, answered turns, asksMedia
packages/contracts/src/guides.ts                 # InterviewQuestion.asksMedia
apps/worker/src/jobs/interview-answer.ts         # no topic tag on text for media-only topics
packages/domain/src/guides/topics.ts             # isMediaOnlyTopic helper
apps/portal/components/guide/interview.tsx        # inline code form, stalled state, attach
apps/portal/components/guide/interview-code-field.tsx (new)
apps/portal/components/guide/media-upload.tsx     # specific failure messages
packages/i18n/messages/{es,en}.json
infra/ (if the logs show the scan never completes)
```
