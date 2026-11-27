# Feature Specification: Interview v2, Drag and Drop, and Setup Steps (Phase 3)

**Feature Branch**: `022-interview-v2-drag`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "022 Phase 3 of the staging feedback of 2026-11-26: a new interview where the AI's draft comes first and the interview asks only what is missing (R1), one question per screen with a fixed 'Guardar y seguir' button at the bottom that saves and moves on, with attach buttons when the question asks for a photo or video (R9); drag and drop to order the items of a section instead of arrows (G-02), usable with the keyboard; and the property's setup steps as cards with their state, the next one as the main button (R8, left from phase 2)."

**Sources**: staging feedback 2026-11-26 (E-01 to E-04, G-02, O-04, O-07, Enso R1, R8, R9) · specs 003, 020, 021

## Clarifications

### Session 2026-11-26

Answered with the recommended option under the founder's standing instruction.

- Q: Does R1 need new AI work? → A: No. Pasting the listing already drafts all sections and the
  interview already asks only about topics the guide is missing. The interview now says so, shows how
  many questions are left, and the host never waits for a draft between questions.
- Q: What does "Guardar y seguir" do with a text or voice answer? → A: It stores the answer, shows the
  next question at once, and the draft is written in the background. A list of the session's answers
  shows each one's state (writing, in the guide, not understood) with "Responder de nuevo" for the
  ones that failed.
- Q: A code typed in a text answer? → A: The code is removed as today; before the next question the
  screen offers to save it as a protected field, or to continue without saving it.
- Q: Keep the arrows next to drag and drop? → A: No. One drag handle per item: drag with the mouse or a
  finger, or focus it and use the arrow keys (Home and End to the first and last place). Shared
  content items keep their place and have no handle.
- Q: Setup steps? → A: Four cards on the property page: property details, calendar (optional),
  build the guide (done at 80% complete), publish. The first step not done carries the main button.
- Q: Combine two items into one? → A: Out of scope; feature 021 already saves one item per topic for
  new drafts.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An interview that keeps moving (Priority: P1)

A host opens the interview from the guide or a section. Each screen has one question, how many are
left, and a fixed bottom bar with "Guardar y seguir" and "Saltar". Saving moves to the next question
immediately; drafts appear in the guide while the host keeps answering.

**Acceptance Scenarios**:

1. **Given** a text question, **When** the host types an answer and presses "Guardar y seguir",
   **Then** the next question shows without waiting for the draft, and the answer appears in the
   session's list as "Redactando…" until it is in the guide.
2. **Given** an answer that contained a code, **When** it is saved, **Then** the screen offers the
   protected-field form for that code, with "Seguir sin guardarla".
3. **Given** a draft that failed, **When** the host presses "Responder de nuevo" in the list,
   **Then** that question shows again and a new answer is drafted.
4. **Given** a photo or code question, **When** the host attaches the file or saves the code,
   **Then** the next question shows.
5. **Given** no questions left, **When** the screen shows the end, **Then** it says how many answers
   were added and offers "Revisar la guía" and "Terminar".

### User Story 2 - Drag items into order (Priority: P1)

A host drags an item by its handle to a new place in the section, with a mouse or a finger. A
keyboard user focuses the handle and presses the arrow keys. The new order is saved once.

**Acceptance Scenarios**:

1. **Given** a section with several items, **When** the host drags one to another place and drops it,
   **Then** the list shows the new order and it is saved in one write.
2. **Given** the handle has focus, **When** the host presses Arrow Down, **Then** the item moves one
   place down, focus stays on its handle, and a screen reader hears the new position.
3. **Given** a drag in progress, **When** the host presses Escape, **Then** the order goes back.

### User Story 3 - Setup steps with their state (Priority: P2)

The property page shows four step cards with a done or pending state; the first pending step has
the main button.

**Acceptance Scenarios**:

1. **Given** a new property with confirmed details and no calendar, **When** the host opens it,
   **Then** "Datos" is done, "Calendario" is pending and optional, and "Arma tu guía" carries the main
   button.
2. **Given** a published guide, **When** the host opens the property, **Then** every required step is
   done.

### Edge Cases

- A draft still writing when the host finishes: the end screen says it is still being written.
- Two quick saves: each answer is its own turn; a topic with an answer in flight is not asked again.
- An agent (no code permissions) at a code question: the existing message, and "Saltar".
- Dropping an item on its own place writes nothing.
- A write conflict while ordering: the existing reload message.

## Requirements *(mandatory)*

- **FR-001**: The interview MUST show one question per screen with the number of questions left.
- **FR-002**: A fixed bottom bar MUST hold "Guardar y seguir" (for text and voice answers) and
  "Saltar"; code and photo questions advance when the code is saved or the file attached.
- **FR-003**: Saving an answer MUST show the next question without waiting for its draft.
- **FR-004**: The session's answers MUST be listed with their state; failed ones MUST offer
  "Responder de nuevo".
- **FR-005**: A code removed from an answer MUST be offered for saving before the next question.
- **FR-006**: The interview MUST say that it asks only what the guide is missing; the end screen MUST
  count the answers added and link to the guide.
- **FR-007**: Section items MUST be reorderable by dragging a handle (mouse and touch) and by the
  keyboard (arrows, Home, End, Escape), with the new position announced; one write per drop.
- **FR-008**: The property page MUST show the setup steps (details, calendar, guide, publish) with
  their state and the next step as the main button.
- **FR-009**: The property detail MUST include the guide's status and completeness.

## Success Criteria *(mandatory)*

- **SC-001**: A host answers five text questions in a row without waiting for any draft.
- **SC-002**: Moving an item from last to first takes one drag (or one Home key) and one write.
- **SC-003**: Every item is checkable on staging in Spanish and English, on a phone and a computer.

## Assumptions

- No migration, no prompt change, no new dependency; the portal route budget (175 KB) holds.
- The interview API already accepts an answer for any topic in scope and skips topics with an
  answer in flight; it gains the count of questions left.
