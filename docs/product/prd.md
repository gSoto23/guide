# Product Requirements Document (PRD)

> **Status:** Draft v0.2 · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [Vision](vision.md) · [Personas](personas.md) · [Business model](business-model.md) · [Roadmap](roadmap.md) · [Platform policies](../research/platform-policies.md) · [Architecture overview](../architecture/overview.md) · [Open questions](../open-questions.md)

This PRD defines Guidesk at the product level: the feature catalog, priorities, cross-cutting
requirements, and success metrics. Each feature is detailed later in its own Spec Kit
specification (`specs/NNN-feature/spec.md`). When a spec and this PRD conflict, the spec wins
for that feature, and this PRD is updated to match.

## 1. Goals

| # | Goal | Measured by |
|---|---|---|
| G1 | Hosts publish a complete guide quickly | Time from sign-up to published guide; guide completeness score |
| G2 | Guests get instant, correct answers | Automated resolution rate; answer accuracy (evals and host feedback) |
| G3 | Hosts spend less time on guest messaging | Host-reported and measured time saved; escalation rate |
| G4 | Each stay generates incremental revenue | Attach rate; services GMV per stay; take rate |
| G5 | Zero platform-policy incidents caused by Guidesk | Policy incidents reported by hosts (target: 0) |

## 2. Non-goals

- Managing pricing, availability, calendars, or bookings on the OTAs (Guidesk is not a PMS).
- Talking to guests over WhatsApp, SMS, or email. This was a product decision on 2026-11-13.
  Hosts may receive notifications by email or push.
- Any integration that relies on scraping, browser automation, or sharing credentials.
- Moving a reservation, or a payment for a reservation, off the platform where it was made.
- Native mobile apps (iOS or Android) in the MVP or Phase 2. Guests and hosts use responsive,
  installable web apps (PWAs). A guest app is never required (PC-02). A native host app will be
  re-evaluated after the pilot ([ADR-0006](../architecture/adr/0006-web-first-pwa-no-native-apps.md)).

## 3. Users

- **P1** Ana, individual host
- **P2** Marco, professional manager
- **P3** Emily, guest
- **P4** Luis, local provider (Phase 3)

See [Personas](personas.md).

## 4. Feature catalog and prioritization

The phases follow the adopted integration strategy
([ADR-0003](../architecture/adr/0003-phased-channel-integration-strategy.md)). Priorities use
MoSCoW per phase. **The founder confirmed this prioritization on 2026-11-14 (OQ-07).**

- **Two MVP milestones.** The pilot starts at the end of month 3 with every MVP feature except
  payments. Payments (F13) ship in month 4, once the legal entity and payment provider exist
  (OQ-01). Phase 1 therefore lasts 4 months, with the founder working full time.
- **Cut order if the schedule slips:**
  1. voice-note answers (FR-03.3);
  2. PMS importers that no pilot host uses (FR-02.5);
  3. analytics beyond the pilot metrics (F10);
  4. CSV import (FR-02.4).

| ID | Feature | Phase | MoSCoW (MVP) | Primary persona | Planned spec |
|---|---|---|---|---|---|
| F01 | Workspaces, accounts, roles and invitations (users in several workspaces) | MVP | Must | P1, P2 | `001-workspace-accounts` |
| F02 | Property onboarding (manual entry, pasted text or screenshots, CSV import, read-only PMS import, duplication, iCal) | MVP | Must | P1, P2 | `002-property-onboarding` |
| F03 | Guide builder (templates, editor, AI interview, document upload, translations, shared workspace content) | MVP | Must | P1, P2 | `003-guide-builder` |
| F04 | Guest guide web app | MVP | Must | P3 | `004-guest-guide` |
| F05 | In-guide AI chat (agent) | MVP | Must | P3 | `005-guide-chat-agent` |
| F06 | Host inbox and reply copilot | MVP | Must | P1, P2 | `006-host-inbox-copilot` |
| F07 | Agent settings: autonomy, escalation, tone | MVP | Must | P1, P2 | `007-agent-settings` |
| F08 | Service catalog and host add-on requests | MVP | Must | P1, P3 | `008-service-catalog` |
| F09 | Tours and experiences (affiliate) | MVP | Must | P3 | `009-tours-affiliate` |
| F10 | Analytics (basic) | MVP | Must | P1, P2 | `010-analytics` |
| F11 | Plans, limits and subscription billing | MVP: limits only (the pilot is free); billing in Phase 2 | Must (limits) | P1, P2 | `011-plans-billing` |
| F12 | PMS integrations: in-platform chat and continuous sync (read-only import starts in F02) | Phase 2 | — | P2 | `012-pms-integrations` |
| F13 | Guest checkout and payouts (add-ons) | MVP, month 4 | Must (needs OQ-01) | P1, P3 | `013-payments-checkout` |
| F14 | Reservations partners (car rental, transfers, restaurants) | Phase 2 | — | P3 | `014-reservations` |
| F15 | Internal back-office (support, partners, moderation) | Phase 2 (minimal in MVP) | — | Internal | `015-backoffice` |
| F16 | Embedded insurance | Phase 3 | — | P3 | `016-insurance` |
| F17 | White-label connectivity for hosts without a PMS | Phase 3 | — | P1 | `017-whitelabel-connectivity` |
| F18 | Local provider marketplace | Phase 3 | — | P4 | `018-provider-marketplace` |
| F19 | In-app tour booking (partner booking APIs) | Phase 3 | — | P3 | `019-tours-booking` |
| F20 | Public API and webhooks (Business plan) | Phase 3 | — | P2 | `020-public-api` |
| F21 | Portfolio management: property groups, per-property permissions, owner read-only access | Phase 2 | — | P2 | `021-portfolio-management` |

Spec numbers are indicative. Spec Kit assigns the final number when `/speckit-specify` runs.

## 5. Functional requirements (high level)

Requirements use RFC 2119 keywords. Each feature spec refines them into testable acceptance
criteria.

### F01 — Workspaces, accounts and roles

- **FR-01.1** A host MUST be able to sign up with Google, a passkey, or a passwordless email
  one-time code (no passwords; decided in spec 001), and get a workspace in which they are the
  `owner`.
- **FR-01.2** A workspace MUST support members with the roles `owner`, `admin`, and `agent`
  (support staff). Plan limits apply. Agents never see restricted values such as door codes.
- **FR-01.3** All workspace data MUST be isolated per tenant (constitution, Principle VI).
- **FR-01.4** Sign-up MUST ask at most three onboarding questions:
  - how many properties the host manages (1–2, 3–10, 10+);
  - which PMS they use, if any;
  - their country and language.

  The answers tailor onboarding (individual-host or manager path). They are also reported
  internally to prioritize PMS importers and adapters.
- **FR-01.5** Owners and admins MUST be able to invite members by email with a role. Accepting
  an invitation adds the user to the existing workspace and never creates a new one.
- **FR-01.6** A user MUST be able to belong to several workspaces and switch between them. For
  example, a co-host may work for two managers, or a host may own properties and also co-manage
  someone else's. The identity (user) is separate from the membership (member), and roles apply
  per workspace.
- **FR-01.7** Per-property permissions and an owner read-only role are Phase 2 (F21).

### F02 — Property onboarding

- **FR-02.1** A host MUST be able to create a property with its core facts: address, time zone,
  check-in and checkout times, capacity, and languages.
- **FR-02.2** A host MUST be able to provide their own listing content (title, description,
  house rules, amenities) by pasting the text or uploading screenshots of their listing. The
  system extracts and structures it with AI.
  - Guidesk MUST NOT fetch OTA listing pages automatically, even when the host provides the
    listing URL. Automated fetching counts as scraping and is prohibited by the constitution and
    by Airbnb's Terms of Service (PC-12). Guidesk never asks for OTA passwords.
  - Automatic import comes from PMS APIs (FR-02.5).
- **FR-02.3** A host SHOULD be able to connect an OTA iCal export URL so Guidesk knows the stay
  windows. Stay windows are used to unlock sensitive information and to schedule guide reminders.
- **FR-02.4** A host MUST be able to create properties in bulk from a CSV file.
  - Columns: name, address, time zone, check-in and checkout times, capacity, languages, and
    iCal URL.
  - The portal offers a downloadable template and reports validation errors per row.
- **FR-02.5** A host MUST be able to import properties, listing content, and upcoming
  reservations **read-only** from a supported PMS, starting in the MVP.
  - **MVP targets:** PMSs whose APIs accept a customer's own token without a partner agreement
    (Beds24, Hostex). Hostaway is added if its terms allow a customer's API key before partner
    approval (OQ-26). The final choice follows the design partners' PMSs (OQ-03).
  - The import creates a guide draft for each property (FR-03.10).
  - After the import, upcoming reservations are refreshed read-only: every 3 hours, and on
    "Refresh now" (feature 002, FR-034 and FR-035). Guidesk never writes to the PMS.
  - Messaging through the PMS and two-way sync remain in F12 (Phase 2).
- **FR-02.6** A host MUST be able to duplicate an existing property as a starting point.
  - Copied: guide sections, links to shared content, services, and agent settings.
  - Not copied: address, iCal URL, stays, conversations, and sensitive values.

### F03 — Guide builder

- **FR-03.1** The system MUST provide a default guide template with these sections: Arrival and
  access; Wi-Fi; House rules; Appliances and how-tos; Amenities; Parking and transport; Local
  recommendations; Emergency and contacts; Checkout.
- **FR-03.2** A host MUST be able to edit sections with a rich editor, including images and short
  videos.
- **FR-03.3** The system MUST offer an AI-assisted onboarding interview. It asks the host
  targeted questions and drafts the guide sections. Voice-note answers MUST be supported.
- **FR-03.4** A host MUST be able to upload documents and images (PDF manuals, photos of
  appliances or access points). The system extracts knowledge from them.
- **FR-03.5** The system MUST machine-translate the guide into the supported languages
  (Spanish and English). The host can review and override each translation.
- **FR-03.6** The system MUST compute a guide completeness score and suggest the missing
  information that guests ask about most.
- **FR-03.7** The host MUST be able to mark fields as **sensitive**: access codes, Wi-Fi
  password, alarm, lockbox. Sensitive fields follow FR-04.4.
- **FR-03.8** Owners and admins MUST be able to define **shared content** at the workspace
  level. Examples: company policies, emergency contacts, checkout steps, and area
  recommendations.
  - Properties inherit shared content.
  - A property can override any shared block locally.
  - Editing a shared block updates every property that inherits it and has not overridden it.
- **FR-03.9** Sensitive values that arrive through an import, such as PMS fields for door codes
  or Wi-Fi passwords, MUST be marked sensitive and encrypted when they are ingested. They are
  masked in the editor until the host chooses to reveal them, and they never go to the LLM.
- **FR-03.10** Imported, pasted, or extracted content MUST produce a **draft**, never a published
  guide. The host reviews and publishes it. The completeness score (FR-03.6) highlights what
  imports usually miss, such as appliance how-tos, personal local tips, and photos of access
  points. The AI interview fills those gaps.

### F04 — Guest guide web app

- **FR-04.1** The guide MUST open from a link or QR code, with no app download and no guest
  account.
- **FR-04.2** The guide MUST be mobile-first and work on slow connections. Content already
  viewed SHOULD remain available offline (PWA).
- **FR-04.3** The guide MUST display in the guest's language, detected automatically and
  switchable by the guest.
- **FR-04.4** Sensitive fields MUST only be shown to a verified guest inside their stay window.
  The verification method is defined in the spec: options include a reservation-scoped link, a
  confirmation code, or a host-shared PIN. Outside the stay window, the guest sees a placeholder.
- **FR-04.5** Access instructions MUST also be deliverable through the OTA thread. Using the guide
  is optional for guests (policies PC-01, PC-02).
- **FR-04.6** Any service offer MUST show a clear disclosure when the host or Guidesk receives a
  commission or benefit (policy PC-07).

### F05 — In-guide AI chat

- **FR-05.1** Guests MUST be able to chat with the agent from any page of the guide.
- **FR-05.2** The agent MUST answer property-specific questions only from the property's
  knowledge base, and SHOULD reference the guide section it used.
- **FR-05.3** When the agent cannot answer with confidence, it MUST say so, tell the guest the
  host will follow up, and create an escalation in the host inbox.
- **FR-05.4** The agent MUST detect the guest's language and reply in it.
- **FR-05.5** The agent MAY suggest relevant services from the catalog (F08, F09). Suggestions
  must be contextual, opt-in, rate-limited, and disclosed.
- **FR-05.6** The agent MUST follow the agent behavior rules in section 6.

### F06 — Host inbox and reply copilot

- **FR-06.1** The host MUST see every guest conversation (in-guide chat in the MVP; platform
  chats from Phase 2) in one inbox, with escalations highlighted.
- **FR-06.2** The host MUST be able to approve, edit, or reject agent drafts, and take over a
  conversation at any time.
- **FR-06.3** **Copilot for hosts without integration:** the host pastes a guest message from any
  OTA chat and gets a suggested reply grounded in the guide, ready to copy back. Copilot drafts
  MUST pass the same policy checks as automated messages (PC-14).
- **FR-06.4** The host MUST receive escalation notifications by email and push (web push or
  mobile PWA). The notification includes a deep link to the conversation.
- **FR-06.5** Every agent message or draft MUST record its trace: the knowledge used, tools
  called, policy checks, model, and cost (Principle III and Principle VIII).

### F07 — Agent settings

- **FR-07.1** The host MUST set an autonomy level per topic category: `draft`, `auto`, or
  `full_auto`. The default for new workspaces is `draft`.
- **FR-07.2** Mandatory escalation categories MUST NOT be configurable to auto (section 6.2).
- **FR-07.3** The host SHOULD be able to set tone (formal or casual), quiet hours, escalation
  contacts, and custom instructions. Custom instructions cannot override the policy rules.
- **FR-07.4** Agent settings MUST be defined as workspace defaults, and each property can
  override them.

### F08 — Service catalog and host add-ons

- **FR-08.1** A host MUST be able to define add-ons with a name, description, price, currency,
  lead time, and availability rules (for example, early check-in only if there is no same-day
  turnover).
- **FR-08.2** A guest MUST be able to request an add-on from the guide or the chat. The host
  confirms or declines. Once F13 is live, the guest pays through Guidesk checkout. Until then,
  or where checkout is unavailable to a host (no payout account, unsupported country), the host
  collects payment with the guest's agreement, per the policies.
- **FR-08.3** Purchases MUST be opt-in. Property access MUST never depend on a purchase (PC-08).

### F09 — Tours and experiences (affiliate)

- **FR-09.1** The system MUST show curated experiences near the property from affiliate partners
  (initially Viator and Civitatis; GetYourGuide is optional), using affiliate links with tracking.
- **FR-09.2** A host MUST be able to hide categories or pin their own recommendations.
- **FR-09.3** Affiliate relationships MUST be disclosed in the UI (policy PC-07).

### F10 — Analytics (basic)

- **FR-10.1** Hosts MUST see per property and per period: guide views, questions answered
  automatically, escalations, top questions, unanswered questions, offer clicks, and add-on
  requests.

### F11 — Plans, limits and billing

- **FR-11.1** The system MUST enforce plan limits: properties, AI replies, and seats.
- **FR-11.2** The pilot is free. Plan limits (FR-11.1) are enforced from the MVP, but
  subscription billing starts after the pilot (Phase 2), once the legal entity and payment
  provider exist (OQ-01).

### F13 — Guest checkout and payouts (MVP, month 4)

- **FR-13.1** A guest MUST be able to pay for a confirmed add-on through the payment provider's
  hosted checkout (Tilopay's hosted payment page or payment links, ADR-0007). Card data never
  touches Guidesk, which keeps PCI DSS scope minimal (SEC-21).
- **FR-13.2** Guests MUST be charged only for add-ons the host has confirmed, or that the
  host's availability rules pre-approve.
- **FR-13.3** Before offering paid add-ons, a host MUST complete the provider's payout
  onboarding (identity and bank verification, handled by the provider). Payouts go to the host
  minus the platform fee, through Tilopay's split settlement, so Guidesk never holds the host's
  share (to be confirmed, OQ-37). Provider fees follow OQ-09.
- **FR-13.4** The guest MUST see the total, with taxes and fees, before paying. Receipts come
  from the provider's checkout. Guidesk stores no guest contact data beyond what the payment
  requires (PC-03, legal review OQ-35).
- **FR-13.5** Hosts MUST be able to refund an order, fully or partially, from the portal, with
  step-up re-authentication. Refund requests and payment disputes always escalate to a human
  (§6.2).
- **FR-13.6** Policy limits (PC-06, PC-08):
  - Guidesk MUST NOT sell anything that changes the reservation (dates, nights, guest count) or
    any fee mandatory for the stay. Those go through the OTA.
  - Every purchase is opt-in.
  - Whether early check-in and late checkout count as optional services on each OTA is confirmed
    by the legal review (OQ-35) before they are sold through checkout.
- **FR-13.7** The payment provider sits behind `PaymentPort`. **Tilopay is the initial
  provider** ([ADR-0007](../architecture/adr/0007-tilopay-initial-payment-provider.md)). It
  works with a Costa Rica company. Markets Tilopay does not cover get another adapter later
  (for example Stripe through a US entity, Mercado Pago, or dLocal).
- **FR-13.8** Every order records its platform fee and commissions (`COMMISSION`) for payouts
  and reporting.

### F12 — PMS integrations (Phase 2)

- **FR-12.1** A host MUST be able to connect a supported PMS from a guided wizard. OAuth is used
  where the PMS supports it; otherwise an API-key flow with step-by-step help.
- **FR-12.2** On connection, the system MUST import properties, listing content, and upcoming
  reservations (as in FR-02.5), and keep reservations current beyond the MVP's read-only
  refresh.
- **FR-12.3** The system MUST receive guest messages from the PMS (webhooks or polling), run them
  through the agent, and send replies back through the PMS into the OTA thread. The host's
  autonomy settings apply.
- **FR-12.4** Each PMS adapter MUST implement the common `ChannelPort` and `PropertySourcePort`
  interfaces and pass contract tests (Principle IV).
- **FR-12.5** Initial targets: Hospitable and Hostaway, then Guesty and Smoobu, subject to
  partner approval.

The other Phase 2 and 3 features (F14–F21) are outlined in the [roadmap](roadmap.md). They will
get requirements when their specs are written.

## 6. Agent behavior requirements

### 6.1 Knowledge boundaries

- Property-specific facts come only from the property's knowledge base, the catalog, and
  reservation data.
- General destination information (weather, typical travel times, cultural tips) is allowed. It
  must be phrased conservatively and never contradict host-provided information.
- The agent MUST NOT promise refunds, discounts, date changes, or exceptions to house rules.
- Reservation modifications must go through the OTA, and the agent says so.

### 6.2 Mandatory escalation (never automated)

1. Emergencies and safety (medical, fire, gas, security, a guest locked out at night)
2. Property damage or malfunction that prevents the stay
3. Complaints and negative sentiment above a threshold
4. Refunds, compensation, payments, or disputes
5. Reservation changes (dates, guest count, cancellations)
6. Legal, discrimination, or harassment topics
7. Requests for sensitive information that fail verification
8. Anything the agent cannot answer with confidence

For emergencies, the agent MUST also show the property's emergency contacts and local emergency
numbers immediately.

### 6.3 Commerce rules

- Offers are relevant to the conversation or the stay moment (before arrival, during the stay,
  before checkout).
- **Inside OTA threads**, the agent MUST NOT send unsolicited commercial messages unless the
  partner or API terms explicitly allow it (PC-10). It may answer a guest's own question about
  services and point to the guide.
- **Inside the guide chat**, at most one unsolicited offer per conversation per day.
- Every offer includes the disclosure (PC-07).
- A guest who declines an offer is not offered it again during the stay.

### 6.4 Safety and privacy

- Guest messages are treated as untrusted input. Instructions inside guest messages MUST NOT
  change the agent's rules or reveal data.
- The agent MUST NOT ask Airbnb guests for phone numbers, emails, or ID documents unless the law
  requires it (policy PC-03).
- Sensitive fields are released only through the verified flow in FR-04.4, never because a guest
  asks in chat.

### 6.5 Style

- Concise, warm, and accurate. Matches the host's chosen tone and the guest's language.
- No exaggerated claims.
- When unsure, the agent asks one clarifying question rather than guessing.

## 7. Non-functional requirements

| ID | Category | Requirement (MVP target) |
|---|---|---|
| NFR-01 | Performance | Guest guide at p75 on mid-range mobile over 4G: LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. The guide stays usable on slow 3G. Agent first token ≤ 3 s and full reply ≤ 10 s at p90. Full budgets are in the [performance architecture](../architecture/performance.md). |
| NFR-02 | Availability | 99.5% monthly for the guide and the chat. Degraded mode: the guide stays readable if the agent or LLM is down. |
| NFR-03 | Security | Encryption in transit and at rest. Restricted data (access codes, integration credentials) uses field-level encryption with keys outside the database. OWASP ASVS L2 as the baseline. Controls SEC-01 to SEC-21 are in the [security architecture](../architecture/security.md). |
| NFR-04 | Privacy | Data minimization, retention policies per data class, data subject requests (export and delete) within 30 days. |
| NFR-05 | Multi-tenancy | Row-level isolation enforced in the application and the database. Cross-tenant access tests in CI. |
| NFR-06 | Internationalization | Spanish and English across all surfaces. Locale-aware money, dates, and time zones. Portuguese pending (open question). |
| NFR-07 | Accessibility | Guest guide meets WCAG 2.2 AA. |
| NFR-08 | Observability | Structured logs, traces, and error tracking. Per-message agent trace with cost. |
| NFR-09 | Scalability | Year-1 design target: 5,000 properties and 50,000 guest conversations per month without re-architecture. |
| NFR-10 | AI cost | Track AI cost per reply and per stay. Alert when the 7-day average exceeds budget (initial budget: $0.10 per reply). |
| NFR-11 | Quality | The agent eval suite passes at or above the agreed thresholds before any prompt or model change ships (Principle V). |
| NFR-12 | Mobile delivery | The guest guide and the host portal are mobile-first PWAs. All host workflows (onboarding, guide editing, inbox, approvals) are fully usable on a phone. Escalations notify by web push and email. iPhone hosts are prompted during onboarding to install the PWA so web push works (ADR-0006). |
| NFR-13 | Account security | Passkeys offered at sign-up. MFA is required for Guidesk staff and for owners and admins of workspaces with more than 2 properties. Step-up re-authentication before revealing or exporting restricted values, changing integrations, or changing members and roles. New-device alerts and revocable sessions (SEC-05). |
| NFR-14 | Abuse and AI-cost protection | Rate limits per guest session, property, and workspace; a message length cap; and a daily AI budget per property. When a limit is hit, the guest gets a holding reply and the host is notified (SEC-07). |
| NFR-15 | Backup and recovery | Point-in-time recovery with RPO ≤ 15 minutes and RTO ≤ 4 hours. Encrypted backups. Quarterly restore test (SEC-17). |
| NFR-16 | Web hardening | HSTS, nonce-based CSP, clickjacking protection, and separate origins for the portal, the guide, user content, and the API. Guide links use unguessable tokens that never stay in the URL and never leak in the `Referer` header (SEC-01, SEC-02, SEC-11). |
| NFR-17 | Supply chain | Committed lockfile, dependency install scripts blocked except an allowlist, a minimum release age for new versions, secret scanning, static analysis, and CI actions pinned by SHA (SEC-12). |
| NFR-18 | Audit trail | An append-only log of security events. Owners can see who revealed each property's restricted values and when (SEC-16). |
| NFR-19 | Backend latency | API p95 ≤ 300 ms excluding LLM calls. Escalation alerts sent within 60 s at p95. |

## 8. Success metrics

Pilot targets are hypotheses, set for the first 90 days with design partners.

| Metric | Definition | Pilot target |
|---|---|---|
| Activation | Share of sign-ups that publish a guide and deliver the link to at least one guest within 7 days | ≥ 50% |
| Time to guide | Median time from sign-up to published guide | ≤ 30 min |
| Automated resolution rate (North Star input) | Guest questions answered without host intervention ÷ all guest questions | ≥ 60% |
| Answer accuracy | Share of sampled agent answers rated correct (host review and evals) | ≥ 95% |
| Escalation precision | Share of escalations the host agrees were necessary | ≥ 80% |
| Attach rate | Stays with at least one service click or request ÷ stays with guide opened | ≥ 15% clicks, ≥ 5% requests |
| Host retention | Pilot hosts still active at day 60 | ≥ 70% |
| AI cost per stay | Total inference cost ÷ stays served | Measure, then set a target |
| Policy incidents | Listing warnings or suspensions attributed to Guidesk | 0 |

## 9. Assumptions and dependencies

- Hosts can deliver the guide link through OTA scheduled messages after booking confirmation.
- PMS partner programs (Hospitable, Hostaway, Guesty, Smoobu) approve Guidesk on a timeline
  compatible with Phase 2.
- Affiliate programs (Viator, Civitatis) accept Guidesk as an affiliate.
- A legal entity and a Tilopay merchant account, with split settlement confirmed, are in place
  by week 10 of the MVP, so F13 can ship in month 4.
- LLM provider and design per [ADR-0005](../architecture/adr/0005-llm-provider-and-agent-design.md).

## 10. Open questions

Tracked in [open-questions.md](../open-questions.md).
