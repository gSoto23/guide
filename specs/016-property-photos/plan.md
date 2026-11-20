# Implementation Plan: Property Photos and Initials Avatars

**Branch**: `016-property-photos` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

## Summary

Reuse the guide media pipeline (spec 003: presigned upload, sandbox processing to WebP `large` and
`small`, scanning, storage limit, signed URLs) for two new references: `property.cover_media_id`
and `extra.media_id`. The API validates and exposes them (signed URLs for members, stable guest media
paths for guests), the media cleanup counts them as in use, and the guest media route allows them.
The portal adds a cover area, card thumbnails, poster photo, an extra photo field, section photo
prompts, and initials avatars; the guest guide shows the cover and extras photos and uses the cover
as the link-preview image.

## Technical Context

**Language/Version**: TypeScript on Node.js 24; React 19 (Next.js 16 portal, server-rendered guide)

**Primary Dependencies**: Existing only (NestJS, Drizzle, sharp in the sandbox)

**Storage**: PostgreSQL: two nullable columns plus an alt-text column (migration 0038); media objects unchanged

**Testing**: vitest (units), vitest + Testcontainers (API integration), Playwright + axe (e2e), bundle check

**Target Platform**: Mobile and desktop browsers; AWS (ECS, S3, CloudFront) and local mode

**Performance Goals**: Guide LCP ≤ 2.5 s, CLS ≤ 0.1, ≤ 500 KB initial weight; portal ≤ 150 KB JavaScript per route

**Constraints**: Media stays private (signed URLs, guest paths gated by the guide); CSP nonces; no third-party images

## Constitution Check

| Principle | Check | Status |
|---|---|---|
| I. Spec-First | Spec with clarifications; no open markers | [x] |
| II. Platform Compliance | No change to platform messaging; photos are the host's own content | [x] |
| III. Guest Trust | Guest names stay off the guide (spec 004 FR-028 kept) | [x] |
| IV. Channel-Agnostic Core | No new external system | [x] |
| V. Test-First | Integration tests for cover and extra photo rules, guest route, cleanup; unit and e2e tests | [x] |
| VI. Security and Privacy | Same-workspace ready images only; guest route allows only current references; RLS unchanged (columns on RLS tables); no third-party avatars | [x] |
| VII. Simplicity | No new service or dependency; one migration | [x] |
| VIII. Observability | Existing media job logs | [x] |
| IX. International | ES/EN texts | [x] |
| Performance | Budgets below | [x] |

## Performance Budget

| Surface | Metric | Budget | Verified by |
|---|---|---|---|
| Guide home with a cover | LCP / CLS / initial weight | ≤ 2.5 s / ≤ 0.1 / ≤ 500 KB (small variant ≈ 30–60 KB) | Lighthouse CI, fixed width/height |
| Portal routes | JavaScript per route | ≤ 150 KB gzip | Bundle check |

## Project Structure

```text
packages/db/src/schema/{properties,extras}.ts   # cover_media_id, cover_alt, media_id
packages/db/migrations/0038_*.sql
packages/contracts/src/{properties,extras,guest}.ts
apps/api/src/properties/   # PUT cover, cover in summaries and detail
apps/api/src/extras/       # mediaId on create/update, media in member views
apps/api/src/guest/        # cover and extra images for guests, route allowance
apps/worker/src/jobs/retention.ts   # usage includes covers and extras
apps/portal/components/properties/  # cover area, card thumbnails
apps/portal/components/share/poster.tsx
apps/portal/components/extras/      # photo field and thumbnails
apps/portal/components/guide/section-editor.tsx  # photo prompts
apps/portal/components/avatar.tsx   # initials
apps/portal/proxy.ts + infra/web.ts # media origin in img-src
apps/guide/src/pages/{guide-pages,extras-pages}.tsx, components/layout.tsx
```

## Complexity Tracking

No violations.
