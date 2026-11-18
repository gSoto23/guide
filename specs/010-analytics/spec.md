# Feature Specification: Basic Analytics

**Feature Branch**: `010-analytics`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "010 Analytics (basic) (PRD F10, FR-10.1; screen H-34; PRD §8 success metrics; cut order item 3 keeps the pilot metrics). Members of a workspace see an Analytics screen in the portal, for one property or for the whole workspace, over a period (last 7, 30, or 90 days, by day in each property's time zone), with the change against the previous period of the same length: guide views, guest questions, questions answered automatically and the automated resolution rate, escalations by reason, top question topics, unanswered questions with a link to the conversation, Explore opens and partner clicks, and add-on requests by status with the attach rate. Numbers come from the counts and records Guidesk already keeps; no new personal data. Copilot drafts and assistant tests are excluded. Founder pilot metrics as a command-line report across workspaces, aggregated, never in the portal. Portal budget 150 KB per route (no chart library), p95 ≤ 500 ms for 50 properties and 90 days, WCAG 2.2 AA, Spanish and English. Out of scope: CSV export, custom date ranges, email reports, real-time updates, revenue and payments (spec 013), per-guest histories, and benchmarks across workspaces."

**Sources**: [PRD F10 and §8 Success metrics](../../docs/product/prd.md#f10--analytics-basic) ·
[Screen H-34](../../docs/ux/screens.md) · Counts kept by specs 004 (guide opens), 005 to 007 (guide
chat and assistant), 008 (add-on requests), and 009 (Explore opens and partner clicks)

## Clarifications

### Session 2026-11-18

Answered with the recommended option under the founder's standing instruction to run all phases on
2026-11-18. Each answer can be changed by the founder; the spec follows the answer below until then.

- Q: Which periods can a member pick? → A: The last 7, 30, or 90 complete days plus today, counted by
  day in each property's time zone; each number is compared with the previous period of the same
  length. Custom ranges come later.
- Q: What counts as a guest question? → A: Each message a guest sends in the guide chat that the
  assistant handles. Copilot drafts for booking platforms and "test the assistant" runs are not guest
  questions. Messages sent while a member had taken over the conversation count as questions handled
  by the host.
- Q: When is a question "answered automatically"? → A: When the assistant's reply reached the guest
  without a member writing or approving it. A reply a member approved or edited counts as "answered
  with the host"; a question that went to the host without an assistant answer counts as "escalated".
  The automated resolution rate is answered automatically ÷ all guest questions.
- Q: Which topics and reasons are shown? → A: The assistant's topic for each question (arrival,
  Wi-Fi, house rules, appliances, amenities, parking, local recommendations, emergency, checkout,
  other) and the escalation reasons the inbox already uses. Topics replace free-text clustering in
  this spec.
- Q: Who sees analytics? → A: Every member of the workspace (owners, admins, and agents), because
  all of them can see conversations today. Unanswered questions show the guest's text exactly as the
  conversation does, and disappear when retention deletes the conversation.
- Q: How are stays counted? → A: A stay "opened the guide" when its stay link was used in the period.
  The attach rate is stays with at least one add-on request ÷ stays that opened the guide. Partner
  clicks are counted per property, not per stay, so they have no per-stay rate.
- Q: Where do the founder's pilot metrics live? → A: In a command-line report run by the founder
  against the database, across all workspaces, with aggregates only. It never appears in the portal.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A host sees how a property's guide is used (Priority: P1)

Ana opens Analytics from her property's page. For the last 30 days she sees how many times guests
opened the guide (through the property link and through stay links) and how many stays opened it,
how many questions guests asked in the chat, how many the assistant answered on its own, the
automated resolution rate, and how each number changed against the 30 days before. She switches to
7 or 90 days.

**Why this priority**: FR-10.1 and the North Star input (automated resolution rate) start here; a
host who sees that the guide works keeps using it.

**Independent Test**: Seed opens, conversations, and assistant replies for a property over 60 days;
open Analytics for that property; the numbers, the rate, and the changes match the seeded data for
7, 30, and 90 days.

**Acceptance Scenarios**:

1. **Given** a property with 40 guide opens (25 through the property link, 15 through stay links from
   6 stays) in the last 30 days, **When** Ana opens its Analytics for 30 days, **Then** she sees 40
   views, split 25 and 15, and 6 stays that opened the guide.
2. **Given** 20 guest questions in the period, 14 answered automatically, 3 answered with the host,
   and 3 escalated, **When** she opens Analytics, **Then** she sees 20 questions, 14 answered
   automatically, and a 70% automated resolution rate.
3. **Given** 10 questions in the previous 30 days and 20 now, **When** she looks at questions,
   **Then** the change reads "+10 (+100%)" against the previous period.
4. **Given** copilot drafts and "test the assistant" runs in the period, **When** she opens
   Analytics, **Then** none of them count as guest questions.
5. **Given** no data in the period, **When** she opens Analytics, **Then** she sees zeros and a short
   note on how to share the guide, not an error.

---

### User Story 2 - A host learns what guests ask and what the assistant missed (Priority: P1)

Ana sees the top question topics, escalations by reason, and the list of questions the assistant
couldn't answer, newest first, each with the date and a link to its conversation, so she can add the
answer to her guide.

**Why this priority**: Unanswered questions are the fastest way to improve the guide and the
resolution rate; FR-10.1 names top and unanswered questions.

**Independent Test**: Seed questions with topics, escalations with reasons, and unanswered questions;
the topics are ranked, the reasons are counted, and each unanswered question links to its
conversation.

**Acceptance Scenarios**:

1. **Given** questions about Wi-Fi (8), arrival (5), and parking (2), **When** Ana opens Analytics,
   **Then** topics are listed in that order with their counts and shares.
2. **Given** 2 emergency and 1 money escalation, **When** she opens Analytics, **Then** escalations
   show emergency 2 and money 1.
3. **Given** 3 questions the assistant couldn't answer, **When** she opens the unanswered list,
   **Then** she sees the 3 questions newest first with the date and property, and each opens its
   conversation.
4. **Given** a conversation deleted by retention, **When** she opens the list, **Then** its questions
   are gone while the counts for that period stay.

---

### User Story 3 - A manager compares properties across the workspace (Priority: P2)

Marco opens Analytics from the header and sees workspace totals for the period and a table with one
row per property (views, questions, answered automatically, resolution rate, escalations, add-on
requests, partner clicks). He sorts by any column and opens a property's Analytics.

**Why this priority**: Professional managers (P2) run many properties; comparing them shows which
guides need work.

**Independent Test**: Seed three properties with different numbers; the totals equal the sum of the
rows, sorting works on each column, and each row opens the property's Analytics.

**Acceptance Scenarios**:

1. **Given** three properties, **When** Marco opens workspace Analytics, **Then** totals equal the
   sum of the property rows and the resolution rate is computed on the totals.
2. **Given** the table, **When** he sorts by resolution rate, **Then** rows reorder and the sort is
   announced to screen readers.
3. **Given** 80 properties, **When** he opens the table, **Then** the first 50 rows show by the
   sorted column with a "Show all" button.
4. **Given** a property removed during the period, **When** he opens the table, **Then** it appears
   marked as removed and is included in the totals.

---

### User Story 4 - A host sees Explore and add-on activity (Priority: P2)

Ana sees how many times guests opened Explore and clicked partner experiences (per partner, counts
only), and how many add-on requests guests made by status (waiting, confirmed, declined, cancelled,
expired), with the attach rate.

**Why this priority**: FR-10.1 names offer clicks and add-on requests; the attach rate is a pilot
metric.

**Independent Test**: Seed Explore opens, partner clicks, and requests with statuses; the numbers and
the attach rate match.

**Acceptance Scenarios**:

1. **Given** 12 Explore opens and 5 clicks (Viator 3, Civitatis 2), **When** Ana opens Analytics,
   **Then** she sees 12 opens and 5 clicks split by partner, with no commission amounts.
2. **Given** 10 stays that opened the guide and 2 of them with requests, **When** she opens Analytics,
   **Then** the attach rate is 20%.
3. **Given** requests created, confirmed, and declined in the period, **When** she opens Analytics,
   **Then** each status shows its count.

---

### User Story 5 - The founder reads the pilot metrics (Priority: P3)

The founder runs a report from the command line and sees, across all workspaces, activation, median
time to guide, automated resolution rate, attach rate, host retention at day 60, and AI cost per
stay served, with the pilot targets next to each.

**Why this priority**: PRD §8 measures the pilot with these numbers; the cut order keeps them even if
host analytics are cut.

**Independent Test**: Seed workspaces with sign-ups, publications, opens, questions, requests, and AI
costs; the report prints each metric with the expected value and contains no names, emails, or guest
text.

**Acceptance Scenarios**:

1. **Given** 4 sign-ups in a cohort, 2 of which published a guide that a guest opened within 7 days,
   **When** the founder runs the report, **Then** activation reads 50% against the 50% target.
2. **Given** the report output, **When** it is inspected, **Then** it holds no names, emails,
   workspace names, or guest text.

### Edge Cases

- A property without a time zone counts by UTC days and the screen says so.
- A period with no data shows zeros and guidance, never an error.
- Properties removed during the period show as removed and stay in workspace totals; properties
  deleted for good are no longer shown.
- A count that started after the beginning of the previous period (for example Explore or add-on
  requests, which shipped later) shows "no comparison yet" instead of a misleading change.
- A rate with a zero denominator shows "—" with an explanation, not 0% or an error.
- A workspace with many properties shows the first 50 rows by the chosen column and a "Show all".
- Conversations deleted by retention take their unanswered questions with them; counts stay.
- Days near midnight are counted in the property's time zone, so a question at 23:30 local time
  belongs to that local day.
- A workspace being deleted shows no analytics; a member removed from the workspace loses access at
  once.

## Requirements *(mandatory)*

### Functional Requirements

**Screen and access**

- **FR-001**: The portal MUST offer an Analytics screen for one property and for the whole workspace,
  reachable from each property's page and from the main navigation.
- **FR-002**: Every member of the workspace (owner, admin, agent) MUST be able to see Analytics for
  the workspace's properties, and nobody else.
- **FR-003**: Members MUST be able to choose the period: the last 7, 30, or 90 days including today,
  counted by day in each property's time zone (UTC when it has none, with a note).
- **FR-004**: Each number MUST show its change against the previous period of the same length, as an
  absolute and a relative change, or "no comparison yet" when counting started after that period
  began.

**Guide and chat**

- **FR-005**: The screen MUST show guide views (opens) split by property link and stay links, and the
  number of stays whose stay link was used in the period.
- **FR-006**: The screen MUST show guest questions in the guide chat, split into answered
  automatically, answered with the host, and escalated, plus the automated resolution rate (answered
  automatically ÷ guest questions).
- **FR-007**: Copilot drafts for booking platforms and "test the assistant" runs MUST NOT count as
  guest questions.
- **FR-008**: The screen MUST rank question topics by count with their share, and count escalations
  by reason.
- **FR-009**: The screen MUST list questions the assistant couldn't answer, newest first, with the
  date, the property, and a link to the conversation; the guest's text MUST appear only while the
  conversation is kept, shown as plain text.

**Explore and add-ons**

- **FR-010**: The screen MUST show Explore opens and partner clicks per partner, as counts only,
  without commission amounts.
- **FR-011**: The screen MUST show add-on requests by status and the attach rate (stays with at least
  one request ÷ stays that opened the guide).

**Workspace view**

- **FR-012**: The workspace view MUST show totals for the period and one row per property with views,
  questions, answered automatically, resolution rate, escalations, add-on requests, and partner
  clicks, sortable by each column, showing the first 50 rows and then all on request.
- **FR-013**: Workspace totals MUST equal the sum of property rows, including properties removed
  during the period (marked as removed); rates MUST be computed on the totals, not averaged.

**Presentation and quality**

- **FR-014**: Every chart MUST also be readable as text (a table or a list with the same numbers), and
  the screen MUST meet WCAG 2.2 AA in Spanish and English, with numbers, percentages, and dates
  formatted per locale.
- **FR-015**: A rate with no denominator MUST show "—" with a short explanation; a period with no data
  MUST show zeros and guidance.
- **FR-016**: The screen MUST add no tracking of guests and store no new personal data; it MUST read
  the counts and records Guidesk already keeps.

**Founder report**

- **FR-017**: The founder MUST be able to run a report across all workspaces with activation (sign-ups
  that publish a guide opened by a guest within 7 days), median time from sign-up to first
  publication, automated resolution rate, attach rate, host retention at day 60 (a member signed in
  during days 53 to 60), and AI cost per stay served, each next to its PRD target, for a chosen
  sign-up period.
- **FR-018**: The report MUST contain aggregates only (no names, emails, workspace or property names,
  or guest text) and MUST NOT be reachable from the portal or the public API.

### Key Entities *(include if feature involves data)*

- **Analytics period**: the chosen length (7, 30, or 90 days), its days in each property's time zone,
  and the previous period of the same length.
- **Property analytics**: per property and period, views by link kind, stays that opened the guide,
  questions by outcome, topics, escalation reasons, Explore opens, partner clicks, and requests by
  status; derived from existing counts and records.
- **Unanswered question**: a guest question the assistant couldn't answer, pointing to its
  conversation, existing only while the conversation does.
- **Pilot metrics report**: cohort of sign-ups and the six pilot metrics with their targets.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A host finds the automated resolution rate for a property in under 30 seconds from the
  property's page.
- **SC-002**: In tests, every number on the screen matches the seeded data for 7, 30, and 90 days,
  across time zones and the previous period.
- **SC-003**: The screen loads its numbers in under 500 ms at the 95th percentile for a workspace with
  50 properties and 90 days of data.
- **SC-004**: The Analytics screens stay within the portal's per-route JavaScript budget and pass
  automated accessibility checks with no WCAG 2.2 A or AA violations in Spanish and English.
- **SC-005**: In the pilot, at least half of active hosts open Analytics in their first 30 days
  (business metric, measured after launch).
- **SC-006**: The founder's report produces all six pilot metrics with no personal data in its output.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature reads conversation records (including guest text) for a new screen and adds a
cross-workspace report.

### Threats (STRIDE)

- **I**: A member reads another workspace's analytics or unanswered questions; the founder report
  leaks names, emails, or guest text; analytics outlive retention.
- **E**: A non-member or a removed member opens analytics.
- **D**: Heavy period queries slow the API for everyone.
- **T**: A crafted period or property filter reads data outside the workspace.

### Controls Applied

- **SEC-14**: Every query runs under the workspace's row-level security; cross-tenant tests cover each
  new route.
- **SEC-05**: Only members of the workspace can read its analytics.
- **SEC-20**: The screen reads existing data only; unanswered questions disappear with their
  conversations; the founder report holds aggregates only and runs outside the portal.
- **SEC-07**: Periods are limited to 7, 30, and 90 days; responses are bounded (50 rows, 50
  unanswered questions per page).

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given a member of another workspace, when they request analytics for this workspace
  or one of its properties, then they get 404 and the attempt is logged.
- **AC-SEC-002**: Given a period other than 7, 30, or 90 days or a property of another workspace, when
  it is requested, then the request is refused and nothing outside the workspace is read.
- **AC-SEC-003**: Given an unanswered question with markup, when it is shown, then it is plain text.
- **AC-SEC-004**: Given a conversation deleted by retention, when analytics are read, then none of its
  text appears.
- **AC-SEC-005**: Given the founder report output, when it is searched for names, emails, workspace or
  property names, and guest text, then none are found.

### Platform Policies

- **PC-03**: No guest contact data is collected or shown; stays are counted, not identified.
- **PC-10**: Copilot drafts are excluded from guest-question counts and never mixed with guide chat
  answers.

## Assumptions

- Specs 001 to 009 are in place: workspaces and roles, properties and stays, the guide, stay links
  and opens, the guide chat with topics and escalation reasons, the inbox, Explore counts, and add-on
  request counts.
- All members can see all of a workspace's conversations today; if per-property access arrives later,
  Analytics follows it.
- Counts that shipped recently (Explore, add-on requests) have no history before their release; the
  screen says "no comparison yet" for those periods.
- The PRD §8 targets are pilot hypotheses; the report shows them for reference.
- Data is read on request with no separate store; if timing tests show a need, a daily summary may be
  added without changing what users see.
