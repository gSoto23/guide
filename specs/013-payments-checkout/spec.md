# Feature Specification: Guest Checkout and Host Payouts

**Feature Branch**: `013-payments-checkout`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "013 Guest checkout and payouts (PRD F13, FR-13.1 to FR-13.8; ADR-0007; SEC-21; screen H-33; OQ-01, OQ-09, OQ-35, OQ-37). Guests pay for confirmed add-ons (spec 008) through the payment provider's hosted checkout, so card data never touches Guidesk. Hosts first set up payouts with the provider (identity and bank checks happen at the provider) and then receive their share minus Guidesk's platform fee through the provider's split settlement, so Guidesk never holds the host's share. Orders are confirmed only by a verified provider event, never by the browser's return, and move through an idempotent state machine. Owners and admins refund orders fully or partly from the portal after re-authenticating. Every order records the price, the platform fee, the provider fee, and the host's share. The provider sits behind a payment port; Tilopay is the chosen provider, but its sandbox and merchant account need the legal entity (OQ-01, OQ-37), so this spec ships a simulated provider (hosted checkout and onboarding pages, signed events) for development and tests, never for production, where payments stay off until the Tilopay adapter exists. Nothing that changes the reservation is sold, every purchase is optional, and early check-in and late checkout are not sold through checkout until the legal review (OQ-35). Out of scope: the Tilopay adapter itself, saved cards, invoices issued by Guidesk, tax calculation, subscriptions (Phase 2), tips, and paying for anything other than add-on requests."

**Sources**: [PRD F13](../../docs/product/prd.md#f13--guest-checkout-and-payouts-mvp-month-4) ·
[ADR-0007 Tilopay](../../docs/architecture/adr/0007-tilopay-initial-payment-provider.md) ·
[Security SEC-21](../../docs/architecture/security.md) · [Business model §3](../../docs/product/business-model.md#3-commission-model-hypothesis) ·
[Screen H-33](../../docs/ux/screens.md) · Spec 008 (add-on requests) · Spec 011 (plans) ·
[OQ-01, OQ-09, OQ-35, OQ-37](../../docs/open-questions.md)

## Clarifications

### Session 2026-11-19

Answered with the recommended option under the founder's standing instruction to run all phases; the
founder chose a simulated provider on 2026-11-19. Each answer can be changed by the founder.

- Q: Which provider does this spec integrate? → A: A simulated provider with the same shape as Tilopay's
  hosted checkout, onboarding, refunds, and signed events, behind the payment port. The Tilopay adapter
  comes when the legal entity and the Tilopay sandbox exist (OQ-01, OQ-37). The simulated provider is
  refused in production; there, payments stay off.
- Q: Who absorbs the provider's processing fee (OQ-09)? → A: The host. The guest pays the listed price;
  the host's share is the price minus Guidesk's platform fee and the provider's fee, and every order
  shows the three amounts.
- Q: What platform fee does Guidesk take? → A: By plan (business model §3): Free 10%, Pro 7%, Business
  5%. The founder can set a custom fee per workspace.
- Q: Are taxes or service fees added at checkout? → A: No. The host's listed price is the total the
  guest pays; any tax is included in it by the host. The guest sees that total before paying. Pending
  the legal review (OQ-35, OQ-01).
- Q: What can a guest pay for? → A: A confirmed request (including pre-approved ones) with a price above
  zero, in a currency the provider accepts (US dollars and colones), that is not early check-in or late
  checkout, while the stay link works, when the workspace's payouts are active. Paying online is
  optional; otherwise the host arranges payment as in spec 008.
- Q: Who refunds? → A: Owners and admins, after re-authenticating, fully or in parts up to the amount
  paid. A paid request can be cancelled only after a full refund.
- Q: What about disputes (chargebacks)? → A: The provider handles them; Guidesk marks the order as
  disputed and tells the owners by email. Refund requests from guests in the chat keep escalating to the
  host (money, spec 005).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A guest pays for a confirmed add-on (Priority: P1)

A guest with a stay link opens Extras, sees a confirmed request with "Pay 85 USD", taps it, pays on the
provider's page, and returns to the guide, which shows the request as paid once the provider confirms
it. The host gets an email that the request was paid.

**Why this priority**: Add-on payments are the highest-margin revenue stream (business model §5) and an
exit criterion of Phase 1 (first commissions collected through Guidesk checkout).

**Independent Test**: With payouts active, confirm a request; the guest pays on the simulated page; the
order is paid with the price, the platform fee, the provider fee, and the host's share; returning
without a provider event shows "processing" and never "paid".

**Acceptance Scenarios**:

1. **Given** a confirmed request for 85 USD and active payouts, **When** the guest opens Extras, **Then**
   it shows the total "85 USD" with "Pay 85 USD" and a note that the price includes any taxes.
2. **Given** the guest pays on the provider's page, **When** the provider's verified event arrives,
   **Then** the order is paid and records 85 USD, the platform fee, the provider fee, and the host's
   share; the guide shows "Paid".
3. **Given** the guest returns from the provider before any event, **When** the guide opens, **Then** it
   shows "Payment processing" and the order is not paid.
4. **Given** the guest abandons or declines the payment, **When** they come back, **Then** they can try
   again; at most one open checkout exists per request.
5. **Given** a waiting, declined, cancelled, or expired request, a free extra, an unsupported currency,
   or early check-in or late checkout, **When** the guest views it, **Then** there is no Pay button.
6. **Given** the same provider event arrives twice, **When** both are handled, **Then** the order changes
   once.
7. **Given** a paid request, **When** the host's escalation contacts are checked, **Then** they got one
   email that it was paid.

---

### User Story 2 - The owner sets up payouts (Priority: P1)

The owner opens Payouts in settings, starts the provider's onboarding, completes it on the provider's
page, and returns to see payouts active, the platform fee of their plan, and how fees work. Until
payouts are active, guests can't pay online.

**Why this priority**: FR-13.3; no payment can start without the host's merchant account.

**Independent Test**: The owner starts onboarding, approves it on the simulated page, and Payouts shows
"Active"; a rejected onboarding shows "Not approved" with the provider's next step; admins and agents
can't start it.

**Acceptance Scenarios**:

1. **Given** an owner without payouts, **When** they open Payouts, **Then** they see that guests can't
   pay online yet, the platform fee, and "Set up payouts".
2. **Given** the owner completes onboarding, **When** the provider's verified event arrives, **Then**
   payouts are active and the screen says so.
3. **Given** onboarding is rejected or still pending, **When** the owner returns, **Then** the screen
   shows that state and the next step.
4. **Given** an admin or an agent, **When** they open Payouts, **Then** they see the state but can't
   start or change onboarding.
5. **Given** payments are off in this environment, **When** anyone opens Payouts, **Then** it says online
   payments aren't available yet.

---

### User Story 3 - Hosts see payments and refund them (Priority: P2)

On the Requests screen, each request shows its payment: unpaid, processing, paid, partly refunded,
refunded, or disputed. Owners and admins refund all or part of a paid request after re-authenticating.
Payouts shows this month's paid total, refunds, platform fees, provider fees, and the host's share.

**Why this priority**: FR-13.5, FR-13.8; refunds are needed before real money moves, and fees must be
visible.

**Independent Test**: Refund 20 of a paid 85 USD order (partly refunded), then the rest (refunded); a
third refund is refused; an agent can't refund; a refund without re-authentication asks for it; the
totals on Payouts add up.

**Acceptance Scenarios**:

1. **Given** a paid request, **When** an owner refunds 20 USD after re-authenticating, **Then** the
   order is partly refunded with 65 USD left and the guide shows the refund.
2. **Given** refunds that reach the amount paid, **When** another refund is tried, **Then** it is
   refused.
3. **Given** an agent, **When** they try to refund, **Then** it is refused.
4. **Given** a paid request, **When** a member tries to cancel it, **Then** they are asked to refund it in
   full first.
5. **Given** a provider event that opens a dispute, **When** it is handled, **Then** the order shows
   "Disputed" and owners get an email.
6. **Given** paid and refunded orders this month, **When** an owner or admin opens Payouts, **Then** the
   totals match the orders.

---

### User Story 4 - The founder sets a custom platform fee (Priority: P3)

The founder sets a negotiated platform fee for a workspace with the plan tool, and new orders use it.

**Why this priority**: Business plans have negotiated fees (business model §3); without it every
workspace pays its plan's fee.

**Independent Test**: Set 4% for a workspace; its next order's platform fee is 4%; earlier orders keep
theirs; the security log records the change.

**Acceptance Scenarios**:

1. **Given** a custom fee of 4%, **When** a new order is created, **Then** its platform fee is 4% of the
   price.
2. **Given** an existing order, **When** the fee changes, **Then** its recorded amounts don't change.

---

### Edge Cases

- **Price changed after the request**: the request keeps the price it was made with (spec 008); the
  order uses the request's price × quantity.
- **Request declined, cancelled, or expired while a checkout is open**: no new checkout starts; a
  payment that still arrives for the open one is recorded and the order is marked "refund due" for the
  host (paid but no longer wanted).
- **Payouts turned off or rejected after a request was confirmed**: no new checkouts; paid orders stay.
- **Stay cancelled after payment**: the order stays paid; hosts see it on Requests and refund it.
- **Rounding**: amounts are kept in minor units (cents); fees round to the nearest unit, and the
  host's share takes the remainder so the three parts always add up to the price.
- **Workspace pending deletion or removed property**: no new checkouts; orders are kept for accounting.
- **A forged, unsigned, or replayed event**: refused, logged, and nothing changes.
- **The guest pays twice in two tabs**: only one open checkout per request; a second paid event for the
  same request is recorded and flagged for a refund.

## Requirements *(mandatory)*

### Functional Requirements

**Payments setup**

- **FR-001**: The system MUST reach the payment provider only through a payment port. This spec MUST
  provide a simulated provider (hosted checkout, onboarding, refunds, signed events) for development and
  tests, and MUST refuse it in production, where payments stay off until a real adapter exists.
- **FR-002**: Owners MUST be able to start and resume the provider's payout onboarding from Payouts
  (H-33); members MUST see the payouts state; only the owner MUST be able to start or change it.
- **FR-003**: Payouts MUST be active before any checkout starts in the workspace.

**Checkout**

- **FR-004**: A guest with a working stay link MUST be able to pay a request that is confirmed, priced
  above zero, in a currency the provider accepts (USD, CRC), and not early check-in or late checkout
  (OQ-35), when payouts are active and payments are on.
- **FR-005**: The guest MUST see the total before paying; the total MUST be the request's price ×
  quantity with no added fees, with a note that any taxes are included by the host.
- **FR-006**: Checkout MUST happen on the provider's hosted page; Guidesk MUST NOT receive or store card
  data or the guest's contact details.
- **FR-007**: An order MUST become paid only through a verified provider event; the browser's return
  MUST show "processing" until then.
- **FR-008**: Each request MUST have at most one open checkout; starting again MUST reuse it until it
  expires (60 minutes).
- **FR-009**: Provider events MUST be verified (signature), handled once each (idempotent), and
  recorded; unverified events MUST be refused and logged.
- **FR-010**: When a request is paid, the property's escalation contacts MUST get one email (spec 007
  contacts).

**Orders and money**

- **FR-011**: Every order MUST record the price, currency, platform fee, provider fee, and the host's
  share, in minor units, with the three parts adding up to the price.
- **FR-012**: The platform fee MUST be the workspace's custom fee or its plan's (Free 10%, Pro 7%,
  Business 5%), fixed when the order is created.
- **FR-013**: The host's share MUST be settled to the host's provider account (split settlement); Guidesk
  MUST NOT hold it.

**Refunds and disputes**

- **FR-014**: Owners and admins MUST be able to refund a paid order fully or partly after
  re-authenticating (10 minutes); refunds MUST never exceed the amount paid; each refund MUST be logged
  in the security log.
- **FR-015**: A paid request MUST NOT be cancelled until it is fully refunded.
- **FR-016**: A dispute event MUST mark the order disputed and email the owners.
- **FR-017**: Payment problems a guest raises in the chat MUST keep escalating to the host (spec 005
  money escalation); the assistant never promises refunds.

**Screens and reporting**

- **FR-018**: The guest's Extras page MUST show each request's payment state (pay, processing, paid,
  refunded with the amount, disputed) and, after payment, the provider's reference.
- **FR-019**: The Requests screen MUST show each request's payment state and offer refunds to owners and
  admins.
- **FR-020**: Payouts MUST show this month's paid total, refunds, platform fees, provider fees, and the
  host's share (by currency).
- **FR-021**: The founder MUST be able to set a custom platform fee per workspace with the plan tool;
  changes MUST be in the security log.
- **FR-022**: Screens MUST be available in Spanish and English, meet WCAG 2.2 AA, and keep every portal
  route within 150 KB of JavaScript.

### Key Entities *(include if feature involves data)*

- **Payout account**: the workspace's account at the provider: provider, provider account reference,
  state (not started, pending, active, rejected).
- **Payment order**: one checkout for one request: amounts (price, platform fee, provider fee, host's
  share, refunded), currency, state (open, paid, partly refunded, refunded, disputed, failed, expired,
  cancelled), provider reference, timestamps. No personal data.
- **Refund**: an amount returned on an order, who asked for it, and its state.
- **Payment event**: each provider event handled, by provider and event ID, for idempotency.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A guest pays a confirmed add-on in under 1 minute from tapping Pay (excluding the time on
  the provider's page) on a phone.
- **SC-002**: In tests, no order becomes paid without a verified event, and replaying any event changes
  nothing.
- **SC-003**: Every paid order's price equals the platform fee plus the provider fee plus the host's
  share, to the minor unit.
- **SC-004**: No refund exceeds the amount paid, including 10 refunds sent at once.
- **SC-005**: Guest checkout and the event route answer within 500 ms at the 95th percentile (excluding
  the provider).
- **SC-006**: Payouts, the Requests payment column, and the guest's payment states have no automated
  accessibility violations, and every portal route stays within 150 KB of JavaScript.

## Security Considerations *(mandatory when the feature touches authentication, restricted data, agent tools, integrations, file uploads, or payments)*

This feature moves money: checkout, payouts, refunds, and provider events.

### Threats (STRIDE)

- **S**: Forged or replayed provider events mark orders paid.
- **T**: A guest changes the amount or pays someone else's request; a crafted return URL fakes success.
- **R**: A refund cannot be traced to a member.
- **I**: Another workspace reads orders or payouts; card data or guest contact details leak.
- **D**: Card testing through repeated checkouts.
- **E**: An agent refunds or starts onboarding; a member refunds without re-authenticating.

### Controls Applied

- **SEC-21**: Hosted checkout only; orders paid only after a verified event; idempotent state machine;
  provider onboarding for payouts; refunds need step-up and are logged.
- **SEC-05**: Refunds need re-authentication within 10 minutes; payouts onboarding is owner-only.
- **SEC-07**: Checkout starts are rate-limited per stay session and per request.
- **SEC-14**: Orders, refunds, and payouts are tenant data under RLS; cross-tenant tests cover the new
  routes.
- **SEC-16**: Refunds, onboarding changes, disputes, and refused events go to the security log.
- **SEC-20**: Orders hold no personal data; the guest's contact details stay with the provider.

### Abuse Cases (Acceptance Criteria)

- **AC-SEC-001**: Given an event with a wrong signature or a replayed event ID, when it arrives, then
  it is refused or ignored and no order changes.
- **AC-SEC-002**: Given a checkout request, when the body carries an amount, currency, or another
  request's ID, then the server uses only the stored request's amount and refuses foreign requests.
- **AC-SEC-003**: Given an agent, or an owner without recent re-authentication, when they refund, then
  it is refused.
- **AC-SEC-004**: Given 10 refunds sent at once that together exceed the amount paid, when they are
  handled, then the total refunded never exceeds it.
- **AC-SEC-005**: Given a member of another workspace, when they read orders, payouts, or refund, then
  they get 404 and the attempt is logged.
- **AC-SEC-006**: Given a return to the guide with a "paid" query, when no verified event arrived, then
  the order is not paid.
- **AC-SEC-007**: Given the simulated provider, when the API starts in production, then it refuses to
  start with it.

### Platform Policies

- **PC-06, PC-08**: Only optional add-ons are sold; nothing changes the reservation; property access
  never depends on a purchase.
- **PC-03**: No guest contact data is asked for; the provider's page collects what the payment needs.
- Early check-in and late checkout are not sold through checkout until the legal review (OQ-35).

## Assumptions

- Specs 001 to 011 are in place: stay links and sessions (004), add-on requests (008), escalation
  contacts (007), step-up re-authentication (001), and plans (011).
- Tilopay (ADR-0007) replaces the simulated provider once the legal entity and the merchant account
  exist; split settlement, onboarding, refunds through the API, the event signature, and fees are
  confirmed then (OQ-37). The simulated provider charges an illustrative fee (3.5% plus 0.30 USD or 150
  CRC) until real fees are known.
- Orders are kept for accounting; their retention period comes with the legal review.
- The pilot's first payments happen in staging and production only after the Tilopay adapter exists.
