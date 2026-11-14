# Architecture Decision Records

We record significant architecture and product-technical decisions as ADRs, using the
[MADR](https://adr.github.io/madr/) format. See
[ADR-0001](0001-record-architecture-decisions.md).

| ADR | Title | Status | Date |
|---|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted | 2026-11-13 |
| [0002](0002-spec-driven-development-with-spec-kit.md) | Spec-Driven Development with GitHub Spec Kit | Accepted | 2026-11-13 |
| [0003](0003-phased-channel-integration-strategy.md) | Phased channel integration strategy | Accepted | 2026-11-13 |
| [0004](0004-typescript-monorepo-stack.md) | TypeScript monorepo technology stack | Accepted | 2026-11-13 |
| [0005](0005-llm-provider-and-agent-design.md) | LLM provider and agent design | Accepted | 2026-11-13 |
| [0006](0006-web-first-pwa-no-native-apps.md) | Web-first delivery: PWAs instead of native apps | Accepted | 2026-11-13 |
| [0007](0007-tilopay-initial-payment-provider.md) | Tilopay as the initial payment provider | Accepted | 2026-11-14 |
| [0008](0008-authentication-better-auth.md) | Authentication with Better Auth, tenancy in the domain | Accepted | 2026-11-14 |
| [0009](0009-mvp-hosting-and-transactional-email.md) | AWS hosting and transactional email for the MVP | Accepted | 2026-11-14 |

**Statuses:**

- `Proposed`: written, waiting for founder approval.
- `Accepted`: approved.
- `Superseded by ADR-XXXX`: replaced by a later decision.
- `Deprecated`: no longer applies.

## Template

Copy this into `NNNN-short-title.md`:

```markdown
# NNNN. Title

- **Status:** Proposed
- **Date:** YYYY-MM-DD
- **Deciders:** Founder
- **Related:** links to specs, research, other ADRs

## Context and problem statement

## Decision drivers

## Considered options

## Decision outcome

Chosen option: "...", because ...

### Consequences

- Good: ...
- Bad: ...

### Confirmation

How we will verify the decision is implemented and still holds.

## Pros and cons of the options
```
