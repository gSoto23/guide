# Data Model: Property Photos and Initials Avatars

| Table | Column | Type | Rule |
|---|---|---|---|
| `property` | `cover_media_id` | uuid, null | FK `media_object(id)` `ON DELETE SET NULL`; image of the same workspace |
| `property` | `cover_alt` | text, null | ≤ 160 characters |
| `extra` | `media_id` | uuid, null | FK `media_object(id)` `ON DELETE SET NULL`; image of the same workspace |

Both tables already have RLS by workspace. The media cleanup's usage set adds both references.

## Contract changes

- `PropertySummary.cover` and the property detail `cover`: `{ url, smallUrl, alt } | null` (signed,
  15 minutes; only when the media is ready).
- `PUT /v1/workspaces/:ws/properties/:id/cover` body `{ mediaId: uuid | null, alt?: string }`.
- `extraInputSchema.mediaId?: uuid | null`; `MemberExtra.media: { url, smallUrl } | null`.
- `GuestGuide.cover: { url, smallUrl, width, height, alt } | null`.
- `GuestExtra.image: { url, smallUrl, width, height } | null`.
- `MeResponse` and members already carry names and emails for initials; no change.
