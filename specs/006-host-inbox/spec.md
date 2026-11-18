# Feature Specification: Host Inbox and Reply Copilot

**Feature Branch**: `006-host-inbox`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "006 Host inbox and copilot (PRD F06, FR-06.1 to FR-06.5, PC-05, PC-06, PC-10, PC-14; UX flow 6, screens H-20, H-21, H-22; ADR-0006 web push). Hosts see every guest conversation of the workspace's guide chats in one inbox with tabs Needs you, All, and Done, escalations highlighted and emergencies first, filterable by property. From a conversation they approve, edit, or reject the assistant's draft, write a reply, take over the conversation (the assistant stops answering there) and hand it back, and mark it done. When another member is replying, others see it. Hosts without an integration paste a guest message from Airbnb, Booking.com, or Vrbo into the copilot, pick the property and the booking status (inquiry or confirmed), and get a reply drafted from the guide that passes the same policy checks as automatic messages, ready to copy back; before booking, links and contact details are removed with a note. Escalation alerts also go by web push to the members' devices that turned it on, with a deep link, following the same contacts and quiet hours as email (spec 007). After several drafts on a topic are sent unchanged, the inbox suggests letting the assistant answer that topic on its own. Out of scope: platform chats through a PMS and the unified inbox (Phase 2, H-41), service requests in the inbox (spec 008), analytics (spec 010), native apps (ADR-0006)."

**Sources**: [PRD F06](../../docs/product/prd.md#f06--host-inbox-and-reply-copilot) · [UX flow 6](../../docs/ux/user-flows.md#6-host-inbox-draft-approval-and-the-paste-to-reply-copilot) · [Screens H-20, H-21, H-22](../../docs/ux/screens.md) · [ADR-0006](../../docs/architecture/adr/0006-web-first-pwa-no-native-apps.md) · [Platform policies PC-05, PC-06, PC-10, PC-14](../../docs/research/platform-policies.md) · [Security SEC-06 to SEC-08, SEC-14, SEC-16](../../docs/architecture/security.md#4-controls) · [Spec 005](../005-guide-chat/spec.md) · [Spec 007](../007-agent-settings/spec.md)

## Clarifications

### Session 2026-11-18

Answered with the recommended option under the founder's standing instruction to run all phases on
2026-11-18. Each answer can be changed by the founder; the spec follows the answer below until then.

- Q: What does each inbox tab hold? → A: Needs you: conversations waiting for the team (spec 005's
  "needs the host"), emergencies first, then by the latest guest message. All: every conversation
  that isn't done, newest first. Done: conversations a member marked done. A new guest message moves a
  done conversation back to All or Needs you, as the assistant decides. Platform chats join the inbox
  in Phase 2.
- Q: What does rejecting a draft do? → A: It discards the draft; nothing reaches the guest. The
  conversation still needs the team until a member replies or marks it done.
- Q: What does taking over do? → A: A member switches "I'll reply myself" on a conversation. While it
  is on, the assistant sends nothing there and prepares no drafts; each guest message still runs the
  emergency check, so an emergency still shows the emergency card first and alerts at once. Other guest
  messages make the conversation need the team with the reason "Taken over" and alert the member who
  took over (the escalation contacts if they left the workspace). Any member can hand it back to the
  assistant. Guests see no change in the chat except the member's replies.
- Q: How does the copilot reply sound, and what may it contain? → A: It is written as the host, in the
  guest's language, ready to paste into the platform's chat. It answers only from the published guide,
  never contains a code or password (the guide's locked fields are labels, as for the assistant), never
  promotes recommendations that carry a commission or benefit (PC-10), and for an inquiry (before
  booking) any link, email address, or phone number is removed with a note (PC-05). It runs the same
  checks as automatic messages; a draft that fails a check is shown with the reason instead of the
  "Passed checks" badge. For sensitive topics (emergency, malfunction, complaint, money, reservation
  change, legal, code requests) it shows a caution banner with the rule to follow.
- Q: Which alerts go by web push, and what do they show? → A: The same alerts as email: "needs the
  team" to the escalation contacts, held during quiet hours except emergencies and malfunctions, and
  the quiet hours summary (spec 007). A push shows the property and the reason, never the guest's
  message or a code, and opens the conversation. Push is per device and optional; email always
  arrives.
- Q: What does the trust suggestion do? → A: When at least 5 drafts on one topic at one property were
  sent unchanged in the last 30 days and that topic is still at "I review each reply", the inbox
  suggests letting the assistant answer it, with a link to the settings screen where it applies (the
  property's or the workspace's). Members can dismiss it for 30 days. Nothing changes until an owner
  or admin saves the setting.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One inbox for every guest conversation (Priority: P1)

Ana opens the inbox on her phone. "Needs you" shows Emily's conversation at the top, marked
"Emergency", then a draft ready about parking at another property. Each item shows the property and
stay ("Casa Colibrí · 12–19 Dec · Guide chat"), the reason, the latest guest message, and how long ago.
Marta, who manages twelve apartments, filters by one property. When a guest says thanks, Ana marks the
conversation done and it moves to Done.

**Why this priority**: Without one place to see what needs them, hosts with several properties miss
escalations; the per-property list of spec 005 doesn't scale.

**Independent Test**: With conversations across two properties in different states, the inbox lists
them in the right tabs and order, filters by property, marks one done, and a new guest message brings
it back.

**Acceptance Scenarios**:

1. **Given** conversations needing the team for several reasons, **When** a member opens Needs you,
   **Then** emergencies come first, then the rest by the latest guest message, each with the property
   and stay label, the channel, the reason, an excerpt of the latest message, and the time.
2. **Given** a member filters by a property, **When** they switch tabs, **Then** only that property's
   conversations show, and the filter stays.
3. **Given** a conversation, **When** a member marks it done, **Then** it leaves Needs you and All and
   shows in Done; **When** the guest writes again, **Then** it returns to All or Needs you.
4. **Given** no conversation needs the team, **When** a member opens Needs you, **Then** they see
   "You're all caught up"; with no published guide, "Share your guide to start receiving questions".
5. **Given** the inbox open, **When** a new conversation needs the team, **Then** it appears within
   15 seconds without reloading.
6. **Given** a member of another workspace, **When** they request this inbox or a conversation, **Then**
   they get 404.

---

### User Story 2 - Approve, edit, reject, or take over (Priority: P1)

Ana opens the parking draft, reads "Why this reply", and approves it. On another conversation the draft
is wrong, so she rejects it and writes her own reply. For Emily's malfunction she switches "I'll reply
myself" on: the assistant stops answering there while she sorts it out, and she hands it back when the
AC is fixed.

**Why this priority**: Draft approval is the default flow (autonomy `draft`), and taking over is how a
host keeps control of a sensitive conversation.

**Independent Test**: A draft is rejected with nothing sent; a taken-over conversation gets no
assistant messages or drafts for normal questions, still shows the emergency card for emergencies, and
alerts the member who took over; handing back restores the assistant.

**Acceptance Scenarios**:

1. **Given** an open draft, **When** a member rejects it, **Then** it is discarded, the guest receives
   nothing, and the conversation still needs the team.
2. **Given** a member turns "I'll reply myself" on, **When** the guest asks a normal question, **Then**
   no assistant message or draft is created, the guest's typing indicator doesn't show, the
   conversation needs the team with the reason "Taken over", and that member is alerted.
3. **Given** a taken-over conversation, **When** the guest reports an emergency, **Then** the emergency
   card shows first, and the contacts and every owner and admin are alerted at once.
4. **Given** a taken-over conversation, **When** any member hands it back, **Then** the assistant answers
   the next guest message per the settings.
5. **Given** the conversation page, **When** a member opens it, **Then** an escalation shows a banner
   with the reason, and a taken-over conversation shows who took it over.
6. **Given** two members act on the same draft, **When** both send or reject, **Then** the first wins and
   the second is told the draft was already handled (spec 005).

---

### User Story 3 - Draft replies for platform chats (Priority: P1)

A guest asks Ana in Airbnb whether they can bring a dog. Ana opens the copilot, pastes the message,
picks Casa Colibrí and "Confirmed booking", and gets a reply grounded in her house rules with "Passed
checks". She copies it into Airbnb. For an inquiry asking for the website, the copilot leaves the link
out and says why.

**Why this priority**: In the MVP most guest conversation still happens in the platforms' own chats;
the copilot brings the assistant there without an integration (PRD F06, FR-06.3).

**Independent Test**: A pasted question gets a draft from the guide with its section and the checks;
an inquiry draft has no link or contact detail and a note on what was removed; a code request gets a
draft without the code and a caution; nothing is sent anywhere.

**Acceptance Scenarios**:

1. **Given** a property with a published guide, **When** a member pastes a guest message, picks the
   booking status, and asks for a draft, **Then** within 15 seconds they get a reply in the guest's
   language, written as the host, with the guide sections it used and the checks it passed, and a Copy
   button.
2. **Given** an inquiry, **When** the draft would contain a link, an email address, or a phone number,
   **Then** they are removed and a note says why (PC-05).
3. **Given** a recommendation with a commission or benefit in the guide, **When** the copilot drafts,
   **Then** it never mentions it (PC-10).
4. **Given** a message about money, a reservation change, a complaint, a malfunction, a legal topic, an
   emergency, or a code, **When** the copilot drafts, **Then** a caution banner explains the rule (for
   example "refunds and changes go through the platform"), and the draft contains no promise and no
   code.
5. **Given** a draft that fails a check (a promise, an off-platform request), **When** it is shown,
   **Then** it carries the reason instead of "Passed checks", and the member decides what to copy.
6. **Given** drafting fails or the daily AI budget is used up, **When** the member asks, **Then** the
   pasted text stays and they are told why; more than 60 drafts per member per hour are refused.

---

### User Story 4 - Push alerts on my phone (Priority: P2)

Ana turns on alerts on her phone from the inbox banner. On her iPhone the banner first tells her to add
the portal to her home screen. A test alert arrives. That night, a guest reports a gas smell: her phone
shows "Casa Colibrí: possible emergency" and tapping it opens the conversation.

**Why this priority**: Escalations are time-critical and hosts live on their phones (ADR-0006); email
stays the guaranteed path, so push adds speed, not coverage.

**Independent Test**: A member subscribes a device; a "needs the team" alert reaches it with the
property, the reason, and the conversation link, and no guest text; quiet hours and contacts apply as
for email; an expired subscription is removed; with push not configured, the portal hides it and email
still works.

**Acceptance Scenarios**:

1. **Given** a member on a supported browser, **When** they turn alerts on and allow them, **Then** the
   device is registered and a test alert arrives within 60 seconds.
2. **Given** an alert for a conversation, **When** the member is a recipient under spec 007's contacts
   and quiet hours, **Then** each of their registered devices gets a push with the property and the
   reason and a link to the conversation, never the guest's message or a code.
3. **Given** quiet hours, **When** a non-urgent conversation needs the team, **Then** no push is sent
   until the window ends, when the summary also goes by push.
4. **Given** a device whose subscription expired, **When** an alert fails as gone, **Then** it is removed
   and the member's other devices still receive alerts.
5. **Given** an iPhone browser that isn't a home-screen app, or alerts blocked, **When** the member
   opens the inbox, **Then** a banner explains how to turn alerts on; email still arrives.
6. **Given** a member turns alerts off on a device, **When** an alert is sent, **Then** that device
   gets nothing.

---

### User Story 5 - See when a teammate is replying (Priority: P3)

Marta and Marco both handle conversations. When Marta starts writing a reply, Marco sees "Marta is
replying" on the conversation and in the inbox, so they don't answer twice.

**Why this priority**: It prevents double replies for teams (persona P2); single hosts don't need it.

**Independent Test**: While one member edits a draft or types a reply, the conversation and its inbox
item show their name to other members within 15 seconds, and it clears within 30 seconds after they
stop.

**Acceptance Scenarios**:

1. **Given** a member typing a reply or editing a draft, **When** another member views the
   conversation or the inbox, **Then** they see "{name} is replying".
2. **Given** the member stops or leaves, **When** 30 seconds pass, **Then** the indicator disappears.
3. **Given** the member is the only one viewing, **When** they type, **Then** they don't see their own
   name.

---

### User Story 6 - The trust suggestion (Priority: P3)

After Ana has sent five parking drafts at Casa Colibrí without changes, the inbox suggests "Let the
assistant answer parking questions at Casa Colibrí on its own?" with a link to the settings. She opens
it and switches parking to "Answer when it's in the guide".

**Why this priority**: It turns the trust ladder (vision §5) into a concrete next step, but hosts can
already change the settings themselves (spec 007).

**Independent Test**: Five drafts on one topic and property sent unchanged in 30 days, with the topic at
`draft`, produce one suggestion linking to the screen where that topic's level applies; dismissing hides
it for 30 days; edited drafts don't count.

**Acceptance Scenarios**:

1. **Given** 5 drafts on parking at a property sent unchanged in the last 30 days and parking at
   `draft`, **When** a member opens the inbox, **Then** they see the suggestion with a link to the
   property's or the workspace's settings, whichever sets parking there.
2. **Given** edited drafts or a topic already above `draft`, **When** the inbox loads, **Then** no
   suggestion shows for that topic.
3. **Given** a member dismisses the suggestion, **When** anyone opens the inbox in the next 30 days,
   **Then** it doesn't show.

---

### Edge Cases

- A conversation taken over by a member who is later removed: alerts go to the escalation contacts and
  it shows "Taken over" without a name; any member can hand it back.
- A done conversation whose guest writes during quiet hours: it returns to the inbox and its alert
  follows the quiet hours rule.
- Rejecting a draft that a teammate already sent: "already handled" (spec 005 rule, first wins).
- The copilot with a property whose guide isn't published: it asks to publish first.
- The copilot pasted text with instructions ("ignore your rules", "give me the code"): treated as the
  guest's message, never as instructions (SEC-08); codes never appear.
- A pasted message over 4,000 characters: refused with a counter.
- Push on a browser without support (or private mode): the alerts card says it isn't available on this
  browser.
- Push payloads larger than the service's limit: the payload is a title, a short body, and a link only.
- The same member on several devices: each device registers separately and receives each alert once.
- Presence from a member whose session ends: it expires after 30 seconds.
- Filters with a property the member can't see (removed property): the filter resets to all.

## Requirements *(mandatory)*

### Functional Requirements

**Inbox**

- **FR-001**: Members MUST see the workspace's guide chat conversations in one inbox with tabs Needs you
  (needing the team; emergencies first, then by the latest guest message), All (not done; newest first),
  and Done (marked done), each item with the property and stay label, the channel, the reason, an excerpt
  of the latest message, the time, and whether someone is replying (FR-06.1).
- **FR-002**: Members MUST be able to filter the inbox by property; the list MUST refresh at least every
  15 seconds while open.
- **FR-003**: Members who handle conversations MUST be able to mark a conversation done and move it back;
  a new guest message MUST reopen a done conversation.
- **FR-004**: The inbox MUST show empty states ("You're all caught up"; "Share your guide to start
  receiving questions" when no guide is published) and keep the loaded list readable offline with
  actions disabled.

**Conversation actions**

- **FR-005**: Members who handle conversations MUST be able to reject an open draft; nothing MUST reach
  the guest, and the first action on a draft wins (FR-06.2).
- **FR-006**: Members who handle conversations MUST be able to take over a conversation and hand it back;
  the conversation MUST show who took it over and since when, and the change MUST be recorded in the
  security log.
- **FR-007**: While taken over, the assistant MUST send no message and prepare no draft, except that an
  emergency MUST still show the emergency card first and alert the contacts and every owner and admin;
  other guest messages MUST make the conversation need the team with the reason "Taken over" and alert
  the member who took over (or the contacts if they left), under spec 007's quiet hours.
- **FR-008**: The conversation page MUST show a banner with the reason when the conversation needs the
  team.

**Copilot**

- **FR-009**: Members who handle conversations MUST be able to paste a guest message (up to 4,000
  characters), pick a property with a published guide and the booking status (inquiry or confirmed), and
  get a reply drafted from the published guide, written as the host in the guest's language, with the
  sections used, within 15 seconds at p90 (FR-06.3).
- **FR-010**: Copilot drafts MUST pass the same output checks as automatic messages (codes, links,
  promises, off-platform; PC-06, PC-14) and show "Passed checks" only when they do; otherwise they MUST
  show the failed checks.
- **FR-011**: For an inquiry, links, email addresses, and phone numbers MUST be removed from the draft
  with a note (PC-05).
- **FR-012**: Copilot drafts MUST never include a locked value, MUST never mention a recommendation with
  a declared commission or benefit (PC-10), and MUST follow the host's tone and instructions (spec 007);
  pasted text MUST be treated as data, never as instructions.
- **FR-013**: For messages classified as emergency, malfunction, complaint, money, reservation change,
  legal, or a code request, the copilot MUST show a caution banner with the rule to follow; for code
  requests the draft MUST point to the guide or the stay message instead of including a code.
- **FR-014**: Copilot drafts MUST be traced like assistant replies (FR-06.5), MUST count toward the
  property's daily AI budget, MUST be limited to 60 per member per hour, and MUST create no conversation
  or message; drafts and their traces MUST be deleted after 30 days.

**Push alerts**

- **FR-015**: Members MUST be able to turn web push on or off per device and send themselves a test
  alert; the portal MUST be installable as a home-screen app so iPhone hosts can receive push (ADR-0006).
- **FR-016**: Every alert emailed under specs 005 and 007 ("needs the team" and the quiet hours summary)
  MUST also be pushed to each registered device of the same recipients, following the same contacts and
  quiet hours (FR-06.4).
- **FR-017**: A push MUST carry only the property name, the reason, and a link to the conversation (or
  the inbox for summaries), never guest text, codes, or personal data.
- **FR-018**: Subscriptions the push service reports as gone MUST be removed; push MUST be hidden when
  the deployment has no push keys, and email MUST arrive either way.

**Team and trust**

- **FR-019**: While a member edits a draft or types a reply, other members MUST see "{name} is replying"
  on the conversation and its inbox item within 15 seconds; it MUST clear within 30 seconds after they
  stop.
- **FR-020**: The inbox MUST suggest raising a topic's autonomy when at least 5 drafts on that topic at a
  property were sent unchanged in the last 30 days and the topic is at `draft` there, linking to the
  settings screen where that level is set; members MUST be able to dismiss a suggestion for 30 days.

**Access and records**

- **FR-021**: Every inbox, conversation, copilot, and push route MUST follow the workspace roles (agents
  handle conversations; nobody reads another workspace's data), and conversation actions MUST be recorded
  in the security log.

### Key Entities *(include if feature involves data)*

- **Conversation** (spec 005, extended): done (when, by whom) and taken over (by whom, since when).
- **Copilot draft**: the pasted message, the property, the booking status, who asked, the resulting
  text, sections, checks, removed items, caution category, and its trace; kept 30 days.
- **Push subscription**: a member's device registration for web push (endpoint and keys), with when it
  last succeeded; belongs to the member, not the workspace.
- **Replying presence**: a member replying in a conversation, until it expires.
- **Suggestion dismissal**: a topic and property whose trust suggestion is hidden until a date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The inbox loads in under 1 second at p95 for a workspace with 1,000 open conversations, and
  a new escalation appears within 15 seconds.
- **SC-002**: A host approves a draft from a push alert on a phone in under 30 seconds.
- **SC-003**: Push alerts are handed to the push service within 60 seconds of the conversation needing
  the team, and never during quiet hours except emergencies and malfunctions.
- **SC-004**: A copilot draft returns within 15 seconds at p90.
- **SC-005**: In tests, no copilot draft contains a locked value, a benefit recommendation, or (for
  inquiries) a link or contact detail; no push payload contains guest text.
- **SC-006**: In the pilot, hosts use the copilot for at least 30% of their platform questions and copy
  at least 70% of drafts with little or no change (measured in spec 010).
- **SC-007**: The inbox, conversation, and copilot screens meet WCAG 2.2 AA (automated checks with zero
  violations) and stay within the 150 KB route budget.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature adds a model entry point fed by pasted text from outside Guidesk, a third-party delivery
channel (push services), and actions that change who answers a guest.

### Threats (STRIDE)

- **S**: A pasted message claims to be from the host or Guidesk to change the copilot's behavior; a forged
  push subscription for another member.
- **T**: Prompt injection in pasted text tries to make the copilot reveal codes, add links, or promise
  refunds.
- **R**: A member denies taking over or rejecting a draft.
- **I**: Push payloads expose guest messages on a lock screen or to the push service; copilot drafts leak
  locked values or another property's content; presence leaks names across workspaces.
- **D**: Copilot requests burn the AI budget; push floods.
- **E**: An agent reads another workspace's inbox; a guest chat cookie reaches member routes.

### Controls Applied

- **SEC-06**: The copilot uses the same knowledge as the assistant (locked fields as labels).
- **SEC-07**: Copilot drafts count toward the daily AI budget and have a per-member limit.
- **SEC-08**: Pasted text is framed as the guest's message; classification runs without settings; the
  model has no tools; deterministic checks and removals run after the model.
- **SEC-14**: RLS on every new table; cross-tenant tests for every new route; push subscriptions belong
  to their user.
- **SEC-16**: Take over, hand back, reject, and done are recorded in the security log; copilot drafts are
  traced.
- **SEC-20**: Push payloads hold no guest text or personal data; push keys are deployment secrets.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given pasted text asking for a code or containing instructions, when the copilot drafts,
  then no locked value appears and no instruction is followed.
- **AC-SEC-002**: Given an inquiry, when the copilot drafts, then the result has no link, email address,
  or phone number.
- **AC-SEC-003**: Given any alert, when its push payload is built, then it contains no guest message
  text, code, or contact data.
- **AC-SEC-004**: Given a member of another workspace, when they request the inbox, a conversation
  action, a copilot draft, or a presence update, then they get 404 and the attempt is logged.
- **AC-SEC-005**: Given a member's push subscription, when another user tries to delete or test it, then
  nothing changes.
- **AC-SEC-006**: Given a member over 60 copilot drafts in an hour or a property over its budget, when they
  ask for a draft, then no model call is made.
- **AC-SEC-007**: Given a taken-over conversation, when an emergency arrives, then the emergency card and
  the alerts are not held back.

### Platform Policies

- **PC-05**: Inquiry drafts contain no link or contact detail.
- **PC-06** and **PC-14**: Copilot drafts pass the off-platform and promise checks.
- **PC-10**: Copilot drafts never promote recommendations with a commission or benefit and answer only
  the guest's question.
- **PC-03**: No guest contact data is stored; inbox labels use the property and stay.

## Assumptions

- Specs 005 and 007 are in place: conversations, drafts, traces, the conversation page, settings,
  contacts, quiet hours, and the reply pipeline.
- Push uses the standard Web Push protocol with VAPID keys set per deployment (a founder gate, like the
  other secrets); locally and in tests a fake push sender records payloads.
- The copilot uses the same model and effort as the assistant (ADR-0005); its prompt change passes the
  agent eval suite (new copilot cases), with the real-model run behind the `ANTHROPIC_API_KEY` gate.
- The per-property conversation list of spec 005 stays as a shortcut and links to the inbox.
- The thresholds (5 unchanged drafts, 30 days, 60 copilot drafts per hour, 30-second presence) are pilot
  values to tune.
