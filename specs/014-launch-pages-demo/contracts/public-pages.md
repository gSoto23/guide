# Contract: Public Pages (portal domain)

## Routes

| Path | Page | Indexed | Notes |
|---|---|---|---|
| `/` | Redirects to `/{locale}` | — | Existing locale detection (URL prefix, cookie, `Accept-Language`) |
| `/es`, `/en` | Home | Yes | Server-rendered; no client components |
| `/es/privacy`, `/en/privacy` | Privacy policy | Yes | Shows the last-updated date |
| `/es/terms`, `/en/terms` | Terms of service | Yes | Shows the last-updated date |
| `/robots.txt` | Robots | — | See below |
| `/sitemap.xml` | Sitemap | — | See below |
| Any other portal path | Portal screens | No | Default metadata `robots: noindex, nofollow` |

## Page metadata

Each public page sets:

- `title` and `description` from `public.{locale}.json` → `meta.{page}`;
- `alternates.canonical` = `${PORTAL_URL}/{locale}{path}`, and `alternates.languages` = `{ es: …/es{path}, en: …/en{path} }`;
- `robots: { index: true, follow: true }`;
- `openGraph`: title, description, locale (`es_CR` or `en_US`), type `website`.

## Header and footer

- **Header:**
  - the logo, which links to `/{locale}`;
  - "Entrar" / "Sign in", which links to `/{locale}/sign-in`;
  - the language link to the same page in the other language (`hreflang`, `lang` attributes).
- **Footer:**
  - links to privacy and terms;
  - the contact address as text, only when `CONTACT_EMAIL` is set;
  - "© {year} {company}".

## Call to action

"Empieza gratis" / "Start free" links to `/{locale}/sign-in`, where sign-up and sign-in share one
screen.

## Plans block (values from `@guidesk/domain`)

| Plan | Price line | Limits | Fee on extras |
|---|---|---|---|
| Free | USD 0 | 2 active properties · 100 AI replies a month · 1 seat | 10% |
| Pro | Price to be announced | Unlimited properties · 300 AI replies per active property, pooled · 3 seats | 7% |
| Business | Price to be announced | Unlimited properties · 300 AI replies per active property, pooled · unlimited seats | 5% |

The block also says that the pilot is free.

## `/robots.txt`

```text
User-agent: *
Allow: /es$
Allow: /en$
Allow: /es/privacy
Allow: /en/privacy
Allow: /es/terms
Allow: /en/terms
Disallow: /
Sitemap: ${PORTAL_URL}/sitemap.xml
```

## `/sitemap.xml`

The six public URLs, each with `alternates.languages` for es and en, and `lastModified` set to the legal
date for the legal pages. No other URL.

## Consent line (portal catalog `auth.consent`)

- es: "Al continuar, aceptas los <terms>Términos</terms> y la <privacy>Política de privacidad</privacy>."
- en: "By continuing, you accept the <terms>Terms</terms> and the <privacy>Privacy policy</privacy>."
- Shown on `/{locale}/sign-in` and `/{locale}/invite/{token}` under the primary action.

## Guest guide privacy link (guest catalogs `privacy.link`)

- "Privacidad" / "Privacy", linking to `${PORTAL_URL}/${lang}/privacy` with `target="_blank"` and
  `rel="noopener"`.
- Shown at the end of the guide home and in the chat panel.

## Installed app

`manifest.webmanifest`: `start_url: "/start"`, `scope: "/"`.

## Settings

| Variable | Default | Production |
|---|---|---|
| `CONTACT_EMAIL` | unset (contact lines hidden) | required (deploy fails without `GUIDESK_CONTACT_EMAIL`) |
| `COMPANY_NAME` | "Guidesk" | optional until the legal entity exists (OQ-01) |
| `PORTAL_URL` | `http://localhost:3000` | the portal's public origin (set by infra) |
