# Tasks: Property Photos and Initials Avatars

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/api.md](contracts/api.md)

## Phase 1: Foundational

- [X] T001 Add `cover_media_id`, `cover_alt` (≤ 160) to `property` and `media_id` to `extra` (FK `media_object` `ON DELETE SET NULL`) in packages/db/src/schema/properties.ts and extras.ts; generate migration 0038
- [X] T002 Contracts: `PropertySummary.cover`, property detail `cover`, `setCoverSchema`, `extraInputSchema.mediaId`, `MemberExtra.media`, `GuestGuide.cover`, `GuestExtra.image` in packages/contracts/src/{properties,extras,guest}.ts
- [X] T003 Count covers and extras photos as in use in the media cleanup in apps/worker/src/jobs/retention.ts

## Phase 2: User Story 1 - Cover photo (P1)

- [X] T004 [P] [US1] API integration test: set, replace, remove a cover; reject other-workspace, video, and processing media; the cover appears in the list and detail; the guest guide carries it and the guest media route serves it; cleanup keeps it, in apps/api/test/integration/property-photos.test.ts
- [X] T005 [US1] `PUT …/properties/:id/cover` and cover views (signed URLs) in apps/api/src/properties/
- [X] T006 [US1] Guest guide `cover` and guest media route allowance in apps/api/src/guest/
- [X] T007 [US1] Portal cover area on the property page (upload, description, remove) in apps/portal/components/properties/
- [X] T008 [US1] Card thumbnails or branded placeholder in the property list; photo on the QR poster
- [X] T009 [US1] Guide home cover (16:9, srcset, fixed size) and `og:image` from the cover in apps/guide/src/
- [X] T010 [US1] Portal CSP media origin (`MEDIA_ORIGIN`) in apps/portal/proxy.ts and infra/web.ts

## Phase 3: User Story 2 - Extras photos (P2)

- [X] T011 [US2] API: `mediaId` on create and update with validation; `media` in member views; copies keep it; guest `image`, in apps/api/src/extras/ and apps/api/src/guest/extras.service.ts
- [X] T012 [US2] Portal extra form photo field and list thumbnails in apps/portal/components/extras/
- [X] T013 [US2] Guest extras list and detail images in apps/guide/src/pages/extras-pages.tsx

## Phase 4: User Story 3 - Photo prompts (P3)

- [X] T014 [US3] Section photo suggestions for arrival, parking, Wi-Fi, appliances, and checkout in apps/portal/components/guide/section-editor.tsx and the catalogs

## Phase 5: User Story 4 - Avatars (P3)

- [X] T015 [P] [US4] Unit test for initials in apps/portal/test/avatar.test.ts
- [X] T016 [US4] `Avatar` component; member list, sidebar account entry, and takeover notes

## Phase 6: Polish

- [X] T017 Guide and portal unit tests for the cover, extras images, and preview tags
- [X] T018 E2E `photos` spec (cover upload through the real pipeline → property page, list, guest guide and its preview tag; prompts; avatars; axe). Extras photos are covered by the API integration test and a manual check on the demo workspace.
- [X] T019 Docs: brand audit status, presentation status; run unit, lint, typecheck, format, integration, e2e, and the bundle check

## Implementation notes (2026-11-19)

- Migration 0038 also grants `UPDATE (media_id) ON extra` to `guidesk_app`: the role has
  column-level update rights on `extra`, so without it every update that set the photo failed as
  a 404.
- Local development: the guest guide's media origin now defaults to the portal origin (local media
  is signed there), and signed local media responses allow cross-origin embedding like S3
  presigned URLs; every other API response stays `same-origin`.
- Bundle: client components that import the icon set carry the whole icon table (the build does
  not drop unused icons of one module). The section editor draws its camera icon in CSS and
  Requests no longer imports the extras component (`formatPrice` moved to `lib/extras`); every
  route is within 150 KB (highest 149.9 KB). New `@guidesk/ui` subpath exports exist for later
  splitting.
- The first-name welcome stays out: on 2026-11-20 the founder decided to keep guest names off the
  guide (spec 004 FR-028).
