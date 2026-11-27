# Feature Specification: Staging Feedback Polish (Phase 2)

**Feature Branch**: `021-feedback-polish`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "021 Medium and low items of the staging feedback of 2026-11-26: O-01 clearer 'Pega tu anuncio'; O-02 prefill the country from the profile; O-03 'Amenidades' instead of 'Comodidades'; O-04 steps per platform to find the calendar link; O-06 'Sincronizado desde Airbnb' instead of 'De un calendario'; O-07 a button for the next step 'armar la guía'; G-03 drafted text split into many small items; G-04 item buttons out of order; G-05 'Clave' instead of 'Valor' with show/hide; G-06 a custom title for shared content; A-01 the property assistant looks locked; A-02 'Responde y pregunta solo' is unclear; L-01 finding a property by name; P-01 answered (Free includes AI replies during the pilot), no change."

**Sources**: staging feedback 2026-11-26 · specs 002, 003, 007 · code diagnosis 2026-11-26

## Clarifications

### Session 2026-11-26

Answered with the recommended option under the founder's standing instruction.

- Q: How is G-03 fixed without changing the AI prompt (which needs paid evals)? → A: Drafted pieces
  for the same section and topic are joined into one item, paragraph by paragraph, before they are
  saved (listing paste and interview). No prompt change.
- Q: Drag and drop for items (G-02)? → A: Phase 3, with the interview redesign; this phase only orders
  the item buttons (G-04): approve first, then move up and down, then delete apart.
- Q: G-06 titles? → A: Shared content already has a name; the editor lets the host change it and
  the list shows it.
- Q: L-01? → A: The property list filters as you type (after a short pause), no Enter needed.
- Q: A-01? → A: Clearer texts: the property follows the workspace settings until the host unticks
  "Usar los ajustes del espacio"; only owners and admins change them (unchanged rule).
- Q: A-02 wording? → A: "Te sugiere la respuesta" (draft), "Responde si está en la guía" (auto),
  "Responde y hace preguntas de seguimiento" (full auto), each with a one-line example.

## Requirements *(mandatory)*

- **FR-001**: "Pega tu anuncio" MUST say to paste everything the listing or current guide has
  (description, rules, check-in, Wi-Fi name, amenities) and show an example in the text box.
- **FR-002**: A new property's facts form MUST start with the country the user gave at sign-up.
- **FR-003**: Spanish texts MUST say "Amenidades" wherever they said "Comodidades".
- **FR-004**: The calendars card MUST explain, per platform (Airbnb, Booking.com, Vrbo, other), where to
  copy the calendar link.
- **FR-005**: Feed stays MUST read "Sincronizado desde {canal}".
- **FR-006**: The property's next-step card MUST have a button that opens the guide.
- **FR-007**: Drafted pieces for the same section and topic MUST be saved as one item.
- **FR-008**: Item buttons MUST read: approve (when shown), move up, move down, then delete apart.
- **FR-009**: Locked-field forms MUST label the value "Clave" with a show/hide control.
- **FR-010**: Shared content MUST let the host rename it.
- **FR-011**: The property list MUST filter by name as the user types.
- **FR-012**: Assistant settings MUST use the clearer level names, examples, and inheritance texts.

## Success Criteria *(mandatory)*

- **SC-001**: Every item above can be checked on staging in the order listed, in Spanish and English.
- **SC-002**: A listing paste with an arrival description produces one arrival item per topic.

## Assumptions

- No migration, no prompt change, no new dependency.
