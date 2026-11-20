# Feature Specification: Property Photos and Initials Avatars

**Feature Branch**: `016-property-photos`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Phase C of docs/brand/brand-application-audit.md: a cover photo per property (in the guest guide, its link preview, the portal cards and header, and the QR poster), an optional photo per extra, prompts to add photos where they help most, a welcome by the guest's first name, and avatars. Phase D (public home hero and demo photos) will use the founder's own photos."

**Sources**: [Brand application audit](../../docs/brand/brand-application-audit.md) §3 · [Brand guide](../../docs/brand/README.md) §6 · [Performance](../../docs/architecture/performance.md) · [Security](../../docs/architecture/security.md) (SEC-10, SEC-11, SEC-20) · Spec 003 (guide media, storage limit FR-065), 004 (guest guide, FR-028), 008 (extras), 015 (brand shell, link previews)

## Clarifications

### Session 2026-11-19

Answered with the recommended option under the founder's standing instruction to run all phases; the
founder can change any of them.

- Q: Does the guest guide greet the guest by first name? → A: Not in this feature. Spec 004 FR-028
  keeps guest names off the guest guide (a forwarded stay link would reveal the name), and the
  guest's name is confidential data. The guide keeps its current stay card. **Founder decision
  (2026-11-20): keep guest names off the guide.**
- Q: Do avatars use the Google profile picture? → A: No. Avatars show the person's initials on a
  brand-tinted circle. Google pictures live on a third-party host that the portal's content policy
  blocks, and loading them would tell Google when the portal is open.
- Q: Where does a cover photo come from? → A: The host uploads one (the same upload as guide
  photos). Listing imports do not bring photos today.
- Q: What do the demo and the public home use? → A: The founder's own photos, in phase D.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A cover photo for each property (Priority: P1)

A host adds a cover photo to a property. Guests see it at the top of the guide, the link preview
shows it when the guide link is shared, and the host recognizes each property by its photo in the
portal and on the QR poster.

**Why this priority**: Photos make the guide feel like the house and help hosts tell properties
apart; it is the biggest visual change of the audit.

**Independent Test**: Add a cover to Casa Brisa from its property page; open the guide on a phone,
the property list, the QR poster, and read the guide's preview tags.

**Acceptance Scenarios**:

1. **Given** a property without a cover, **When** the host opens its page, **Then** a "cover photo"
   area invites them to add one, with a short hint of what makes a good cover.
2. **Given** the host picks a photo, **When** it finishes processing, **Then** it shows as the cover
   with an editable description (alternative text) prefilled with the property name, and the host
   can change or remove it.
3. **Given** a published guide with a cover, **When** a guest opens the home, **Then** the photo shows
   at the top with a fixed shape (no layout shift), the stay times and tiles stay readable on the
   first screen of a phone, and the photo has the host's description as alternative text.
4. **Given** a guide with a cover, **When** a messaging app reads the guide link, **Then** the preview
   image is the cover; without a cover it stays the branded image.
5. **Given** properties with and without covers, **When** the host opens the property list, **Then**
   each card shows its cover or a branded placeholder with the house icon.
6. **Given** a cover, **When** the host prints the QR poster, **Then** the photo appears above the
   property name.
7. **Given** a cover removed or replaced, **When** the old photo is no longer used anywhere, **Then**
   it is deleted by the regular media cleanup and stops counting toward storage.

---

### User Story 2 - Photos on extras (Priority: P2)

A host adds a photo to an extra (an airport pickup van, a surfboard). Guests see it in the extras
list and on the extra's page.

**Why this priority**: Offers with a picture are easier to understand and sell; it reuses the same
upload.

**Independent Test**: Add a photo to the surfboard rental, open the guest extras list and detail.

**Acceptance Scenarios**:

1. **Given** the extra form, **When** the host adds a photo and saves, **Then** the extra keeps it and
   the portal list shows a thumbnail.
2. **Given** a visible extra with a photo, **When** a guest opens Extras, **Then** the card shows the
   photo with a fixed shape, and the extra's page shows it larger.
3. **Given** the host removes the photo, **When** the extra is saved, **Then** guests no longer see it.
4. **Given** an extra copied to other properties, **When** the copies are created, **Then** they keep
   the same photo.

---

### User Story 3 - Prompts to add photos where they help most (Priority: P3)

While editing the guide, the host sees a short suggestion in sections where a photo answers questions
better than text: the door or lockbox (arrival), the parking spot, the router (Wi-Fi), the
appliances, and the checkout checklist.

**Why this priority**: Photos in these sections prevent guest questions; the prompt is small.

**Independent Test**: Open the arrival section of a guide without photos and see the suggestion;
add a photo and see it disappear.

**Acceptance Scenarios**:

1. **Given** an arrival, parking, Wi-Fi, appliances, or checkout section with no photo, **When** the
   host opens it, **Then** a suggestion explains which photo helps, next to the existing add-photo
   action.
2. **Given** the section gets a photo, **When** the host returns, **Then** the suggestion no longer
   shows.

---

### User Story 4 - Initials avatars (Priority: P3)

Team members appear with an initials avatar in the member list, in the sidebar's account entry, and
where the inbox shows who took over a conversation.

**Why this priority**: It makes the team visible at a glance; it needs no images.

**Independent Test**: Open Team with two members and a conversation taken over by one of them.

**Acceptance Scenarios**:

1. **Given** a member named "Ana Mora", **When** the member list renders, **Then** an avatar shows
   "AM" on a tinted circle next to the name; with no name, the first letter of the email.
2. **Given** a wide screen, **When** the sidebar renders, **Then** an account entry at the bottom shows
   the signed-in person's avatar and name, linking to account settings.
3. **Given** a conversation taken over by a member, **When** the inbox or the conversation shows it,
   **Then** the taker's initials avatar appears next to the text.

---

### Edge Cases

- A cover still processing or rejected (unsafe file, storage limit) is not shown to guests; the host
  sees the status and the reason.
- The workspace is at its storage limit: the upload is refused with the existing message.
- A photo belongs to another workspace or is a video: the API refuses it as a cover or extra photo.
- A guest opens the guide offline: the cover follows the existing image caching rule; without a
  saved copy it is skipped and the page still works.
- The property has no guide yet: the cover area explains that the guide is created first.
- A very tall or very wide photo is cropped to the cover shape on screen; the stored photo is kept
  whole.
- Names with one word, accents, or emoji produce one or two letters; empty names fall back to the
  email.
- Removing a property or an extra releases its photo for the media cleanup.

## Requirements *(mandatory)*

### Functional Requirements

**Cover photo**

- **FR-001**: Each property MUST have at most one cover photo and an alternative text of up to 160
  characters, defaulting to the property name.
- **FR-002**: Hosts who can manage properties MUST be able to set, replace, and remove the cover
  from the property page, using the same upload, processing, scanning, and storage limit as guide
  photos.
- **FR-003**: The API MUST accept as a cover only a ready image of the same workspace.
- **FR-004**: The guest guide home MUST show the cover above the title in a fixed 16:9 shape with
  responsive image sizes, without shifting the layout, keeping the guide within its performance
  budgets.
- **FR-005**: The guest media route MUST serve a property's current cover (and its extras' photos)
  in addition to the photos of the published guide, and nothing else.
- **FR-006**: The guide's link preview image MUST be the cover when one exists, as an absolute URL
  on the guide's origin; otherwise the branded image (spec 015).
- **FR-007**: The portal MUST show the cover (or a branded placeholder) on the property cards, the
  property page, and the QR poster.

**Extras photos**

- **FR-008**: Each extra MUST accept an optional photo, set or removed in the extra form, with the
  same validation as a cover.
- **FR-009**: Guests MUST see a visible extra's photo in the extras list and on the extra's page in a
  fixed shape; copies of an extra keep the photo.

**Media lifecycle**

- **FR-010**: The media cleanup MUST treat property covers and extras photos as in use; once no
  longer referenced, they follow the existing two-day cleanup.

**Photo prompts**

- **FR-011**: The section editor MUST show a photo suggestion in arrival, parking, Wi-Fi,
  appliances, and checkout sections that have no photo, in Spanish and English.

**Avatars**

- **FR-012**: The portal MUST show initials avatars (up to two letters from the name, else the email)
  in the member list, the sidebar account entry, and conversation takeover notes; avatars are
  decorative next to the visible name.
- **FR-013**: No avatar or profile picture MUST be loaded from a third-party host.

**Portal images in AWS**

- **FR-014**: The portal's content security policy MUST allow images (and videos) from the
  workspace media origin set by the stage, so signed media URLs load in AWS as they do locally.

**Quality**

- **FR-015**: New and changed screens MUST meet WCAG 2.2 AA and the no-cut-text rule of spec 015;
  every new text exists in Spanish and English; the portal stays within 150 KB of JavaScript per
  route.

### Key Entities

- **Property cover**: a reference from a property to one ready image, plus its alternative text.
- **Extra photo**: a reference from an extra to one ready image.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host adds a cover photo in under one minute from the property page.
- **SC-002**: The guest guide home with a cover keeps LCP ≤ 2.5 s and CLS ≤ 0.1 on a mid-range phone
  over 4G, and its initial weight stays within 500 KB.
- **SC-003**: 100% of covers and extras photos still exist after the daily media cleanup while they
  are in use, and 100% of released ones are gone two days after release.
- **SC-004**: A shared guide link with a cover shows the cover in the preview.
- **SC-005**: Automated accessibility checks report 0 violations on the changed screens.

## Assumptions

- The guide row of a property exists before photos are uploaded (it does for every property created
  through onboarding).
- Duplicating a property copies its cover reference.
- The first-name welcome is out of scope and the founder decided on 2026-11-20 not to show guest
  names in the guide (Clarifications); the stay card is unchanged.
- Demo photos and the public home hero are phase D, with the founder's own photos.
