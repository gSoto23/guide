# Research: Property Photos and Initials Avatars

## R1. Reuse the guide media pipeline
- **Decision**: Upload covers and extra photos through `POST …/guide/media` + `complete`, then set
  the reference with a property or extra call.
- **Rationale**: Scanning, WebP variants, the storage limit, and cleanup already exist; one upload UI.
- **Alternatives**: A new upload purpose (needs a migration of the `upload` checks and a second job).

## R2. References and cleanup
- **Decision**: `property.cover_media_id` and `extra.media_id`, nullable, `ON DELETE SET NULL`; the
  retention job's usage query adds both.
- **Rationale**: Without them the sweep deletes in-use photos after about 48 hours.

## R3. Guest access
- **Decision**: `GuestGuide.cover` and `GuestExtra.image` use the existing guest media path
  `/api/v1/guest/media/{publicId}/{mediaId}/{variant}`; the route also allows the property's current
  cover and its visible extras' photos.
- **Rationale**: Keeps media private and URLs stable for the CDN and the offline cache.

## R4. Link preview
- **Decision**: With a cover, `og:image` is `{GUIDE_URL}/api/v1/guest/media/…/large` (the guide origin
  proxies `/api/*`); the route redirects to a signed URL, which messaging apps follow.

## R5. Portal images in AWS
- **Decision**: The portal CSP adds `MEDIA_ORIGIN` (set by infra to the media bucket origin) to
  `img-src` and `media-src`.
- **Rationale**: Signed S3 URLs are on the bucket host; locally they are same-origin.

## R6. Avatars
- **Decision**: Initials on a tinted circle, computed from the name (first letters of the first two
  words) or the email; no images.
- **Rationale**: No third-party host, no tracking, works for email and passkey accounts.

## R7. First-name welcome
- **Decision**: Deferred; spec 004 FR-028 stands until the founder decides.
