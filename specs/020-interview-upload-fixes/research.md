# Research: Interview and Photo Upload Fixes

**Date**: 2026-11-26 · code diagnosis of the staging feedback

- **R1 (E-01)**: code topics (`wifi.password`, `arrival.access_code`) return `opensLockedField` and the
  UI only linked to the locked-fields page, which does not preselect the kind, does not return to the
  interview, and leaves the topic missing, so the question came back. Decision: an inline form in the
  question that posts to the existing locked-fields route (`kind`, optional `label`, `value`,
  `sectionKind`) through the same identity check (`useStepUp`). Coverage (`lockedField` rule) then
  passes and `nextQuestion` moves on. Agents cannot create locked fields (capability
  `restricted.reveal`): they see why and skip.
- **R2 (E-01)**: codes typed in a text answer are removed before storage (`redactRestrictedValues`) by
  design; the leftover often drafts nothing and the turn fails, and `nextQuestion` only counted `done`
  turns, so the topic repeated. Decision: failed turns count as answered; after a redaction the UI
  offers the inline form.
- **R3 (freeze)**: polling stops after 60 s but the last turn stays queued, so `inFlight` kept the
  controls disabled. Decision: a stalled flag unlocks them with a note.
- **R4 (E-02)**: `start()` resumed the active session and ignored the requested section. Decision: on
  resume, set the session's scope to the requested section (or the whole guide when none).
- **R5 (E-03/E-04)**: media topics were asked as text and the worker tagged drafted text items with the
  topic, which counted as covered. Decision: the question view says when a topic is media-only
  (`asksMedia`), the UI shows the existing `MediaUploadButton` and adds the file to the section; the
  worker no longer tags text items with media-only topics.
- **R6 (G-01)**: uploads wait for the GuardDuty malware scan (worker retries up to ~2 min; the UI gives up
  after 60 s). The UI mapped several failures to the generic error. Decision: specific messages per
  reason, including "still being checked" and network errors; the staging root cause is checked in the
  logs (founder sign-in needed) and fixed in infrastructure if the scan never completes.
