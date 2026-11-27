# Tasks: Interview and Photo Upload Fixes

- [X] T001 [US2] Tests first: resume with another section rescopes the session; a failed turn moves on (apps/api/test/integration/interviews.test.ts)
- [X] T002 [US2] `start()` rescopes on resume; `nextQuestion` counts done and failed turns; `asksMedia` on media-only topics (apps/api/src/interviews/interviews.service.ts, packages/contracts/src/guides.ts, packages/domain/src/guides/topics.ts)
- [X] T003 [US3] Tests first: text answers to media-only topics leave the topic missing (apps/worker/test/integration/interview-answer.test.ts)
- [X] T004 [US3] Worker skips the topic tag on text items for media-only topics (apps/worker/src/jobs/interview-answer.ts)
- [X] T005 [US1] Inline protected-field form for code questions and after redactions (apps/portal/components/guide/interview-code-field.tsx, interview.tsx)
- [X] T006 [US2] Stalled state unlocks controls after 60 s (interview.tsx)
- [X] T007 [US3] Attach button on media-only questions adds the file to the section (interview.tsx)
- [X] T008 [US4] Specific upload failure messages (apps/portal/components/guide/media-upload.tsx, i18n)
- [X] T009 [US4] Read the staging logs for a failed upload and fix the root cause
- [X] T010 Texts in Spanish and English; typecheck, lint, tests, bundle check; PR, merge, staging check
