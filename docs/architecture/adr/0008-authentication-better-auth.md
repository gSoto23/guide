# 0008. Authentication with Better Auth, tenancy in the domain

- **Status:** Accepted
- **Date:** 2026-11-14
- **Deciders:** Founder (proposed by the architect in the plan for spec 001; accepted by the founder on 2026-11-14)
- **Related:** [Spec 001](../../../specs/001-workspace-accounts/spec.md) · [Plan 001 research](../../../specs/001-workspace-accounts/research.md) · [ADR-0004](0004-typescript-monorepo-stack.md) · [Security SEC-05, SEC-11, SEC-14](../security.md#4-controls) · OQ-21

## Context and problem statement

Spec 001 requires:

- passwordless sign-in (Google, passkeys, or email one-time codes);
- authenticator-app codes with backup codes;
- re-authentication within 10 minutes for sensitive actions;
- new-device alerts and revocable sessions;
- users who belong to several workspaces with a role in each;
- member removal that takes effect within 1 minute.

ADR-0004 left the choice between Better Auth and Clerk to this plan (OQ-21).

## Decision drivers

- Every sign-in requirement of spec 001, without passwords.
- Tenant isolation through PostgreSQL RLS (SEC-14), which needs memberships in our database.
- Removal and revocation within 1 minute (FR-025).
- Fewer subprocessors holding personal data (SEC-19, SEC-20).
- Cost that does not grow per user or per workspace.
- A solo developer must be able to maintain it.

## Considered options

1. **Better Auth** (open-source library, self-hosted in our API and database).
2. **Clerk** (hosted identity service).
3. **Auth.js** (open-source library).

## Decision outcome

Chosen option: **Better Auth, self-hosted, with tenancy kept in the Guidesk domain.**

- **Plugins:** email one-time codes, Google, passkeys (user verification required), and two-factor
  (authenticator apps and backup codes). Passwords are disabled.
- **Mounting:** in the NestJS API on Fastify, through the library's framework-agnostic request
  handler at `/api/auth/*`, not the beta NestJS-Fastify wrapper. The portal proxies `/api/*`, so
  cookies stay host-only on the portal origin.
- **Tenancy:** workspaces, memberships, and invitations are Guidesk tables. The library's
  organization plugin is not used.
- **Custom pieces:**
  - the step-up guard, because the library's `freshAge` measures time since sign-in, not since the
    last re-verification;
  - the MFA threshold;
  - device detection;
  - security events.
- **Port:** Better Auth sits behind `AuthProviderPort`, so it can be replaced.

### Consequences

- **Good:**
  - Identities, sessions, and memberships live in one PostgreSQL under RLS. Removal is
    immediate.
  - No per-user or per-organization fees.
  - One fewer subprocessor holding host personal data.
- **Bad:**
  - Guidesk owns more security-critical code: the step-up guard, tenancy, and rate-limit
    configuration.
  - Library upgrades need care: pin versions, read release notes, and run the auth test suite on
    every bump.
  - Better Auth's NestJS-Fastify wrapper is beta, so we mount the generic handler ourselves.

### Confirmation

- The spec 001 test suite passes: RLS cross-tenant tests, abuse cases AC-SEC-001 to AC-SEC-009,
  and the end-to-end passkey and one-time-code flows.
- The external penetration test (SEC-19) covers authentication before the public launch.
- Revisit if a library vulnerability goes unpatched, or if enterprise single sign-on becomes a
  requirement that the library cannot meet.

## Pros and cons of the options

| Option | Pros | Cons |
|---|---|---|
| Better Auth | Data in our database; RLS-native memberships; passkeys, OTP, and 2FA plugins; no per-user cost | We own more security code; Fastify wrapper is beta |
| Clerk | Hosted and polished; less code; organizations and reverification built in | Identities outside our database, reaching RLS only through webhook sync (eventual); MFA and passkeys on Pro (about $25/month); organizations beyond 100 per app cost extra (third-party sources, to verify); another subprocessor |
| Auth.js | Popular, open source | Weaker built-in passkey, OTP, and 2FA support; more custom code |

Sources: [Better Auth plugins](https://better-auth.com/docs/plugins) ·
[Better Auth session management](https://better-auth.com/docs/concepts/session-management) ·
[Better Auth NestJS integration](https://better-auth.com/docs/1.6/integrations/nestjs) ·
[Clerk pricing explained](https://clerk.com/articles/clerk-pricing-explained)
