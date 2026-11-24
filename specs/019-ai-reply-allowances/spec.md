# Feature Specification: AI Reply Allowances and Top-ups

**Feature Branch**: `019-ai-reply-allowances`

**Created**: 2026-11-24

**Status**: Draft

**Input**: User description: "019 AI reply allowances and top-ups (founder decisions 2026-11-24; amends spec 011 FR-002 and spec 005 FR-028). Some hosts will use far more AI than others. Pro and Business get higher monthly minimums: Pro at least 500 AI replies a month and Business at least 1,000. When a workspace uses up its month, it can get a top-up of AI replies, or the AI pauses until the next period; the service itself is never suspended. During the pilot the Free plan gets 500 AI replies a month, and each guest device may send at most 25 messages every 10 minutes. After the pilot the plans are revisited (the direction is AI only on Pro and Business). Top-ups are granted by the founder while the pilot is free; buying them in the portal waits for host billing."

**Sources**: [Spec 011 (plan limits)](../011-plan-limits/spec.md) ·
[Spec 005 FR-028 (daily AI budgets and message pace)](../005-guide-chat/spec.md) ·
[Business model §2 and §2.1](../../docs/product/business-model.md#2-plans-hypothesis) ·
[PRD F11](../../docs/product/prd.md#f11--plans-limits-and-billing) ·
[OQ-10, OQ-12, OQ-13](../../docs/open-questions.md)

## Clarifications

### Session 2026-11-24

The founder decided the numbers on 2026-11-24. The remaining questions were answered with the
recommended option under the founder's standing instruction; each can be changed by the founder.

- Q: What are the new monthly allowances? → A: (Founder.) Pro: 300 AI replies per active property,
  pooled across the workspace, and at least 500. Business: 300 per active property, pooled, and at
  least 1,000. The per-property amount does not change; only the minimums do.
- Q: What does Free get during the pilot? → A: (Founder.) 500 AI replies a month per workspace while
  the pilot lasts. After the pilot the founder revisits Free; the direction is AI replies only on Pro
  and Business (Phase 2, not part of this spec).
- Q: How fast may a guest write? → A: (Founder.) At most 25 messages per device every 10 minutes
  (was 20). The daily AI budgets per property and per workspace (spec 005 FR-028) stay as abuse
  protection.
- Q: What is sold when a workspace runs out: tokens or replies? → A: Replies. Hosts already see their
  usage in AI replies, and a reply is what they can predict; Guidesk prices a reply from the measured
  cost per reply (tokens and model) recorded for every model call. "Recarga" in the portal means a
  pack of AI replies.
- Q: What happens when the month's replies run out? → A: The workspace uses its top-up balance, if it
  has one. With no balance the AI pauses until the 1st of next month (UTC), exactly as spec 011 FR-007
  does today: guests get the holding reply and the conversation waits for the host. The guide, the
  chat to the host, add-ons, Explore, and the portal keep working. Nothing is suspended.
- Q: How does a top-up behave? → A: It is a number of AI replies added to a workspace with a note. It is
  used only after the month's allowance is used up, oldest top-up first, and lasts 12 months from when
  it is added. It does not reset each month and is not refunded when it expires.
- Q: How are top-ups obtained during the pilot? → A: The pilot is free. The owner asks from the plan
  screen ("Pedir más respuestas", which shows the plan contact address of spec 011), and the founder
  adds a top-up with the command-line tool at no charge. Buying top-ups in the portal, and an optional
  automatic top-up, wait for host billing after the pilot (OQ-13) and are out of scope.
- Q: Do copilot drafts and assistant tests use top-ups? → A: Yes. Everything that counts as an AI
  reply under spec 011 FR-006 draws from the month first and then from the top-up balance.

### Session 2026-11-24 (plan)

- Q: Must two replies started at the same moment with one reply left be stopped exactly? → A: No. The
  monthly limit already works by checking before the model call and counting after it (spec 011): a
  reply that started while replies were left is answered and counted. Top-ups follow the same rule,
  and the top-up balance itself never goes below zero (a conditional update takes each reply). At
  most the replies already in flight finish without a top-up reply, which in practice is 0 to 2.
  This avoids reserving and releasing replies around every model call ([research R4](research.md)).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Higher monthly allowances (Priority: P1)

A Pro workspace with one property now gets 500 AI replies a month instead of 300, a Business workspace
with two properties gets 1,000 instead of 600, and a Free workspace in the pilot gets 500 instead of
100. A Pro workspace with five properties still gets 1,500 (300 each, pooled). The plan screen shows
the new numbers right away, and custom limits the founder set keep winning.

**Why this priority**: The founder set these numbers so small hosts never hit the limit in normal use
and pilot hosts can try the assistant without worrying about it.

**Independent Test**: Workspaces on each plan with 1, 2, and 5 active properties show the expected
monthly allowance on the plan screen and are refused only above it.

**Acceptance Scenarios**:

1. **Given** a Pro workspace with 1 active property, **When** the owner opens the plan screen, **Then**
   the monthly AI replies are 500.
2. **Given** a Pro workspace with 5 active properties, **When** the plan screen opens, **Then** the
   monthly AI replies are 1,500.
3. **Given** a Business workspace with 2 active properties, **When** the plan screen opens, **Then**
   the monthly AI replies are 1,000; with 4 properties they are 1,200.
4. **Given** a Free workspace, **When** the plan screen opens, **Then** the monthly AI replies are 500.
5. **Given** a workspace with a custom AI reply limit, **When** the plan screen opens, **Then** the
   custom limit applies and is labeled as set by Guidesk.
6. **Given** a workspace that used 300 replies this month under the old numbers, **When** the new
   allowance applies, **Then** the AI keeps answering up to the new allowance with no restart.

---

### User Story 2 - Guests may write a little faster (Priority: P1)

A guest asking several quick questions can now send up to 25 messages in 10 minutes from one device
before the chat asks them to slow down.

**Why this priority**: The founder raised the pace so real conversations are not cut off while bots
still are.

**Independent Test**: A device sends 25 messages within 10 minutes and all are accepted; the 26th gets
the pause message without a model call.

**Acceptance Scenarios**:

1. **Given** a device that sent 24 messages in the last 10 minutes, **When** it sends one more, **Then**
   the message is accepted.
2. **Given** a device that sent 25 messages in the last 10 minutes, **When** it sends another, **Then**
   it gets the pause message, no model is called, and no AI reply is counted.
3. **Given** the daily AI budget of a property is used up, **When** a guest writes, **Then** the daily
   budget still applies first, as in spec 005 FR-028.

---

### User Story 3 - Top-ups keep the AI answering after the month runs out (Priority: P2)

A busy Pro host used their 500 replies on the 20th. They ask for more from the plan screen; the founder
adds a top-up of 250 replies with a note. The assistant keeps answering, the plan screen shows "Recarga:
quedan 250 de 250, vence el 24 nov 2027", and on the 1st the month's allowance starts again while the
rest of the top-up stays for later.

**Why this priority**: The founder wants a way to keep the AI on for heavy users without suspending
the service; during the pilot it is the founder's manual tool, and later it becomes a paid product.

**Independent Test**: A workspace at its monthly limit with a top-up of 10 replies gets 10 more AI
replies, then pauses; the next month starts with the full allowance and the balance unchanged.

**Acceptance Scenarios**:

1. **Given** a workspace that used its month, **When** the founder adds a top-up of 250 replies with a
   note, **Then** the next AI reply is allowed and counted against the top-up, and the action is
   recorded in the workspace's security log as made by Guidesk.
2. **Given** a workspace with allowance left and a top-up, **When** the assistant replies, **Then** the
   reply counts against the month, not the top-up.
3. **Given** a top-up used up and the month used up, **When** a guest writes, **Then** the AI pauses as
   in spec 011 FR-007, with the reason "AI replies for this month are used up".
4. **Given** two top-ups, **When** replies draw from them, **Then** the oldest is used first.
5. **Given** a top-up older than 12 months, **When** usage is checked, **Then** its unused replies no
   longer count.
6. **Given** the 1st of the month (UTC), **When** usage is checked, **Then** the monthly allowance is
   full again and the top-up balance is unchanged.
7. **Given** two AI replies at the same moment with one top-up reply left, **When** both are
   recorded, **Then** one takes the last top-up reply, the other is counted in the month only, and the
   balance never goes below zero.

---

### User Story 4 - The owner sees the balance and can ask for more (Priority: P3)

The plan screen shows the month's allowance and use, the top-up balance with its expiry, and a "Pedir
más respuestas" action. The 80% and 100% emails and the banner say that a top-up keeps the AI
answering and how to ask for one; when a top-up is used up, the owner gets one email.

**Why this priority**: Owners need to see where they stand and know what to do before guests notice.

**Independent Test**: A workspace with a top-up shows the balance and expiry; at 100% of the month the
banner and email mention the top-up; when the top-up runs out one email is sent.

**Acceptance Scenarios**:

1. **Given** a workspace with a top-up, **When** an owner or admin opens the plan screen, **Then** it
   shows the month's use and allowance, the top-up balance, and the expiry date of each top-up.
2. **Given** a workspace at 100% of its month with no top-up, **When** an owner opens the portal,
   **Then** the banner says the AI is paused until the 1st and offers "Pedir más respuestas".
3. **Given** "Pedir más respuestas", **When** an owner chooses it during the pilot, **Then** the portal
   shows the plan contact address and what to write; no payment is asked.
4. **Given** a top-up that reaches zero, **When** that happens, **Then** each owner gets one email in
   their language, and the banner shows the paused state if the month is also used up.
5. **Given** an agent, **When** a limit stops a copilot draft, **Then** they get the same explanation
   without plan details (spec 011).

---

### Edge Cases

- A workspace changes plan mid-month: the new allowance applies to the next reply; the top-up balance
  is unchanged.
- A Business workspace with 0 active properties: allowance is 1,000 (the minimum).
- The founder adds a top-up to a demo workspace: allowed; demo workspaces stay out of the pilot report.
- A top-up with a typo (for example 25,000 instead of 250): the tool asks for confirmation above 5,000
  replies; the founder can reduce an unused balance with a correcting entry and a note.
- Daily budgets and the monthly allowance both apply; the first limit reached stops the reply.
- Clock edges: a reply at 23:59:59 UTC on the last day counts in that month.

## Requirements *(mandatory)*

### Functional Requirements

**Allowances**

- **FR-001**: Monthly AI replies MUST be: Free 500 per workspace during the pilot; Pro 300 per active
  property, pooled, at least 500; Business 300 per active property, pooled, at least 1,000 (amends
  spec 011 FR-002). Properties and seats limits do not change.
- **FR-002**: Custom AI reply limits set by the founder (spec 011 FR-003) MUST keep replacing the
  plan's monthly value.
- **FR-003**: The new values MUST apply to the next AI reply after release, with no reset of the
  month's usage.

**Guest message pace**

- **FR-004**: Each guest device MUST be limited to 25 messages per 10 minutes (amends spec 005 FR-028);
  the daily AI budgets per property and per workspace MUST stay as they are.

**Top-ups**

- **FR-005**: A top-up MUST be a number of AI replies (1 to 100,000) added to one workspace by the
  founder with a note, recorded in the workspace's security log as made by Guidesk.
- **FR-006**: AI replies MUST draw from the month's allowance first and, once it is used up, from the
  workspace's unexpired top-ups, oldest first. A model call MUST start only if one of them has a
  reply left. Taking a top-up reply MUST be a single conditional update, so no balance goes below
  zero; a reply already in flight when the last one is taken is answered and counted in the month.
- **FR-007**: A top-up MUST expire 12 months after it is added; expired replies MUST NOT count and
  MUST NOT be refunded.
- **FR-008**: The month's allowance MUST reset at 00:00 UTC on the 1st as in spec 011; top-up balances
  MUST NOT reset.
- **FR-009**: When neither the month nor a top-up has a reply left, the system MUST behave as spec 011
  FR-007: no model call, the guest gets the holding reply, and the conversation waits for the host.
- **FR-010**: The founder MUST be able to add a top-up, list a workspace's top-ups with balance and
  expiry, and correct an unused balance with a note, from the command-line tool of spec 011. The tool
  MUST ask for confirmation for top-ups above 5,000 replies. No portal or API request from any role
  MUST be able to add or change a top-up.

**Plan screen and messages**

- **FR-011**: The plan screen MUST show the month's use and allowance, the total top-up balance, and
  each top-up's remaining replies and expiry date, to owners and admins.
- **FR-012**: The plan screen MUST offer "Pedir más respuestas", which during the pilot shows the plan
  contact address (spec 011) and a suggested message; it MUST NOT ask for payment.
- **FR-013**: The 80% and 100% emails and the banner (spec 011 FR-009, FR-015) MUST mention top-ups and
  how to ask for one. When a workspace's top-up balance reaches zero, each owner MUST get one email per
  top-up in their language.
- **FR-014**: Texts MUST be available in Spanish and English, meet WCAG 2.2 AA, and keep the portal
  route budget of 175 KB.

**Pilot report**

- **FR-015**: The founder's pilot report (spec 010) MUST show, per plan, the AI replies used from
  allowances and from top-ups, and the AI cost per reply, so prices for top-ups can be set (OQ-12).

### Key Entities

- **Plan allowance** (spec 011): the monthly AI replies per plan, now with a per-plan minimum.
- **Top-up**: a workspace, the replies granted, the replies used, when it was added, when it expires,
  the note, and who added it (always Guidesk during the pilot). Corrections are entries with a note.
- **Usage check**: for each AI reply, the month's count and the top-up balance, checked and counted
  together.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The plan screen shows the right allowance for every plan and property count in tests
  (Free 500; Pro 500 to 300 × properties; Business 1,000 to 300 × properties).
- **SC-002**: Under 50 concurrent recorded replies with one top-up reply left, exactly one takes it
  and the balance never goes below zero (tests).
- **SC-003**: The 26th message from a device within 10 minutes never reaches the model (tests).
- **SC-004**: The usage check adds at most 20 ms at p95 to an AI reply.
- **SC-005**: In the pilot, the report gives the AI cost per reply for each plan, so OQ-12 (top-up
  price) can be answered with measured data.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

### Threats (STRIDE)

- **S**: A host fakes a top-up through the API.
- **T**: Concurrent replies push a balance below zero.
- **R**: A top-up cannot be traced to who added it and why.
- **I**: The plan screen shows another workspace's balance.
- **D**: A bot drains a workspace's allowance and top-ups through the guest chat.
- **E**: An agent or admin changes a balance.

### Controls Applied

- Top-ups only from the founder's command-line tool with system privileges; no portal or API route
  (FR-010), as for plans in spec 011 FR-020.
- Conditional update per top-up reply, so balances never go below zero (FR-006).
- Security log entry per top-up and correction, with the note.
- Row-level security on usage and top-ups per workspace.
- Per-device pace (25 per 10 minutes) and daily budgets per property and workspace stop draining.

### Abuse Cases (Acceptance Criteria)

- Any portal or API attempt to create or change a top-up returns 404 or 403 and changes nothing.
- A device sending 100 messages in 10 minutes gets 25 accepted and the rest paused without model calls.

### Platform Policies

- No change: the guest chat stays inside the guide; nothing is sent through booking platforms.

## Assumptions

- The pilot is free; top-ups have no price yet (OQ-12) and are granted by the founder.
- Host billing (charging hosts for plans and top-ups) comes after the pilot with the legal entity and a
  payment method for hosts (OQ-01, OQ-13); self-service purchase and automatic top-ups are a later
  spec.
- AI cost per reply is recorded for every model call (spec 005 traces); the business model estimates
  USD 0.03 to 0.11 per reply until the pilot measures it.
- The post-pilot direction (AI replies only on Pro and Business) is recorded in the business model and
  roadmap and needs its own spec.
