<!--
Sync Impact Report
- Version change: 1.1.0 → 1.1.1 (PATCH: wording and template sync)
- Changes: Spec Kit 1.4.1.dev0 installed for Claude Code. Commands are now skills named
  `/speckit-<step>` (hyphen). Guidesk template overrides added in
  .specify/templates/overrides/ (spec: Security Considerations and Platform Policies; plan:
  Constitution Check table and Performance Budget). The 1.1.0 template TODO is resolved.

Previous: 1.0.0 → 1.1.0 (MINOR: material expansion of a principle and two sections)
- Modified principles:
  - VI. Security and Privacy by Default: adds required Security considerations in specs,
    field-level encryption for restricted data, and account-takeover protection.
- Modified sections:
  - Additional Constraints → Performance: budgets defined in docs/architecture/performance.md,
    declared per plan, and enforced in CI. Clarifies 3G (usability floor) vs 4G (measured
    targets).
  - Development Workflow → Plan: the Constitution Check covers security considerations and
    performance budgets.
- Added references: docs/architecture/security.md (SEC-xx controls),
  docs/architecture/performance.md.
- Templates requiring updates: done in 1.1.1 (see above).
- Follow-up TODOs: revisit Principle VI once the legal entity and payment provider are chosen.

Previous: (none) → 1.0.0, ratified 2026-11-13 during Phase 0 (Discovery & Planning).
-->

# Guidesk Constitution

Guidesk is a digital property guidebook and AI guest agent for short-term rental hosts and
property managers. It answers guests on the rental platforms' chats and inside the Guidesk
guide, and sells optional services. This constitution defines the non-negotiable rules for
how Guidesk is specified, built, and operated. It supersedes any conflicting practice.

## Core Principles

### I. Spec-First Development

- Every feature MUST start as a specification in `specs/NNN-<feature>/spec.md` created with
  the Spec Kit workflow (`/speckit-specify` → `/speckit-clarify` → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-analyze` → `/speckit-implement`).
- Specs describe **what** and **why** (user value, acceptance criteria, edge cases). Plans
  describe **how**. No implementation detail belongs in a spec.
- Code without a merged spec, plan, and task list MUST NOT be merged, except for chores
  (dependency bumps, typo fixes, tooling) and hotfixes that are back-filled within 48 hours.
- Ambiguity is resolved in the spec (marked `[NEEDS CLARIFICATION]` until answered), never
  guessed in code.

**Rationale:** Guidesk is built by one developer working with AI coding agents. Precise specs
are the only reliable way to get correct, reviewable output from agents.

### II. Platform Compliance by Design

- Guidesk MUST integrate with rental platforms only through official, authorized channels:
  OTA partner APIs, PMS/channel-manager partner APIs, or white-label providers with certified
  connections. Scraping, browser automation, credential sharing, and email-reply workarounds
  are prohibited.
- Platform policies are product requirements. Each applicable rule MUST be captured as a
  testable constraint (see `docs/research/platform-policies.md`, IDs `PC-xx`) and covered by
  automated tests where feasible.
- Using the guide MUST be optional for the guest. Access to the property MUST NOT depend on
  any purchase, registration, or third-party app.
- Any financial benefit the host or Guidesk receives from a recommended service MUST be
  disclosed to the guest.

**Rationale:** One policy violation can get a host's listing suspended. Host trust is the
whole business.

### III. Guest Trust and Human-in-the-Loop AI

- The agent MUST answer only from the property's knowledge base and approved service
  catalog. When it does not know, it MUST say so and route the question to the host. It MUST
  NOT invent facts, prices, availability, or policies.
- Agent autonomy is configured by the host per topic: `draft` (host approves), `auto` (safe
  topics), or `full_auto`. The default for a new workspace is `draft`.
- Emergencies, safety issues, complaints, damage, refunds, and legal or payment disputes MUST
  always escalate to a human, regardless of autonomy settings.
- Guest messages are untrusted input. Prompt-injection defenses MUST protect sensitive data
  (door codes, other guests' data, host data) and operator instructions.
- Every message the agent sends or drafts MUST be logged with the knowledge, tools, and policy
  checks that produced it, so it can be audited and explained to the host.

**Rationale:** A wrong door code or an invented promise costs a host a review. Earning
autonomy gradually is how hosts learn to trust the agent.

### IV. Channel-Agnostic Core, Adapter-Based Integrations

- The domain core (properties, knowledge, conversations, agent, commerce) MUST NOT depend on
  any specific OTA, PMS, payment, tour, or insurance provider.
- Every external system is accessed through a port (interface) with one adapter per provider
  (Ports & Adapters). Adding a PMS MUST NOT require changes to the agent or conversation
  logic.
- Each adapter MUST ship with contract tests against recorded fixtures and a documented
  mapping of the provider's data to Guidesk's canonical model.

**Rationale:** The integration landscape will change: new PMS partners, possibly direct OTA
access later. Adapters keep that change contained.

### V. Test-First and Eval-Driven Quality

- Domain logic is developed test-first: write a failing test, implement, refactor.
- Required test layers: unit tests (domain), contract tests (adapters), integration tests
  (API + database), and end-to-end tests for the critical flows defined in each spec.
- Changes to prompts, agent tools, models, or model settings MUST pass the agent evaluation
  suite (golden conversations covering accuracy, escalation, policy compliance, language, and
  injection resistance) before merge. Eval regressions block the merge.
- CI MUST run lint, type-check, tests, and evals on every pull request.

**Rationale:** Agent behavior is probabilistic. Evals are the only objective way to know
whether a change made it better or worse.

### VI. Security and Privacy by Default

- Strict multi-tenant isolation: every tenant-owned row carries a `workspace_id`, and access
  is enforced in the application layer and by database row-level security.
- Integration credentials and tokens MUST be encrypted at rest and never logged. Apply least
  privilege to every credential and service account.
- Collect the minimum guest data needed; define retention per data class; support data export
  and deletion requests (GDPR, CCPA, and applicable LATAM data-protection laws).
- Sensitive property data (access codes, Wi-Fi, alarm codes) MUST NOT be publicly reachable.
  It is only revealed to verified guests within their stay window.
- Restricted data (access codes, integration credentials) MUST use field-level encryption with
  keys held outside the database. It MUST NOT reach logs, LLM prompts, or embeddings.
- Account takeover is treated as the top threat: one manager account can expose many homes.
  Multi-factor authentication and step-up re-authentication protect sensitive actions.
- Every spec that touches authentication, restricted data, agent tools, integrations, file
  uploads, or payments MUST include a **Security considerations** section. It lists the threats
  (STRIDE), the controls applied (`SEC-xx` in `docs/architecture/security.md`), and abuse cases
  written as acceptance criteria.
- No secrets in the repository. Dependencies are scanned in CI.

**Rationale:** Guidesk holds the keys to other people's homes, literally and digitally.

### VII. Simplicity and Solo Maintainability

- Prefer managed services, boring technology, and a single language (TypeScript) across the
  stack. Every new runtime, datastore, or vendor needs an ADR.
- YAGNI: build what the current phase of the roadmap needs. Any complexity beyond the simplest
  viable design MUST be justified in the plan's Complexity Tracking section.
- Architecture decisions are recorded as ADRs in `docs/architecture/adr/`.

**Rationale:** The bottleneck is one person's time and attention.

### VIII. Observability and Accountability

- Structured logs, traces (OpenTelemetry), and error tracking are required for every service
  and background job.
- Every agent decision (classification, autonomy decision, tool calls, escalation, model and
  cost) MUST be traceable from the host's inbox to the underlying logs.
- Business metrics (automated reply rate, escalation rate, time saved, attach rate, revenue
  per stay) are first-class and defined in the PRD.

### IX. International from Day One

- All guest-facing and host-facing text is localized. Spanish and English are required from
  the first release; the agent replies in the guest's language.
- Money, dates, time zones, and units MUST be handled per locale and per property time zone.
  No hard-coded currency or locale.

## Additional Constraints

- **Documentation language:** English for all repository documentation, specs, ADRs, code,
  and commit messages.
- **Technology baseline:** defined in ADR-0004 and ADR-0005. Changes need a superseding ADR.
- **Accessibility:** guest-facing surfaces MUST meet WCAG 2.2 AA.
- **Performance:** the guest guide MUST stay usable on mid-range mobile devices over slow 3G.
  Budgets are defined in `docs/architecture/performance.md` (defaults at p75 on 4G: LCP ≤ 2.5 s,
  INP ≤ 200 ms, CLS ≤ 0.1). Every plan with UI or a hot path declares its budget, and CI
  enforces it.

## Development Workflow

1. **Specify:** create or update the feature spec. Resolve every `[NEEDS CLARIFICATION]`.
2. **Plan:** produce `plan.md` (architecture, data model, contracts) and pass the
   Constitution Check gate, including the security considerations and the performance budget.
3. **Tasks:** generate `tasks.md`; tests are listed before implementation tasks.
4. **Implement:** small pull requests on short-lived branches (`NNN-feature-name`), using
   Conventional Commits.
5. **Review:** every pull request is reviewed, by an AI reviewer at minimum, against the spec,
   this constitution, and the checklists. CI must be green.
6. **Release:** trunk-based on `main`, with feature flags for incomplete work and automated
   deploys to staging. Production deploys follow the release checklist.

## Governance

- This constitution overrides other practices. Every plan includes a Constitution Check, and
  violations must be fixed or explicitly justified in Complexity Tracking.
- Amendments are made through a pull request that updates this file, the Sync Impact Report,
  and any affected templates or docs, with a version bump:
  - **MAJOR:** a principle is removed or redefined in an incompatible way.
  - **MINOR:** a principle or section is added or materially expanded.
  - **PATCH:** clarifications and wording fixes.
- Compliance is reviewed at the end of each roadmap phase.

**Version**: 1.1.1 | **Ratified**: 2026-11-13 | **Last Amended**: 2026-11-14
