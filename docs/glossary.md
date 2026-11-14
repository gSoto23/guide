# Glossary

> **Status:** Living document · **Last updated:** 2026-11-13

| Term | Definition |
|---|---|
| **Add-on** | A service the host offers to guests, such as early check-in, late checkout, airport transfer, extra cleaning, or equipment rental. The host sets the price; Guidesk may charge a platform fee. |
| **ADR** | Architecture Decision Record. A short document capturing one significant decision with its context and consequences. See `docs/architecture/adr/`. |
| **Affiliate** | A partner program (e.g. Viator, Civitatis) that pays Guidesk a commission for bookings made through tracked links. |
| **Agent** | The Guidesk AI concierge that answers guests, decides whether to reply, draft, or escalate, and suggests services. |
| **Agent run** | One execution of the agent pipeline for one inbound message: classification, decision, generation, checks, and trace. |
| **Attach rate** | The share of stays where the guest clicks, requests, or buys at least one service. |
| **Autonomy level** | A per-topic setting chosen by the host: `draft` (host approves), `auto` (agent replies on safe topics), `full_auto` (agent replies unless escalation is mandatory). |
| **Channel** | Where a guest conversation happens: `guide_chat`, `airbnb`, `booking`, `vrbo`, or `direct`. |
| **Channel manager** | Software that syncs listings, rates, availability, and bookings across OTAs. Guidesk is not a channel manager. |
| **ChannelPort** | Guidesk's internal interface for receiving and sending guest messages. Each provider implements it in an adapter. |
| **Constitution** | The non-negotiable project principles used by Spec Kit (`.specify/memory/constitution.md`). |
| **Copilot** | The mode in which the agent drafts a reply for the host to send. In the MVP this includes paste-to-reply for OTA chats without integration. |
| **Core Web Vitals** | Google's user-experience metrics for web pages: LCP (loading), INP (responsiveness), and CLS (visual stability). Guidesk's budgets are in the performance architecture. |
| **Denial of wallet** | An attack that floods a paid service, such as the AI chat, to run up its costs. Countered by rate limits and budgets (SEC-07). |
| **Design partner** | An early customer who uses the pilot and gives structured feedback. |
| **Disclosure** | A UI notice that the host or Guidesk receives a commission or benefit from a recommended service. Required by policy. |
| **Escalation** | Handing a conversation to a human (the host or their team). Some categories always escalate. |
| **Eval** | An automated test of agent behavior against golden conversations and grading rubrics. |
| **Guide** | The Guidesk digital guidebook for one property, served as a mobile web app (PWA). |
| **Guide chat** | The chat with the agent inside the guide. The only guest channel fully owned by Guidesk. |
| **iCal** | A calendar export feed provided by OTAs. Guidesk uses it in the MVP to learn stay dates. |
| **Knowledge base** | Everything Guidesk knows about a property: guide sections, facts, documents, catalog. |
| **Member** | A user's membership in a workspace, with a role (`owner`, `admin`, `agent`). One user can be a member of several workspaces. |
| **MoR** | Merchant of record. The legal entity that sells to the customer and handles payments. |
| **OTA** | Online travel agency or rental platform: Airbnb, Booking.com, Vrbo. |
| **Passkey** | A phishing-resistant sign-in credential stored on the user's device, replacing or complementing passwords. |
| **Payment facilitator** | A provider model in which sub-merchants are onboarded under the provider's own merchant account. Tilopay's split settlement works for merchants under this model. |
| **PC-xx** | A platform-compliance constraint derived from OTA policies. See `docs/research/platform-policies.md`. |
| **PMS** | Property management system, e.g. Hostaway, Guesty, Hospitable, Smoobu. Professional managers run their operations and OTA messaging through it. |
| **Policy engine** | Deterministic Guidesk code that decides what the agent may do (reply, draft, escalate) and checks every outgoing message. |
| **Prompt caching** | A Claude API feature that reuses an unchanged prompt prefix (e.g. property knowledge) across requests at a lower cost. |
| **PWA** | Progressive web app. A website that installs like an app and can work offline. |
| **RAG** | Retrieval-augmented generation. Fetching relevant chunks of knowledge into the prompt. Not used in the MVP (full-context caching). At scale Guidesk moves to a hybrid: core facts stay in the prompt and long-tail knowledge is retrieved with pgvector (ADR-0005). |
| **RLS** | Row-level security. PostgreSQL policies that restrict rows per tenant. |
| **RPO / RTO** | Recovery point objective (maximum data loss, in time) and recovery time objective (maximum downtime) after an incident. |
| **SEC-xx** | A security control defined in the security architecture and referenced by specs. |
| **Sensitive field** | Property data such as door codes, Wi-Fi password, or alarm codes. Shown only to verified guests during their stay window. |
| **Shared section** | Guide content defined once per workspace (e.g. policies, emergency contacts, checkout steps) that properties inherit and can override. |
| **Spec Kit** | GitHub's open-source toolkit for Spec-Driven Development (the `specify` CLI and `/speckit.*` commands). |
| **SSRF** | Server-side request forgery: tricking a server into fetching an internal or unintended URL. |
| **Stay** | Guidesk's canonical reservation: a property, dates, and minimal guest data. Sourced from iCal, a PMS, or manual entry. |
| **Stay window** | The period, around check-in through checkout, when sensitive information is available to a verified guest. |
| **Step-up authentication** | Asking a signed-in user to authenticate again before a sensitive action. |
| **STRIDE** | A threat-modeling checklist: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege. |
| **Take rate** | Guidesk's revenue from a transaction divided by the transaction's gross value. |
| **Tenant / Workspace** | A customer account (a host or a management company) that owns properties, members, and data. |
| **White-label connectivity** | A third-party certified OTA connection (e.g. Channex) that Guidesk can use under its own brand. |
