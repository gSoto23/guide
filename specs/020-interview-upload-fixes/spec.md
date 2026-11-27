# Feature Specification: Interview and Photo Upload Fixes

**Feature Branch**: `020-interview-upload-fixes`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "020 Fixes from the staging feedback of 2026-11-26 (phase 1, high priority): E-01 the interview does not save or move on at a protected-field question; E-02 answering the supermarket question takes the user to another part of the app; E-03/E-04 the interview asks for a photo or a short video but has no way to attach it; G-01 adding a photo to a guide section fails with a message that does not explain why."

**Sources**: staging feedback 2026-11-26 (IDs E-01 to E-04, G-01) · [Spec 003 US4 (AI interview), FR-009, FR-034 to FR-038](../003-guide-builder/spec.md) · code diagnosis 2026-11-26 (research.md)

## Clarifications

### Session 2026-11-26

Answered with the recommended option under the founder's standing instruction.

- Q: How does the interview handle a code (Wi-Fi password, door, gate, or lockbox code)? → A: The question
  shows a small protected-field form right there (type, name, value), saved encrypted as a locked field
  of that section after the usual identity check, and the interview moves to the next question. It
  never sends the host to another page. Members who cannot manage codes see why and can skip.
- Q: What if a host types a code in a normal answer? → A: As today, the code is removed before the
  answer is stored or sent to the AI. The interview then offers the same form to save it as a protected
  field.
- Q: What happens after an answer fails or takes too long? → A: A failed answer shows its message and
  the interview moves on (the topic stays in "missing" for later). If the draft takes more than a
  minute, the screen stops waiting and lets the host continue; the draft appears in the guide when ready.
- Q: Which questions start first when coming from a section's "Responder en la entrevista"? → A: That
  section's. Resuming an interview always follows the section the host asked for, or the whole guide.
- Q: How are photo and video questions answered? → A: With an attach button (photo, or photo and video)
  in the question, which adds the file to that section. A text answer to a photo question no longer
  counts as having the photo.
- Q: What does a failed photo upload say? → A: The specific reason: too large, format not supported,
  could not be checked for safety yet (try again), or a network problem; never a generic error.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Codes inside the interview (Priority: P1)

A host reaches "Contraseña del Wi-Fi" in the interview, types the network password in the field the
question shows, confirms their identity once, and the interview moves to the next question. The
password is stored encrypted and listed in the Wi-Fi section.

**Acceptance Scenarios**:

1. **Given** a code question, **When** an owner or admin saves a value, **Then** a locked field of
   that kind is created in that section and the next question appears without leaving the interview.
2. **Given** the arrival code question, **When** the host picks door, gate, or lockbox code, **Then**
   the field gets that kind.
3. **Given** an agent, **When** a code question comes up, **Then** they see that an owner or admin
   saves codes, and can skip it.
4. **Given** a text answer that contains a code, **When** it is sent, **Then** the code is not stored
   with the answer and the interview offers to save it as a protected field.

### User Story 2 - The interview never loops, freezes, or jumps elsewhere (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an answer whose draft fails, **When** the result arrives, **Then** its message shows and
   the next question appears.
2. **Given** a draft that takes over a minute, **When** the wait ends, **Then** the answer box and
   buttons are usable again with a note that the draft will appear in the guide.
3. **Given** an active interview and "Responder en la entrevista" on the local recommendations
   section, **When** the interview opens, **Then** its questions are from that section.

### User Story 3 - Attach photos and videos from the interview (Priority: P1)

**Acceptance Scenarios**:

1. **Given** "¿Puedes agregar una foto de la entrada o de la caja de llaves?", **When** the host attaches
   a photo, **Then** it is added to the arrival section and the next question appears.
2. **Given** "¿Puedes agregar una foto o un video corto de cómo usar un aparato?", **When** the host
   attaches a video, **Then** it is added to the appliances section.
3. **Given** a photo question answered with text, **When** the guide's completeness is computed, **Then**
   the photo topic is still missing.

### User Story 4 - Photo uploads that work and explain failures (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a JPEG, PNG, WebP, or HEIC photo under 10 MB on staging, **When** it is added to a section,
   **Then** it appears in the section.
2. **Given** a file that is too large, of an unsupported format, still being checked after the wait, or
   cut by the network, **When** the upload ends, **Then** the message names that reason and what to do.

### Edge Cases

- The identity check is cancelled: nothing is saved and the form stays filled.
- The section has no guide yet: the code is saved; the interview still moves on.
- Two answers in flight: questions with an answer in flight are skipped as today.

## Requirements *(mandatory)*

- **FR-001**: Code questions MUST show an inline protected-field form (kind preselected from the topic,
  name optional, value required) that creates the locked field in the question's section with the
  existing locked-field rules (encryption, identity check, owners and admins only), then refreshes the
  interview.
- **FR-002**: When an answer had codes removed, the interview MUST offer the same form.
- **FR-003**: A topic whose answer failed MUST NOT be asked again in the same session; done and failed
  answers both count as answered.
- **FR-004**: After 60 seconds of waiting for a draft, the interview MUST unlock its controls and say
  the draft will appear in the guide when ready.
- **FR-005**: Opening the interview with a section MUST scope the active session to that section;
  opening it without one MUST scope it to the whole guide.
- **FR-006**: Questions whose topic is covered only by photos or videos MUST offer an attach button
  that adds the file to the question's section; text drafted for such a question MUST NOT mark the
  topic covered.
- **FR-007**: Photo and video uploads MUST end with a specific message for each failure reason
  (too large, unsupported type, unreadable, malware, not checked yet, network).
- **FR-008**: Staging MUST complete photo uploads (root cause found in the logs and fixed).

## Success Criteria *(mandatory)*

- **SC-001**: In a test interview, every question either moves on after an answer, a saved code, an
  attached file, or a skip; none repeats in the same session.
- **SC-002**: A photo under 10 MB uploads on staging and shows in its section.
- **SC-003**: No upload failure shows the generic "Algo salió mal".

## Assumptions

- The locked-field create route and its identity check (spec 003) stay as they are.
- No prompt or model change, so no new evals are needed.
