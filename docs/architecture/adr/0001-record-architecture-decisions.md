# 0001. Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder

## Context and problem statement

Guidesk is built by one developer working with AI coding agents. Decisions made in chat or in
someone's head get lost, and AI agents cannot follow decisions they cannot read. We need a
lightweight, durable record of why the system is shaped the way it is.

## Decision outcome

We record every significant decision as an Architecture Decision Record (ADR) in
`docs/architecture/adr/`, using the MADR template in [README.md](README.md).

A decision is significant when it:

- adds or replaces a language, framework, datastore, cloud vendor, or external provider;
- changes integration strategy, tenancy, security, or data-retention posture;
- would be expensive to reverse; or
- deviates from the [constitution](../../../.specify/memory/constitution.md).

ADRs are immutable once accepted. To change a decision, write a new ADR that supersedes the old
one.

### Consequences

- **Good:**
  - Decisions stay traceable.
  - Spec Kit plans can cite ADRs in their Constitution Check.
  - New contributors and AI agents get context fast.
- **Bad:** a small writing overhead per decision.

### Confirmation

- Every `plan.md` lists the ADRs it relies on.
- A pull request that introduces a new vendor or runtime without an ADR fails review.
