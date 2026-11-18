# Data Model: Tours and Experiences (Affiliate)

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

Migrations `0030_explore.sql` (tables) and `0031_explore_rls.sql` (RLS, grants). Curated Civitatis
entries live in `packages/integrations/catalog/experiences.json`, not in the database (research R3).

## Partner catalog (global, not tenant data)

Written only by the worker in the system context. The application role may read them (public partner
content, research R10): RLS is forced with a read-only policy for `guidesk_app` and a system policy.

### experience_destination

| Column | Type | Rules |
|---|---|---|
| key | text PK | `{country}:{city}` normalized, for example `cr:samara` (research R5); ≤ 120 characters |
| country | char(2) | ISO 3166-1 alpha-2, uppercase |
| city | text | as written on the first property that used it, ≤ 120 |
| region | text null | ≤ 120 |
| viator_destination_id | text null | from the mapping or the curated override |
| mapped_at | timestamptz null | when the Viator mapping last ran |

### experience_refresh

| Column | Type | Rules |
|---|---|---|
| destination_key | text FK experience_destination, cascade | PK with partner |
| partner | text | `viator` |
| last_attempt_at | timestamptz | |
| last_success_at | timestamptz null | |
| failures | integer | consecutive failures, ≥ 0 |
| last_error | text null | an error code only (`timeout`, `http_429`, `http_5xx`, `invalid`), never a response body |

### experience

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| partner | text | `viator` |
| product_id | text | partner product code, `^[A-Za-z0-9_-]{1,64}$` |
| destination_key | text FK experience_destination, cascade | |
| language | text | `es` or `en`: the language of the stored text |
| category | text | `tours`, `food_drink`, `outdoor`, `water`, `culture`, `day_trips`, `other` |
| title | text | 1 to 200 characters, plain text |
| description | text | ≤ 2,000 characters, plain text |
| includes | text null | ≤ 1,000 characters |
| duration_minutes | integer null | 1 to 20,160 |
| price_from | numeric(12,2) null | ≥ 0 |
| currency | char(3) null | ISO 4217, set with `price_from` |
| rating | numeric(3,2) null | 0 to 5 |
| review_count | integer null | ≥ 0 |
| image_url | text null | HTTPS, ≤ 2,000 |
| image_width, image_height | integer null | set with `image_url` |
| partner_url | text | HTTPS on an allowlisted partner host, ≤ 2,000 (research R8) |
| machine_translated | boolean | partner flag |
| fetched_at | timestamptz | |
| expires_at | timestamptz | `fetched_at` + the partner's keeping limit (Viator: 60 minutes) |

Unique `(partner, product_id, destination_key, language)`; index `(destination_key, expires_at)`.

### experience_partner_reference

| Column | Type | Rules |
|---|---|---|
| partner | text | PK with kind |
| kind | text | `destinations` or `tags` |
| data | jsonb | the partner's list, trimmed to the fields used for mapping |
| fetched_at | timestamptz | refreshed weekly |

## Tenant data (RLS by workspace)

### explore_settings

| Column | Type | Rules |
|---|---|---|
| id | uuid PK | |
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid null FK property, cascade | null: the workspace default |
| follows_default | boolean | property rows only; default true |
| experiences_enabled | boolean | default true |
| hidden_categories | text[] | values from the category list; no duplicates |
| hidden_experiences | text[] | property rows only; refs `viator-{code}` or `civitatis-{id}`; at most 200 |
| version | integer | ≥ 0, increments on each change |
| updated_by | text null FK user, set null | |
| updated_at | timestamptz | |

Unique `(workspace_id) WHERE property_id IS NULL`; unique `(property_id)`. Owners and admins write
(`properties.manage`); every member reads.

### explore_open_daily

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | PK with day |
| day | date | in the property's time zone |
| opens | integer | ≥ 0 |

### experience_click_daily

| Column | Type | Rules |
|---|---|---|
| workspace_id | uuid FK workspace, cascade | |
| property_id | uuid FK property, cascade | PK with day and ref |
| day | date | in the property's time zone |
| partner | text | `viator` or `civitatis` |
| ref | text | the experience ref |
| clicks | integer | ≥ 0 |

Counts hold no network address, browser details, location, or guest identifier (FR-010). Guest routes
write them in the system context, scoped by the property link (spec 004 research R12); members read
them through RLS.

## Security log events

`explore.settings_changed` (metadata: `scope` `workspace` or `property`, `propertyId`, the changed
fields' names only).

## State and lifetimes

- An experience row is shown while `expires_at > now()`; the refresh job replaces rows for each
  destination, partner, and language, and deletes rows expired for more than a day.
- Curated entries are always current; removing an entry from the file removes it at the next deploy.
- A hidden experience ref stays in `hidden_experiences` after the partner drops it (harmless; capped
  at 200).
