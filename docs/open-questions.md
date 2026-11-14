# Open Questions and Assumptions

> **Status:** Active log · **Owner:** Founder · **Last updated:** 2026-11-13

This is the single place for unresolved decisions. When a question is answered, record the
answer and date, and update the affected documents. Spec-level questions move into the
relevant spec as `[NEEDS CLARIFICATION]` items.

**Priority:**

- **P0:** blocks the start of Phase 1.
- **P1:** blocks a specific feature or phase.
- **P2:** important, not blocking.

## Business and product

| ID | Question | Priority | Blocks | Status / answer |
|---|---|---|---|---|
| OQ-01 | Which legal entity will bill customers and collect payments: an existing Costa Rica company, a new US entity (e.g. Delaware), or another? | P0 | F13 payments in MVP month 4 (needed by week 10); F11 billing after the pilot; affiliate and partner contracts | Open. Tilopay ([ADR-0007](architecture/adr/0007-tilopay-initial-payment-provider.md)) works with a Costa Rica company, so a US entity is no longer on the MVP's critical path. It may be needed later for Stripe or US expansion. |
| OQ-02 | MVP start date, target pilot date, and monthly budget for infrastructure, AI, and APIs | P0 | Roadmap dates, Free-plan caps | Partly answered 2026-11-14: the founder works full time, so Phase 1 lasts 4 months. Start date and budget still open. |
| OQ-03 | Design partners: which hosts and managers can join the pilot, and which PMS do they use? | P0 | Pilot plan, choice of the first PMS adapter and of the MVP read-only importers (FR-02.5) | Open |
| OQ-04 | Funding approach: bootstrapped, or pre-seed / accelerator? | P2 | Hiring, pace | Open |
| OQ-05 | Guest languages: Spanish and English are confirmed. Add Portuguese (Brazil)? | P1 | NFR-06, Phase 3 scope | Open |
| OQ-06 | Founder insight: what motivated Guidesk, and which existing tools do you know and dislike? | P2 | Positioning, messaging | Open |
| OQ-07 | Confirm the MVP prioritization in [PRD §4](product/prd.md#4-feature-catalog-and-prioritization) | P0 | Phase 1 scope | Answered 2026-11-14. Confirmed, with changes: online payments for add-ons (F13) join the MVP as a month-4 milestone; read-only PMS import, CSV import, basic analytics, and voice notes are in; the pilot is free and billing waits until after it; reservations stay in Phase 2 and insurance in Phase 3. Phase 1 grows to 4 months. |
| OQ-08 | Do hosts receive a share of affiliate commissions (tours, reservations) as an incentive? | P1 | F09, business model | Open |
| OQ-09 | Who absorbs payment processing fees on add-ons: the guest (service fee), the host, or Guidesk? | P1 | F13 (MVP, month 4) | Open |
| OQ-10 | Pricing: Free-plan caps (properties, AI replies) and the Pro price point | P1 | F11 | Hypothesis in the [business model](product/business-model.md); validate in the pilot |
| OQ-11 | Brand: trademark search and domain availability for "Guidesk" in the target markets; visual identity | P1 | Public launch | Open |

## Technical

| ID | Question | Priority | Decided in | Status |
|---|---|---|---|---|
| OQ-20 | How are guests verified before sensitive information is revealed: reservation-scoped link, confirmation code, or host PIN? | P1 | Spec 004 | Open |
| OQ-21 | Host authentication provider: Better Auth or Clerk? It must support passkeys, TOTP, step-up re-authentication, and session revocation (SEC-05). | P1 | Spec 001 plan | Answered 2026-11-14: Better Auth, self-hosted ([ADR-0008](architecture/adr/0008-authentication-better-auth.md), accepted). |
| OQ-22 | Final hosting vendors (web, API and worker, Postgres) and the KMS for field-level encryption (SEC-06) | P1 | Foundations spec | Answered 2026-11-14: AWS in `us-east-1`. CloudFront and WAF, OpenNext on Lambda, ECS Fargate, RDS PostgreSQL, AWS KMS, Secrets Manager, with SST ([ADR-0009](architecture/adr/0009-mvp-hosting-and-transactional-email.md), accepted). |
| OQ-23 | Introduce cheaper models on specific routes? This needs eval evidence and founder approval. | P2 | Post-pilot | Open (see [ADR-0005](architecture/adr/0005-llm-provider-and-agent-design.md)) |
| OQ-24 | Approve ADR-0004 (TypeScript stack) and ADR-0005 (LLM and agent design) | P0 | Founder review | Answered 2026-11-13: both accepted. ADR-0005 amended 2026-11-14 with the staged hybrid knowledge strategy. |
| OQ-25 | Which multilingual embedding provider for the hybrid knowledge strategy? It becomes a new subprocessor, so it needs a review of its data-processing terms. | P2 | Spec that introduces the hybrid strategy | Open. Only needed when an ADR-0005 switch trigger fires. |
| OQ-26 | May Guidesk use a customer's own API token or key to import data read-only from Beds24, Hostex, and Hostaway before any partner agreement? Check each provider's API terms. | P1 | Spec 002 | Open. Decides the MVP importers (FR-02.5). |
| OQ-27 | Does Airbnb's personal-data download include a host's listing content (description, rules, amenities)? In what format, and how long does it take? If it does, accept the file as another import source. | P2 | Spec 002 | Open (unverified idea) |
| OQ-28 | May a guest save the arrival steps, which include restricted values, for offline use until checkout? Guests often lose signal at the door, but offline storage puts the code on the device ([SEC-04](architecture/security.md#4-controls)). | P1 | Spec 004 | Open |
| OQ-29 | Transactional email provider for host notifications and escalation alerts (for example Resend, Postmark, or Amazon SES) | P1 | Spec 001 plan | Answered 2026-11-14: Amazon SES, with Postmark as fallback ([ADR-0009](architecture/adr/0009-mvp-hosting-and-transactional-email.md), accepted). |

## Partnerships and legal

| ID | Item | Priority | Status |
|---|---|---|---|
| OQ-30 | Apply to the Hospitable partner program | P0 | Not started |
| OQ-31 | Apply to the Hostaway partner program and marketplace | P0 | Not started |
| OQ-32 | Contact Guesty partnerships (Open API is not for marketplace partners) | P1 | Not started |
| OQ-33 | Contact Smoobu for partner OAuth access | P1 | Not started |
| OQ-34 | Join affiliate programs: Viator, Civitatis, GetYourGuide | P1 | Not started |
| OQ-35 | Legal review covering: Airbnb policies (commercial messages under the API terms, links in messages, disclosures); whether early check-in and late checkout may be sold through Guidesk checkout on each OTA (FR-13.6); receipts and guest contact data at checkout; privacy policy and terms of service; GDPR, CCPA, and LATAM data-protection laws; insurance distribution | P1 (payments part needed before month 4) | Not started |
| OQ-36 | Ask Channex in writing whether it supports a messaging-only Airbnb connection | P2 | Not started |
| OQ-37 | Confirm with Tilopay: split settlement for hosts under the payment-facilitator model, host onboarding requirements, coverage for hosts outside Costa Rica and Central America, acceptance of international cards, refunds through the API, the webhook signature scheme for card payments, and fees | P0 (before F13, by week 10) | Not started |

## Unverified research items

Carry these forward from the [research](research/) until they are confirmed:

- Whether Lodgify, Uplisting, and Stays.net expose guest-messaging endpoints to partners.
- Partner fees and conditions at Hostaway, Guesty, and Rentals United.
- Whether Calry's unified PMS API covers messaging.
- Independent PMS market-share data for the US and LATAM.
- Commission rates for insurance distribution in LATAM.
- Whether Hospitable's partner API reaches hosts on its free plan. The sources contradict each
  other: one says the API is paid-plan only (Host plan, about $29 per month).
- The effective date and exceptions of Airbnb's rules on guest contact data and required apps.
  The sources cite May 2025 and article 4169, which applies to bookings from 2026-11-20. Covered
  by the legal review (OQ-35).

## Key assumptions

Validate these in the pilot:

| ID | Assumption | How we validate |
|---|---|---|
| A-01 | Hosts can and will deliver the guide link through OTA scheduled messages | Activation metric; host interviews |
| A-02 | Enough guests open the guide and use its chat for the agent to add value before PMS integrations | Guide-open rate per stay; chat usage |
| A-03 | About 15 agent replies per stay, with an AI cost of about $0.03–0.11 per reply | Pilot telemetry |
| A-04 | 10% of stays attach a tour and 25% request an add-on | Pilot telemetry |
| A-05 | At least one PMS partner approves Guidesk within about 3–4 months | Application tracking (OQ-30 to OQ-33) |
| A-06 | Hosts receive escalation alerts reliably through PWA web push plus email, without a native app | Notification delivery and time-to-acknowledge by OS; iOS PWA install rate ([ADR-0006](architecture/adr/0006-web-first-pwa-no-native-apps.md)) |
