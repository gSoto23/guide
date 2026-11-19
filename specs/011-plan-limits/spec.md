# Feature Specification: Plan Limits

**Feature Branch**: `011-plan-limits`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "011 Plan limits (PRD F11, FR-11.1, FR-11.2; business model §2 plan hypothesis; OQ-10). Every workspace has a plan: Free, Pro, or Business. The pilot is free and billing waits for Phase 2: new workspaces start on Free, and the founder assigns Pro or Business with a command-line tool, with a note, recorded in the security log. Plans set three limits enforced everywhere: active properties (Free 2; Pro and Business unlimited), AI replies per calendar month in UTC (Free 100 per workspace; Pro and Business 300 per active property, pooled), and seats, members plus pending invitations (Free 1, Pro 3, Business unlimited). The founder may set a custom limit per workspace; the existing pilot seat and property limits become custom limits. AI replies are the replies already counted in the daily usage (guide chat, copilot drafts, test runs). When the month's AI replies are used up, the assistant stops calling the model until the next month; guests get the holding reply and the conversation waits for the host; owners get one email at 80% and one at 100% per month. A workspace above a limit keeps everything it has but gets nothing new above it. The daily AI budgets stay as abuse protection. Limits derived from the property limit follow the plan. Portal: a Plan and usage screen for owners and admins, a banner at 80% and 100%, and explanations with a link wherever a limit stops someone. Spanish and English; WCAG 2.2 AA; 150 KB per route; usage within 300 ms at p95. Out of scope: billing, prices, trials, checkout, invoices, taxes, self-service plan changes (Phase 2), other plan differences (branding, autonomy levels, PMS chat, analytics depth, add-on fees), and per-member limits."

**Sources**: [PRD F11](../../docs/product/prd.md#f11--plans-limits-and-billing) ·
[Business model §2 (plan hypothesis)](../../docs/product/business-model.md#2-plans-hypothesis) ·
[Screen H-32](../../docs/ux/screens.md) · Pilot limits from specs 001 (FR-021 seats), 002 (FR-047
properties, FR-017 extractions), 003 (guide AI requests and media storage), and 005 (FR-028 daily AI
budgets) · [OQ-10](../../docs/open-questions.md)

## Clarifications

### Session 2026-11-18

Answered with the recommended option under the founder's standing instruction to run all phases on
2026-11-18. Each answer can be changed by the founder; the spec follows the answer below until then.

- Q: Which numbers do the plans use? → A: The business-model hypothesis (OQ-10, validated in the
  pilot): Free has 2 active properties, 100 AI replies per month, and 1 seat; Pro has unlimited
  properties, 300 AI replies per active property per month pooled across the workspace (at least 300),
  and 3 seats; Business has unlimited properties, the same pooled AI replies as Pro, and unlimited
  seats. "Fair use" becomes this concrete pooled allowance so it can be enforced and shown.
- Q: How does a workspace get a paid plan while there is no billing? → A: New workspaces start on
  Free. The founder assigns Pro or Business (or back to Free) with a command-line tool, at no charge,
  with a note. Pilot design partners get the plan they need this way.
- Q: What counts as an AI reply? → A: Every reply or draft the assistant writes with the AI model:
  answers and drafts in the guide chat, copilot drafts for booking-platform chats, and "test the
  assistant" runs. These are the replies already counted for the daily budgets. Fixed messages
  written without the model (holding replies, pause messages, pointers sent without a model call)
  do not count. Guide-building AI (interview, translations, listing drafts) has its own daily limits
  and does not count.
- Q: Which month? → A: The calendar month in UTC. Usage starts again at 00:00 UTC on the 1st; the
  screen shows that moment in the member's time zone.
- Q: What happens above a limit after a plan change? → A: Nothing is removed or disabled. Existing
  properties, members, guides, conversations, and pending invitations stay; only new properties,
  imports, invitations, and AI replies above the limit are refused.
- Q: Who sees the plan? → A: Owners and admins see the plan screen and the usage banner. Agents see no
  plan details but get the same explanation when a limit stops them (for example a copilot draft).
- Q: Can the founder override a single limit? → A: Yes. A custom limit per workspace for properties,
  seats, or monthly AI replies replaces the plan's value for that limit. The pilot limits Guidesk
  already set per workspace (seats and properties) become custom limits.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - AI replies stop at the monthly limit (Priority: P1)

A Free workspace has 100 AI replies a month. When they are used up, the assistant stops writing new
replies until the 1st of next month: guests get the usual holding reply and the conversation waits for
the host with the reason "AI replies for this month are used up". Copilot drafts and assistant tests
say why they stopped. The guide, Explore, and add-on requests keep working.

**Why this priority**: Inference is Guidesk's largest variable cost (business model §5); the Free plan
is only sustainable with a monthly cap (FR-11.1).

**Independent Test**: Give a Free workspace 99 AI replies this month, send two guest questions, and
check that the first is answered by the assistant and the second gets the holding reply, waits for the
host with the monthly reason, and makes no model call.

**Acceptance Scenarios**:

1. **Given** a Free workspace with 100 AI replies this month, **When** a guest asks a question,
   **Then** no model call is made, the guest gets the holding reply, and the conversation waits for the
   host with the reason "AI replies for this month are used up".
2. **Given** a Pro workspace with 4 active properties, **When** AI replies this month reach 1,200,
   **Then** the next reply in any of its properties is refused the same way (the allowance is pooled).
3. **Given** the month's AI replies are used up, **When** a member asks for a copilot draft or runs an
   assistant test, **Then** they see that the month's AI replies are used up and when they renew.
4. **Given** the limit was reached on the 31st, **When** the 1st starts at 00:00 UTC, **Then** the
   assistant answers again.
5. **Given** a workspace reaches 80% and then 100% of its AI replies, **When** each threshold is
   crossed, **Then** each owner gets one email in their language for each threshold, at most once per
   month.
6. **Given** the daily budget of spec 005 is reached before the monthly limit, **When** a guest asks,
   **Then** the daily budget applies as today.

---

### User Story 2 - Properties and seats follow the plan (Priority: P1)

A Free workspace can have 2 active properties and 1 seat (the owner). Every way to add a property
(blank, from a listing, duplicate, CSV import, PMS import) and every invitation respects the plan's
limits, explains which limit was reached, and links owners and admins to the plan screen.

**Why this priority**: FR-11.1 names properties and seats; specs 001 and 002 already enforce pilot
limits that now come from the plan.

**Independent Test**: On a Free workspace with 2 active properties and only the owner, try each way to
add a property and an invitation; each is refused with the limit explained. Move the workspace to Pro
and the same actions succeed up to Pro's limits.

**Acceptance Scenarios**:

1. **Given** a Free workspace with 2 active properties, **When** an owner adds a property by any path,
   **Then** it is refused with "You reached your plan's limit of 2 properties" and a link to the plan
   screen.
2. **Given** a Free workspace with the owner only, **When** the owner invites a member, **Then** the
   invitation is refused with the seat limit explained.
3. **Given** a Pro workspace with 2 members and no pending invitation, **When** an admin invites one
   more member, **Then** it succeeds; a fourth seat is refused.
4. **Given** a removed property, **When** properties are counted, **Then** it does not count.
5. **Given** a CSV or PMS import with more properties than the free slots, **When** it runs, **Then**
   only the free slots are created and the rest are marked "plan limit".
6. **Given** two creations sent at the same time for the last free slot, **When** both finish,
   **Then** exactly one succeeds.

---

### User Story 3 - The founder assigns plans and custom limits (Priority: P1)

The founder runs a command with a workspace ID to set its plan (Free, Pro, or Business), optional
custom limits, and a note. The change applies at once, appears in the workspace's security log as made
by Guidesk, and the founder can print a workspace's plan, limits, and usage.

**Why this priority**: Pilot design partners need Pro or Business before billing exists (FR-11.2);
without this, every pilot workspace is stuck on Free.

**Independent Test**: Set a Free workspace to Business with a note; its seat and property limits lift
at once and its security log shows the change. Set a custom AI limit of 50; the screen shows 50.

**Acceptance Scenarios**:

1. **Given** a Free workspace, **When** the founder sets it to Business with a note, **Then** the next
   invitation and property creation follow Business limits and the security log records the change
   (from Free to Business, by Guidesk).
2. **Given** a custom property limit of 5 on a Free workspace, **When** limits are read, **Then** the
   property limit is 5 and the other limits are Free's.
3. **Given** the founder clears a custom limit, **When** limits are read, **Then** the plan's value
   applies again.
4. **Given** an unknown workspace ID, an unknown plan, or a limit that is not a positive whole number,
   **When** the command runs, **Then** it changes nothing and says why.
5. **Given** the print command, **When** the founder runs it for a workspace, **Then** it shows the
   plan, each limit with its source (plan or custom), and this month's usage.

---

### User Story 4 - Owners and admins see their plan and usage (Priority: P2)

Owners and admins open "Plan and limits" from workspace settings: the plan's name, each limit with its
usage (active properties, AI replies this month with the renewal moment, seats including pending
invitations), what counts as an AI reply, the workspace ID, and how to ask Guidesk for a change. A
banner across the portal warns them at 80% and 100% of the month's AI replies.

**Why this priority**: Hosts need to see limits before they hit them; without billing, the screen is
how they learn to ask for a change. The limits themselves (US1 to US3) protect cost first.

**Independent Test**: Seed a Free workspace with 1 property, 85 AI replies this month, and the owner;
the screen shows 1 of 2, 85 of 100 with the renewal date, and 1 of 1; the banner shows the 80%
warning; an agent cannot open the screen.

**Acceptance Scenarios**:

1. **Given** an owner of a Free workspace, **When** they open the plan screen, **Then** they see
   "Free", each limit with its usage as text and as a meter, and the renewal moment in their time zone.
2. **Given** a Business workspace, **When** the screen shows seats and properties, **Then** they read
   "unlimited" with the current count.
3. **Given** AI replies at 80% or more, **When** an owner or admin opens any portal page, **Then** a
   banner says how many replies are left and links to the screen; at 100% it says replies are used up
   until the renewal moment.
4. **Given** an agent, **When** they open the plan screen address, **Then** they are refused and see
   no plan details; they never see the banner.
5. **Given** a workspace above a limit after a plan change, **When** the screen opens, **Then** the
   limit shows as exceeded with a note that nothing was removed and that new additions wait until the
   usage is under the limit.

---

### Edge Cases

- **Plan or custom limit changed mid-month**: the new AI limit applies to the replies already used
  this month; moving from Pro to Free after 250 replies leaves the workspace over its limit until the
  1st.
- **Month boundary**: usage counts by UTC day; a reply at 23:59 UTC on the 31st counts in that month.
- **Replies in progress**: a reply whose model call already started when the limit was reached
  finishes and counts; the month may end slightly above the limit, by at most the replies in progress.
- **Pooled allowance changes with properties**: adding or removing an active property on Pro or
  Business changes the month's allowance at once; removed properties do not count.
- **Pro or Business with no active property**: the allowance is still 300 so tests can run.
- **Workspace pending deletion**: it accepts no new properties, imports, or feeds (spec 002 FR-049);
  the plan screen stays readable for owners until the purge.
- **The owner's seat**: the owner always counts as one seat; Free leaves no seat to invite.
- **Invitations after a downgrade**: invitations already pending keep their seat and can be accepted;
  no new invitation is allowed while seats in use are at or above the limit.
- **Workspace moved between Free and a paid plan**: properties above Free's 2 stay active with their
  guides, stay links, and chat; the workspace simply cannot add more until it is under the limit.
- **Derived daily limits on unlimited plans**: listing extractions, guide AI requests, and media
  storage scale with the active properties plus 2 (room for the next ones), never below Free's values.
- **Daily budgets and the monthly limit**: both apply; the conversation's reason names the limit that
  stopped it (daily or monthly).

## Requirements *(mandatory)*

### Functional Requirements

**Plans and limits**

- **FR-001**: Every workspace MUST have exactly one plan: Free, Pro, or Business. New workspaces MUST
  start on Free.
- **FR-002**: Plans MUST set these limits:

  | Limit | Free | Pro | Business |
  |---|---|---|---|
  | Active properties | 2 | Unlimited | Unlimited |
  | AI replies per calendar month (UTC) | 100 per workspace | 300 per active property, pooled, at least 300 | Same as Pro |
  | Seats (members plus pending invitations) | 1 | 3 | Unlimited |

- **FR-003**: A workspace MAY have a custom limit for properties, seats, or monthly AI replies. A
  custom limit MUST replace the plan's value for that limit only. Pilot seat and property limits set
  before this feature MUST become custom limits.
- **FR-004**: A plan or custom-limit change MUST apply to the next action, with no restart.
- **FR-005**: Limits derived from the property limit (daily listing extractions, daily guide AI
  requests, media storage) MUST use the effective property limit; for unlimited plans they MUST use the
  workspace's active properties plus 2, never less than Free's values.

**AI replies**

- **FR-006**: An AI reply MUST be every reply or draft the assistant writes with the AI model in the
  guide chat, in copilot drafts, and in assistant tests. Messages sent without a model call MUST NOT
  count.
- **FR-007**: Before each model call for an AI reply, the system MUST check the month's usage against
  the effective limit. At or above the limit it MUST NOT call the model: the guest MUST get the holding
  reply and the conversation MUST wait for the host with the reason "AI replies for this month are used
  up"; copilot drafts and assistant tests MUST stop with an explanation and the renewal moment.
- **FR-008**: The daily AI budgets of spec 005 (FR-028) MUST keep working; the first limit reached
  applies.
- **FR-009**: Each owner MUST get one email when the month's AI replies reach 80% of the limit and one
  when they reach 100%, at most once per threshold per month, in the owner's language, with a link to
  the plan screen.

**Properties and seats**

- **FR-010**: Every way to add a property (blank, from a listing, duplicate, CSV import, PMS import)
  MUST respect the effective property limit, counting active properties only, with no overshoot under
  concurrent requests.
- **FR-011**: Invitations MUST respect the effective seat limit, counting members plus pending
  invitations; the owner always takes one seat.
- **FR-012**: A workspace above a limit MUST keep all its properties, members, pending invitations,
  guides, and conversations; only new additions above the limit MUST be refused.

**Explanations and screens**

- **FR-013**: When a limit refuses an action, the message MUST say which limit was reached, the limit,
  and the current usage; owners and admins MUST get a link to the plan screen; agents MUST get the
  explanation without plan details.
- **FR-014**: Owners and admins MUST be able to open a "Plan and limits" screen (H-32) from workspace
  settings with: the plan's name; each limit with its usage as text and as a meter (unlimited shown as
  such); the renewal moment of AI replies in the member's time zone; what counts as an AI reply; the
  workspace ID; and how to ask Guidesk for a change. Agents MUST NOT be able to open it.
- **FR-015**: Owners and admins MUST see a banner on portal pages when the month's AI replies are at
  80% or more, saying how many are left or that they are used up until the renewal moment, with a link
  to the plan screen.
- **FR-016**: The plan screen and banner MUST be available in Spanish and English, meet WCAG 2.2 AA
  (meters also readable as text), and keep every portal route within 150 KB of JavaScript.

**Founder tool**

- **FR-017**: The founder MUST be able to set a workspace's plan, set or clear its custom limits, and
  add a note with a command-line tool that runs where database migrations run, never through the
  portal or the public API.
- **FR-018**: Each change MUST be recorded in the workspace's security log as made by Guidesk, with the
  previous and new plan and custom limits and the note.
- **FR-019**: The founder MUST be able to print a workspace's plan, each limit with its source (plan or
  custom), and the month's usage.
- **FR-020**: No portal or API request, from any role, MUST be able to change a plan or a custom limit.

### Key Entities *(include if feature involves data)*

- **Plan**: one of Free, Pro, Business, each with fixed limit values (FR-002). Defined by Guidesk;
  changes in Phase 2 with billing.
- **Workspace plan**: a workspace's plan, when it was last changed, and its optional custom limits for
  properties, seats, and monthly AI replies.
- **Monthly AI usage**: the sum of a workspace's daily AI-reply counts (already kept per property and
  UTC day for spec 005) since the 1st of the month.
- **Usage notice**: that a workspace's owners were told about the 80% or 100% threshold in a given
  month, so each email goes once.
- **Plan change event**: a security-log entry for each change made by the founder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In tests, a workspace never gets more AI replies in a month than its limit plus the
  replies already in progress when it was reached, and no model call is made once it is reached.
- **SC-002**: Every way to add a property and every invitation refuses the action at the limit, with
  no overshoot under 10 concurrent requests.
- **SC-003**: After a plan change, the next action follows the new limits (within 1 minute), and no
  property, member, guide, or conversation is removed or disabled by a lower limit.
- **SC-004**: An owner sees their plan and usage within 1 second; usage is read within 300 ms at the
  95th percentile for a workspace with 50 properties and a full month of replies.
- **SC-005**: Each owner gets at most one 80% email and one 100% email per workspace per month.
- **SC-006**: The plan screen and banner have no automated accessibility violations in Spanish and
  English, and every portal route stays within 150 KB of JavaScript.
- **SC-007**: The founder can move a workspace to another plan with one command in under 1 minute.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature changes what workspaces may do and adds a privileged founder tool.

### Threats (STRIDE)

- **E**: A member raises their own plan or limits through the API; an agent opens plan details.
- **T**: A crafted request sends plan fields or bypasses a limit with concurrent requests.
- **I**: A member of another workspace reads this workspace's plan or usage.
- **R**: A plan change cannot be traced.
- **D**: A workspace exhausts AI spend beyond its plan.

### Controls Applied

- **SEC-05**: Plan details are for owners and admins; limits are enforced on the server for every
  role.
- **SEC-07**: Monthly AI limits and the existing daily budgets cap model calls per workspace.
- **SEC-14**: Plan and usage reads run under the workspace's row-level security; cross-tenant tests
  cover the new route.
- **SEC-16**: Plan changes go to the append-only security log with the actor (Guidesk), the change,
  and the note.
- **SEC-15**: Plans and custom limits change only through the founder tool, which needs database
  access; there is no portal or API path.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given a member of another workspace, when they request this workspace's plan, then
  they get 404 and the attempt is logged.
- **AC-SEC-002**: Given any role, when a request tries to change a plan or a custom limit (extra
  fields, other methods, or other routes), then it is refused and nothing changes.
- **AC-SEC-003**: Given an agent, when they request the plan screen or its data, then they are refused
  and the attempt is logged.
- **AC-SEC-004**: Given the last free property slot or seat, when 10 requests race for it, then exactly
  one succeeds.
- **AC-SEC-005**: Given a workspace at its monthly AI limit, when guests, copilot, and tests ask for
  replies, then no model call is made.

### Platform Policies

- No guest data is read or shown; usage is counts only.

## Assumptions

- Specs 001 to 010 are in place, including the daily AI-reply counts per property (spec 005), the
  security log (spec 001), and owners' email notices.
- The plan numbers are business-model hypotheses (OQ-10); the founder can change them in one place and
  will revisit them with pilot evidence.
- Billing, prices, trials, and self-service plan changes come in Phase 2 (screen H-42); until then the
  plan screen asks hosts to contact Guidesk. The contact address is set by Guidesk in configuration.
- Workspaces created before this feature move to Free and keep the pilot limits Guidesk set as custom
  limits; the founder moves pilot design partners to Pro or Business.
- Guide-building AI (interview, translations, listing drafts) keeps its own daily limits and is not
  counted as AI replies.
- Other plan differences in the business model (branding, autonomy levels, PMS chat, analytics depth,
  add-on fee rates) come with billing and are not enforced here.
