# Data Model: Launch Pages and Demo Workspace

## Schema change

### `workspace.demo` (migration `0037_workspace_demo.sql`)

| Column | Type | Rule |
|---|---|---|
| `demo` | `boolean NOT NULL DEFAULT false` | True only for workspaces created by the demo command. Never set or read by the API's HTTP surface or the portal. |

- Existing rows get `false`. No index: the pilot report filters a small table.
- RLS is unchanged: the column lives on an existing tenant table.
- The Drizzle schema (`packages/db/src/schema/tenancy.ts`) adds `demo: boolean("demo").notNull().default(false)`.

### Security event type

| Type | Actor | Target | Metadata (allowlist) |
|---|---|---|---|
| `workspace.demo_seeded` | The owner account the founder named | `workspace` / demo workspace ID | `properties` (number), `stays` (number) |

## Settings

| Setting (deploy time) | Where it ends up | Required | Rule |
|---|---|---|---|
| `GUIDESK_CONTACT_EMAIL` | Portal function `CONTACT_EMAIL` | Production only | A valid email; shown as text on the home footer and in the legal pages |
| `GUIDESK_COMPANY_NAME` | Portal function `COMPANY_NAME` | No | 1–120 characters; "Guidesk" when unset |
| (from the router) | Portal function `PORTAL_URL`, guide function `PORTAL_URL` | Always set by infra | The portal's public origin (custom domain or CloudFront URL) |
| `$app.stage` | API and worker containers `STAGE` | Always set by infra | `dev`, `staging`, or `production`; the demo command refuses `production` |

Locally: `CONTACT_EMAIL`, `COMPANY_NAME`, and `PORTAL_URL` may be set in `.env`. `PORTAL_URL` defaults to
`http://localhost:3000` in the guide app. `STAGE` stays unset.

## Public catalogs (`packages/i18n/messages/public.{es,en}.json`)

Plain JSON. Values are strings, or arrays of strings or objects. Placeholders are `{company}`, `{email}`,
and `{date}` only. Both files have the same structure, keys, and array lengths (checked by test).

```text
meta.home.title / meta.home.description / meta.privacy.* / meta.terms.*
nav.signIn / nav.language / nav.home
home.tagline, home.hero.title, home.hero.lead, home.hero.cta
home.audience: [{ title, text }]                       # hosts, managers
home.steps: [{ title, text }]                          # exactly 3
home.features: [{ id, title, text }]                   # guide, chat, copilot, extras-explore, analytics
home.plans.title, .lead, .pilot, .tba, .perMonth, .fees, .feeRow, .limits.{properties,replies,seats,unlimited}
home.plans.items: [{ id: free|pro|business, name, audience }]
home.cta.title, .text, .button
footer.privacy, .terms, .contact, .rights
legal.updated ("Última actualización: {date}"), legal.toc
privacy.title, privacy.intro: [string]
privacy.sections: [{ id, title, paragraphs: [string], items?: [string] }]
terms.title, terms.intro: [string]
terms.sections: [{ id, title, paragraphs: [string], items?: [string] }]
```

- Privacy section IDs: `responsible`, `data-hosts`, `data-guests`, `purposes`, `ai`, `providers`,
  `retention`, `cookies`, `rights`, `transfers`, `security`, `children`, `changes`, `contact`.
- Terms section IDs: `service`, `accounts`, `acceptable-use`, `host-content`, `assistant`, `payments`,
  `pilot`, `suspension`, `liability`, `changes`, `law`, `contact`.
- When `CONTACT_EMAIL` is unset, paragraphs or items that contain `{email}` are omitted. This is why
  `{email}` appears only in lines that can drop out without breaking a sentence.
- The last-updated date is a constant in `apps/portal/lib/public/legal.ts` (`LEGAL_UPDATED = "2026-11-19"`),
  formatted per locale.

## Demo dataset (created per run, all in the new workspace)

| Entity | Count | Notes |
|---|---|---|
| `workspace` | 1 | "Demo · Guidesk" (then "Demo · Guidesk 2"…); `demo = true`; plan `pro`; `created_at` = run − 75 days |
| `membership` | 1 | The named account as `owner` |
| `property` | 2 | Casa Brisa (Santa Teresa, Puntarenas, CR; `America/Costa_Rica`; 6 guests; check-in 15:00, checkout 11:00) and Loft Escazú (Escazú, San José, CR; 3 guests; 14:00 / 11:00); `guide_languages` es and en; setup ready; `created_at` = run − 75 days |
| `guide`, `guide_section`, `guide_item`, `guide_item_text` | 1 per property, 9 sections, ~20 items | Created with `createGuideForProperty`, then filled from `content.ts` in es and en; items reviewed |
| `guide_version` | 1 per property | From `buildSnapshot`; guide `published` |
| `restricted_value` | 1 per property | Door code, vault ciphertext under the workspace data key |
| Wi-Fi | 1 per property | `public_value` (allowed only for `wifi_password`) |
| `workspace_data_key` | 1 | Created through the vault inside the transaction |
| `guide_link` | 1 per property | Active property link |
| `stay` | ~10 per property | ~8 past over 60 days (most with `guide_opened_at`), 1 current (check-in yesterday, checkout in 3 days, property time zone), 1 upcoming (in 10 days); manual source; fictional first names only |
| `stay_link` | 2 per property | Current and upcoming stays; token hash plus vault ciphertext; no confirmation code |
| `assistant_settings` | 1 (workspace default) | Autonomy `auto` for `wifi` and `check_in` topics; others default to `draft` |
| `explore_settings` | 1 (workspace default) | Experiences shown |
| `extra` | 3 per property (2 at the loft: no surfboard) | Airport pickup USD 85, extra cleaning USD 35, surfboard rental USD 15 a day |
| `service_request` | ~12 per property | Over the history, pending, confirmed, and declined; tied to stays; `expires_at` set |
| `conversation`, `chat_message`, `agent_trace` | 2–6 questions a day per property | Topic, decision (auto reply, draft, escalation), reason, small cost |
| Open escalation | 1 | Casa Brisa, current stay, `needs_host` with reason malfunction (air conditioning), with an open `agent_draft` |
| Daily counters | 60 days per property | `guide_open_daily`, `explore_open_daily`, `experience_click_daily`, `service_request_daily`, `chat_usage_daily` |
| `security_event` | 1 | `workspace.demo_seeded` |

- Generation is deterministic for a given workspace ID and run date.
- Monthly AI replies stay near 150 for the workspace.
- No `payment_order`, `payout_account`, `calendar_feed`, `pms_connection`, or uploads.
