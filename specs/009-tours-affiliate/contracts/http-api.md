# HTTP API: Tours and Experiences

**Feature**: [spec.md](../spec.md) · **Data model**: [data-model.md](../data-model.md)

Conventions as in specs 004 to 007: JSON bodies, problem responses `{ code, title }`, member routes
under `/api/v1/workspaces/{workspaceId}` with RLS, guest routes under `/api/v1/guest` scoped by the
property link.

## Guest routes (guide origin)

### `GET /api/v1/guest/guides/{publicId}` (spec 004, changed)

Adds `explore: { visible: boolean }`: true when the guide has recommendations or the property has at
least one selected experience.

### `GET /api/v1/guest/guides/{publicId}/explore?lang=es|en`

`200`, `Cache-Control: public, max-age=0, s-maxage=60, stale-if-error=3600`:

```json
{
  "city": "Sámara",
  "disclosure": "guidesk",
  "tips": [GuestRecommendation],
  "categories": [
    {
      "category": "water",
      "experiences": [
        {
          "ref": "viator-12345P6",
          "partner": "viator",
          "partnerName": "Viator",
          "title": "Catamaran sunset tour",
          "description": "…",
          "includes": null,
          "durationMinutes": 180,
          "priceFrom": 79,
          "currency": "USD",
          "rating": 4.8,
          "reviewCount": 312,
          "image": { "url": "https://…", "width": 480, "height": 320 },
          "language": "en",
          "machineTranslated": false
        }
      ]
    }
  ]
}
```

`GuestRecommendation` is spec 004's shape (name, category, url, address, benefit, benefitKind).
Experiences hidden by the host never appear. `404 unavailable` as for the guide.

### `GET /api/v1/guest/guides/{publicId}/experiences/{ref}/go?lang=es|en[&c=1]`

Always `302` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`:

- To the stored partner page (with affiliate tracking) when `ref` matches
  `^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$`, is among the property's selected experiences, and its
  URL is HTTPS on an allowlisted partner host.
- Otherwise to `/g/{publicId}/{lang}/explore` (or `/` when the guide is unavailable).

Counts one click when `c=1`, the user agent is not automated, and the network address is within 60
clicks per hour. No other parameter is read.

### `POST /api/v1/guest/opens` (spec 004, changed)

`kind` accepts `explore`: counts one Explore open for the property and day. `204`.

## Member routes

### `GET /explore` (workspace default)

`200 { "version": 3, "experiencesEnabled": true, "hiddenCategories": ["water"] }`. Any member.

### `PUT /explore`

Body `{ version, experiencesEnabled, hiddenCategories }`. `properties.manage` (owners, admins).
`200` with the saved settings; `409 settings_changed` when `version` is stale; `422` for unknown
categories; `403` for agents (logged).

### `GET /properties/{propertyId}/explore`

```json
{
  "version": 0,
  "followsDefault": true,
  "own": { "experiencesEnabled": true, "hiddenCategories": [] },
  "effective": { "experiencesEnabled": true, "hiddenCategories": ["water"] },
  "hiddenExperiences": ["viator-12345P6"],
  "destination": { "city": "Sámara", "available": true },
  "visible": true,
  "tips": [GuestRecommendation],
  "experiences": [{ "...card": "as above", "hidden": false, "categoryHidden": false, "shown": true }]
}
```

`experiences` lists every current experience for the destination in the member's language with flags;
`shown` marks the ones guests see (after hiding and the limit). Any member.

### `PUT /properties/{propertyId}/explore`

Body `{ version, followsDefault, own: { experiencesEnabled, hiddenCategories }, hiddenExperiences }`
(at most 200 refs, each matching the ref pattern). Same rules and errors as the workspace route.
Another workspace's property: `404`, logged (spec 001).
