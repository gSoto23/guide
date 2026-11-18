# 0010. Guest guide rendered on the server without a client framework

- **Status:** Accepted (proposed in the plan for spec 004, under the founder's standing authorization
  of 2026-11-17).
- **Date:** 2026-11-17
- **Deciders:** Architect (plan for spec 004)
- **Related:** [ADR-0004](0004-typescript-monorepo-stack.md) · [ADR-0009](0009-mvp-hosting-and-transactional-email.md) ·
  [Spec 004 research R2, R3, R9](../../../specs/004-guest-guide/research.md) · [Performance §1, §2](../performance.md)

## Context and problem statement

The architecture overview planned the guest guide as a Next.js app (`apps/guide`). The performance
budget allows at most 100 KB of gzip JavaScript per guest route, because guests open the guide on
mid-range phones over mobile data (NFR-01, NFR-07). In this repository the Next.js App Router
runtime alone, before any guide code, is about 117 KB gzip (measured on 2026-11-17 from the
portal's production build: React DOM and the router runtime). A Next.js guide would break the
budget on every page.

## Decision drivers

- The 100 KB guest JavaScript cap, and an LCP of 2.5 s on 4G.
- CDN-first delivery that keeps working when the API is down (performance doc §2).
- One component language and no new runtime or vendor (constitution VII).
- A strict Content Security Policy that works with HTML cached by the CDN (SEC-11).

## Considered options

- **Next.js App Router** (the overview's first choice).
- **Preact, Astro, or Hono JSX** with small client runtimes.
- **Server-only React** (`react-dom/server`, no hydration) with a small vanilla browser script.
- **Guest pages rendered inside the API service.**

## Decision outcome

Chosen option: **server-only React**. `apps/guide` renders HTML with React on the server and
never hydrates it. Interactive parts (Show code, the confirmation form, language memory, the open
count, the offline banner) live in one small TypeScript script bundled by esbuild (2.7 KB gzip at
the end of spec 004), plus a plain service worker. The app is a web-standard `Request → Response`
handler run by a Node HTTP server locally and by an AWS Lambda function behind its own CloudFront
distribution (`GuideRouter`), which also routes `/api/v1/guest/*` to the API so guest cookies stay
host-only on the guide origin.

### Consequences

- Good: the first visit is about 6 KB gzip of script, styles, and HTML; pages read without
  scripts; no inline script or style, so `script-src 'self'` works with cached HTML.
- Good: no new framework to learn; the portal's document renderer (`@guidesk/ui`) is reused.
- Bad: no client-side routing or React state in the guest app; interactive features are written
  against the DOM. Spec 005's chat must load on demand and stay within the budget.
- Bad: one more deploy unit (a Lambda function and a CloudFront distribution).

### Confirmation

The guest app's size check (`pnpm --filter @guidesk/guide size:check`) and Lighthouse CI on guest
pages run in the performance job; a regression fails CI.

## Pros and cons of the options

- **Next.js App Router:** familiar and already in the portal, but over budget before any feature.
- **Preact, Astro, or Hono JSX:** small runtimes, but new tools to maintain for one developer.
- **Server-only React:** smallest result with the stack we have; DOM scripting for the few
  interactive parts.
- **Rendering inside the API:** no new deploy unit, but couples guest traffic to API capacity and
  mixes guest and host surfaces in one process.
