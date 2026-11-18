# Security Architecture

> **Status:** Draft v0.1 · **Owner:** Founder · **Last updated:** 2026-11-14 ·
> **Related:** [Constitution, Principle VI](../../.specify/memory/constitution.md) · [PRD §7 NFRs](../product/prd.md#7-non-functional-requirements) · [Architecture overview](overview.md) · [Performance](performance.md) · [ADR-0005](adr/0005-llm-provider-and-agent-design.md) · [Platform policies](../research/platform-policies.md)

Guidesk holds the keys to other people's homes. The worst incident is not a data leak; it is
someone entering a home with a code they obtained through Guidesk. Security priorities, in
order:

1. Property access codes and other restricted data.
2. Host accounts, because one compromised manager account exposes every property it manages.
3. Tenant isolation.
4. Guest and host personal data.
5. Abuse of the AI agent, including attacks that burn the AI budget.

This document defines data classes, the threat model, and the controls (`SEC-xx`) that specs
reference. Each spec that touches a sensitive area lists the controls it implements
(constitution, Principle VI).

## 1. Data classification

| Class | Examples | Storage and handling | Logging | Retention (initial proposal) |
|---|---|---|---|---|
| **Restricted** | Door, alarm, and lockbox codes; Wi-Fi passwords; PMS tokens and API keys; auth secrets; stay link tokens and confirmation codes (spec 004) | Field-level envelope encryption with keys outside the database (SEC-06). Never sent to the LLM or embedded; a detector masks codes typed into AI inputs (spec 003 research R5). Revealed only through gated flows. A host may make one property's Wi-Fi password public, so anyone with the guide link sees it (spec 003 FR-021, 2026-11-17 clarification); it is then stored readable and is Internal for that property. | Never logged, in any form | Until the host deletes it or disconnects the integration |
| **Confidential** | Guest names, stay dates, messages; host account data; agent traces | Encrypted at rest; RLS per workspace; minimum PII sent to the LLM | Personal data scrubbed from logs, traces, and error reports | Messages and traces anonymized or deleted 12 months after checkout, to be confirmed by the legal review (OQ-35) |
| **Internal** | Non-sensitive property facts, configuration, analytics aggregates | Encrypted at rest; RLS | Allowed | While the account is active |
| **Public** | Published, non-sensitive guide sections | Served from the CDN behind an unguessable link; not indexed | Allowed | Until unpublished |

## 2. Trust boundaries

| Boundary | Who is on the other side | Trust |
|---|---|---|
| Guest browser → guide app and API | Anonymous guests, anyone who has the link or QR, bots | Untrusted |
| Host browser → portal and API | Authenticated members | Authenticated, but accounts can be stolen |
| Worker → host-supplied URLs (iCal) and PMS APIs | External servers | Untrusted responses |
| Uploads → extraction pipeline | Files from hosts | Untrusted content |
| API and worker → Claude API | A subprocessor | Trusted vendor; send the minimum data |
| Back-office → production data | Guidesk staff | Privileged, audited |

## 3. Threat model (STRIDE)

| Area | Threat | STRIDE | Controls |
|---|---|---|---|
| Guest guide | A former guest, cleaner, or anyone who photographed the QR keeps using the link | Spoofing | SEC-01, SEC-03 |
| Guest guide | The link token leaks through the `Referer` header to affiliate sites, analytics, or logs | Information disclosure | SEC-02 |
| Guest guide | A door code is cached by the CDN or the offline service worker | Information disclosure | SEC-04 |
| Guest guide | Brute force of a verification code or PIN | Spoofing | SEC-03 |
| Host portal | Account takeover through phishing or credential stuffing | Spoofing | SEC-05, SEC-16 |
| Host portal | A member raises their own role or exports codes | Elevation of privilege | SEC-05, SEC-14, SEC-16 |
| Agent | Prompt injection from guest messages or uploaded documents | Tampering, information disclosure | SEC-08, ADR-0005 security rules |
| Agent | Bots flood the chat to burn the AI budget ("denial of wallet") | Denial of service | SEC-07 |
| Agent | Model output injects scripts or unsafe links into the chat UI | Tampering | SEC-08, SEC-11 |
| Imports | A host-supplied iCal URL points at internal services (SSRF) | Elevation of privilege | SEC-09 |
| Imports | Malicious or oversized files | Tampering, denial of service | SEC-10 |
| Integrations | Forged or replayed PMS webhooks | Spoofing, tampering | SEC-13 |
| Integrations | Theft of stored PMS credentials | Information disclosure | SEC-06, SEC-13 |
| Payments | Forged payment webhooks, unauthorized refunds, card testing through the checkout | Spoofing, tampering | SEC-05, SEC-21 |
| Data layer | Cross-tenant data access through a query or RLS bug | Information disclosure | SEC-14 |
| Data layer | Insider or support misuse | Elevation of privilege, repudiation | SEC-15, SEC-16 |
| Data layer | Data loss or ransomware | Denial of service | SEC-17 |
| Supply chain | A compromised npm package or CI action | Tampering | SEC-12 |
| Operations | A dispute about who saw a door code and when | Repudiation | SEC-16 |

## 4. Controls

| ID | Control | Phase |
|---|---|---|
| SEC-01 | **Two link types.** The per-property link and QR show only public sections. Sensitive sections need a per-stay link: a random token of at least 128 bits that expires at checkout plus a short buffer, can be revoked, and is never reused across stays. *Implemented in spec 004: 130-bit property links; 256-bit stay tokens stored as a SHA-256 hash and as vault ciphertext (so the host can copy the same link again); the stay window runs from 00:00 on the check-in day to 2 hours after checkout and is computed per request; at most 10 devices per stay link.* | MVP |
| SEC-02 | **Token hygiene.** On first visit, exchange the URL token for an `HttpOnly`, `Secure`, `SameSite=Lax` cookie scoped to the guide origin, then redirect to a clean URL. Send `Referrer-Policy: no-referrer` and `X-Robots-Tag: noindex`. Use no sequential or guessable identifiers. *Implemented in spec 004: the exchange page never looks the token up; its script posts it and replaces the history entry, so link previews create no session; the cookie is `__Host-guidesk_guest` (only its hash is stored); the guide's own CloudFront distribution routes `/api/v1/guest/*` to the API so the cookie stays host-only.* | MVP |
| SEC-03 | **Verification brute-force protection.** Rate-limit verification attempts per IP, session, and stay. Lock out for 15 minutes after 5 failures, with exponential backoff, and alert the host. Codes have at least 6 characters. Compare in constant time. *Implemented in spec 004 (OQ-20): the stay link verifies the guest; owners and admins may also require a Guidesk-generated 6-character code per stay (31 symbols without look-alikes), entered once per device; failures count per session, per hashed address, and on the stay row; lockouts double up to 24 hours and email owners and admins.* | MVP |
| SEC-04 | **No caching of restricted data.** Sensitive responses send `Cache-Control: no-store`. The service worker never stores them. *Decided in spec 004 (OQ-28): no offline saving of codes in the MVP; the stay message for the booking thread carries them instead. Guest pages never contain session state, so caching them at the CDN is safe.* | MVP |
| SEC-05 | **Host account protection.** Passkeys offered at sign-up. MFA (passkey or TOTP) is required for Guidesk staff and for owners and admins of workspaces with more than 2 properties, and prompted for everyone else. Step-up re-authentication (within the last 10 minutes) before revealing or exporting restricted values, connecting or changing integrations, inviting members, or changing roles. Alerts on new-device sign-in; sessions are listed and revocable, and are revoked when the account email or a second factor changes (sign-in is passwordless). | MVP |
| SEC-06 | **Field-level encryption.** Restricted values use envelope encryption: data keys per workspace, wrapped by a master key in a cloud KMS outside the database. The database and its backups hold only ciphertext. Only the reveal service (the API's single decrypt path for locked fields, spec 003 research R4), the stay link secrets service (stay tokens and confirmation codes, never locked-field values, spec 004 research R4), and the integration services decrypt. Keys rotate yearly. Logging uses an allowlist, so restricted values never reach logs, traces, or error reports. | MVP |
| SEC-07 | **Denial-of-wallet protection.** Rate limits per guest session (initially 20 messages per 10 minutes), per property per day, and per workspace by plan. Messages are capped at 2,000 characters. Each property has a daily AI budget. When a limit is hit, the guest gets a holding reply and the host is notified. An invisible bot challenge appears only when abuse signals do. | MVP |
| SEC-08 | **Agent tool safety.** The server injects `workspace_id`, `property_id`, and `stay_id` from the session; the model never supplies them. Tool inputs are validated against strict schemas. Only `create_service_request` and `escalate_to_host` write. Model output is rendered as sanitized Markdown, with no raw HTML, and links are allowlisted. The OWASP Top 10 for LLM Applications is reviewed in every agent spec. Retrieved and uploaded text is framed as data, never as instructions. | MVP |
| SEC-09 | **SSRF protection for outbound fetches.** Host-supplied URLs (iCal) are fetched only by an isolated fetcher with no route to internal services: the `feed-reader` sandbox function, a Lambda outside the VPC (feature 002 research R2). It fetches over HTTPS only, resolves DNS and blocks private, loopback, link-local, and cloud-metadata ranges, checking again on every redirect (at most 3), and limits responses to 2 MB and 10 seconds. The API and the worker never fetch these URLs themselves. | MVP |
| SEC-10 | **Safe file uploads.** Allowlisted types, verified by content and not only by extension. Size limits and malware scanning. Parsing runs in an isolated worker. Image metadata (EXIF, including GPS) is stripped. Files are served from a separate user-content domain with `Content-Disposition` and short-lived signed URLs. Extracted text is untrusted input to the agent. | MVP |
| SEC-11 | **Web hardening and origin isolation.** HTTPS everywhere with HSTS. Nonce-based CSP without `unsafe-inline`. `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, and a restrictive `Permissions-Policy`. Separate origins for the portal, the guide, user content, and the API. Host-only cookies. CSRF protection on every state-changing endpoint that uses cookies. | MVP |
| SEC-12 | **Supply chain.** pnpm lockfile committed. Dependency install scripts are blocked except for an allowlist. Newly published versions wait a minimum release age (initially 3 days) before install. Renovate groups updates. Vulnerability scanning (OSV or `pnpm audit`), GitHub secret scanning with push protection, and CodeQL run in CI. GitHub Actions are pinned by commit SHA, CI tokens have least privilege, and each release has an SBOM. | Foundations |
| SEC-13 | **Integration security.** PMS credentials are restricted data (SEC-06) with the minimum scopes. Webhooks are verified by signature with a 5-minute timestamp tolerance, plus idempotency keys. Tokens are refreshed and rotated. Disconnecting revokes the credential and deletes it. | MVP (imports), Phase 2 (webhooks) |
| SEC-14 | **Tenant isolation.** RLS on every tenant-owned table. The API sets the workspace in each transaction. A migration check fails CI if a new tenant table lacks RLS. Cross-tenant tests run in CI (NFR-05). | MVP |
| SEC-15 | **Internal access.** The back-office requires MFA and least privilege. Support access to a workspace requires the host's consent, is time-boxed, and is audited. No standing production database access; a break-glass procedure is logged. | Before public launch |
| SEC-16 | **Audit log.** An append-only table (the application role cannot update or delete) records sign-ins, MFA changes, invitations, role changes, integration connections, restricted-value reveals by guests and hosts, exports, and support access. Owners see the reveal history of their properties. | MVP |
| SEC-17 | **Backups and recovery.** Managed PostgreSQL with point-in-time recovery. RPO ≤ 15 minutes, RTO ≤ 4 hours. Backups are encrypted. A restore test runs every quarter. | MVP |
| SEC-18 | **Incident response.** A runbook covers detection, containment, eradication, recovery, and notification, with severity levels and breach-notification deadlines per law (for example, 72 hours under GDPR; others from the legal review). A host-notification template recommends rotating access codes. A `security.txt` file and a disclosure policy are published. | Before public launch |
| SEC-19 | **Assurance.** OWASP ASVS Level 2 (NFR-03) checklist per spec. External penetration test before public launch. SOC 2-ready practices: policies, quarterly access reviews, and a subprocessor register with data-processing agreements (Anthropic, hosting, email, embeddings). Amazon Transcribe (voice notes, spec 003) runs under the AWS hosting agreement, with the AI-services opt-out policy in place before production. A formal audit when Business-plan customers or PMS partners require it. | Before public launch |
| SEC-20 | **Privacy by default.** Data minimization; no contact data requested from Airbnb guests (PC-03). Retention schedule per data class (§1). Export and deletion requests completed within 30 days (NFR-04). Send the LLM only the guest data a reply needs, and review the provider's retention options. | MVP |
| SEC-21 | **Payments.** Only the provider's hosted checkout collects card data (Tilopay's hosted payment page or payment links; never its server-to-server mode, which needs PCI certification), so Guidesk stays in the smallest PCI DSS scope (SAQ A). An order is confirmed only after server-side verification of the provider's webhook, never from the browser redirect alone, and orders move through an idempotent state machine. The provider handles host payout onboarding (identity and bank checks). Refunds need the host's step-up re-authentication and are audited (SEC-16). The provider's fraud tools and checkout rate limits counter card testing. | MVP, month 4 |

**Phases:**

- **Foundations:** in place when the repository and CI are created.
- **MVP:** in place before the first pilot guest uses Guidesk.
- **Before public launch:** in place before Guidesk opens to the public.

## 5. Security in the workflow

- **Specs.** Every spec that touches authentication, restricted data, agent tools,
  integrations, file uploads, or payments includes a **Security considerations** section. It
  lists the threats (STRIDE), the controls applied (`SEC-xx`), and abuse cases written as
  acceptance criteria.
- **Plans.** The Constitution Check verifies that section.
- **CI gates:**
  - lint, type-check, and tests;
  - the RLS migration check;
  - dependency and secret scanning, and CodeQL;
  - agent evals, including prompt-injection and sensitive-data cases.
- **Release checklist:** security headers verified, and ASVS items for the feature checked.

## 6. Open decisions

- **OQ-20:** the guest verification method (spec 004).
- **OQ-21:** the auth provider. It must support passkeys, TOTP, step-up re-authentication, and
  session revocation.
- **OQ-22:** the KMS vendor, which follows the hosting choice.
- **OQ-28:** offline access to arrival steps, which include restricted values (spec 004).
- **OQ-35:** retention periods and breach-notification duties (legal review).
