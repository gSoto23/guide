# 0002. Spec-Driven Development with GitHub Spec Kit

- **Status:** Accepted
- **Date:** 2026-11-13
- **Deciders:** Founder
- **Related:** [Constitution](../../../.specify/memory/constitution.md) · [ADR-0001](0001-record-architecture-decisions.md)

## Context and problem statement

The founder develops alone with heavy use of AI coding agents (Claude Code). Without precise
specifications, agent output drifts, review is hard, and decisions are not traceable. The
founder prefers Spec-Driven Development (SDD) and wants a standard, well-documented workflow.

## Decision drivers

- Agents need unambiguous, testable requirements.
- A standard, open workflow that works with Claude Code.
- A clear separation of *what/why* (spec) from *how* (plan).
- Low ceremony for a one-person team.

## Considered options

1. **GitHub Spec Kit:** constitution → specify → clarify → plan → tasks → analyze → implement.
2. **Kiro-style:** `requirements.md` (EARS notation) + `design.md` + `tasks.md` per feature.
3. **OpenSpec:** living specs plus change proposals.
4. **Custom hybrid.**

## Decision outcome

Chosen option: **GitHub Spec Kit**, selected by the founder on 2026-11-13. It is an open
standard with a CLI (`specify`) and agent commands for Claude Code. Its constitution mechanism
enforces project-wide principles at plan time.

**Conventions:**

- The constitution lives at `.specify/memory/constitution.md` and is versioned with semantic
  versioning.
- One folder per feature: `specs/NNN-feature-name/`, containing `spec.md`, `plan.md`,
  `tasks.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`, and `checklists/`.
- Git branches match spec folders (`NNN-feature-name`).
- Specs reference PRD feature IDs (`Fxx`) and policy constraints (PC-xx).
- Acceptance criteria use Given/When/Then scenarios. Functional requirements use
  `FR-###: System MUST …`.
- Product-level documents (PRD, roadmap, research) live in `docs/` and feed `/speckit.specify`.

**Workflow per feature:**

1. `/speckit.specify`: write the spec from the PRD feature.
2. `/speckit.clarify`: resolve ambiguities.
3. `/speckit.plan`: write the plan against the constitution and the ADRs.
4. `/speckit.tasks`: break the plan into tasks.
5. `/speckit.analyze`: check consistency across spec, plan, and tasks.
6. `/speckit.implement`: build it.
7. Open a pull request.

### Consequences

- **Good:**
  - Agent-ready specs.
  - Consistent structure across features.
  - The Constitution Check catches principle violations early.
- **Bad:**
  - Some ceremony for small changes. Chores and hotfixes are exempt (constitution, Principle I).
  - Dependence on Spec Kit's evolving conventions. Pin the CLI version used in the repo.

### Confirmation

- `specify init --here --ai claude` has been run.
- Every merged feature has a complete `specs/NNN-*` folder.
- CI checks that pull requests touching `apps/` or `packages/` reference a spec (or carry a
  `chore`/`hotfix` label).
