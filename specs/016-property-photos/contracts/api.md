# Contract: Photos API

## Set or remove a cover

`PUT /api/v1/workspaces/{workspaceId}/properties/{propertyId}/cover` · permission `properties.manage`

| Body | Rule |
|---|---|
| `mediaId` | uuid of a `ready` image media object of this workspace, or `null` to remove |
| `alt` | optional, 1–160 characters; default the property name |

Responses: `200` with `{ cover: { url, smallUrl, alt } | null }`; `422 media_not_ready` (processing),
`422 invalid_media` (other workspace, video, rejected, unknown); `404` for another workspace's
property.

## Extras

`POST` and `PUT …/extras` accept `mediaId` (same rules; `null` removes). Member views include
`media`. Copies keep `media_id`.

## Guest

- `GET /api/v1/guest/guides/{publicId}` adds `cover`.
- `GET /api/v1/guest/guides/{publicId}/extras` adds `image` per extra.
- `GET /api/v1/guest/media/{publicId}/{mediaId}/{variant}` also serves the property's current cover
  and the photos of its visible extras; any other media is `404`.
