# Partner Outreach Drafts

> **Status:** Drafts for the founder, 2026-11-19 · **Owner:** Founder ·
> **Related:** [Pilot readiness](pilot-readiness.md) · [Open questions](open-questions.md)

Ready-to-send drafts for the written answers the pilot needs from partners, plus the text for the
Amazon SES production access request. Each draft asks exactly what the specs left open, so the answers
can close the matching gate.

How to use them:

1. Fill the placeholders in square brackets (name, company, contact details, dates).
2. Send each one yourself, from your own address or through the partner's form. Nothing here has been
   sent.
3. Record each answer, with its date, in [open questions](open-questions.md) and in the spec research
   file named below, then tick the item in the [pilot readiness checklist](pilot-readiness.md).

| Draft | Language | Where to send it | Open question | What the answer unblocks |
|---|---|---|---|---|
| [1. Tilopay](#1-tilopay) | Spanish | Tilopay's sales contact (tilopay.com) | OQ-37, OQ-09 | The Tilopay adapter and real payments (spec 013, [ADR-0007](architecture/adr/0007-tilopay-initial-payment-provider.md)) |
| [2. Beds24](#2-beds24) | English | Beds24 support (ticket from the control panel) | OQ-26 | `GUIDESK_PMS_BEDS24` ([spec 002 R7, R15](../specs/002-property-onboarding/research.md)) |
| [3. Hostex](#3-hostex) | English | Hostex support | OQ-26 | `GUIDESK_PMS_HOSTEX` ([spec 002 R7, R15](../specs/002-property-onboarding/research.md)) |
| [4. Viator](#4-viator) | English | Viator affiliate support, after joining the Partner Program | OQ-34 | `ViatorApiKey` and live Explore ([spec 009 R1, R2, R13](../specs/009-tours-affiliate/research.md)) |
| [5. Civitatis](#5-civitatis) | Spanish | Civitatis affiliate team, after joining the affiliate program | OQ-34 | `GUIDESK_CIVITATIS_AFFILIATE_ID` and the feed ([spec 009 R3, R13](../specs/009-tours-affiliate/research.md)) |
| [6. Amazon SES](#6-amazon-ses-production-access) | English | AWS console: SES, Account dashboard, "Request production access" | none | Email to any address ([ADR-0009](architecture/adr/0009-mvp-hosting-and-transactional-email.md)) |

Facts the drafts rely on, so you can check them before sending:

- The pilot: 10 to 20 hosts and 3 to 5 managers (OQ-03), starting [pilot start date] (OQ-02).
- The legal entity is still open (OQ-01); the drafts leave `[Company name]` for it.
- Add-on prices: the business model assumes an average order of about USD 35.
- Payable currencies in spec 013: US dollars and colones.

---

## 1. Tilopay

**Asunto:** Consulta comercial: plataforma para anfitriones de alquiler vacacional con liquidación
dividida (split)

Hola, equipo de Tilopay:

Soy [Nombre], fundador de Guidesk ([Company name], Costa Rica). Guidesk es una plataforma web para
anfitriones de alquileres vacacionales: cada propiedad tiene una guía digital para sus huéspedes, con
un asistente que responde preguntas. Desde esa guía el huésped puede pedir extras opcionales que ofrece
el anfitrión, como un traslado al aeropuerto, una limpieza adicional o el alquiler de equipo.

Queremos que el huésped pague esos extras con la página de pago alojada de Tilopay (`processPayment`) o
con links de pago, para que los datos de tarjeta nunca pasen por nuestros sistemas. Cada anfitrión
recibiría su parte por medio de la liquidación dividida (`/api/v1/orders/liquidation/split`), y Guidesk
solo su comisión de plataforma. Guidesk no recibiría ni retendría el dinero de los anfitriones.

Empezamos con un piloto de 10 a 20 anfitriones y 3 a 5 administradores de propiedades a partir de
[fecha], con un volumen bajo al inicio (ticket promedio estimado de USD 35, en dólares y colones).

Antes de integrar, quisiéramos confirmar por escrito:

1. **Liquidación dividida.** ¿Podemos usar el split para pagar a cada anfitrión su parte y a Guidesk su
   comisión en cada orden? Entendemos que aplica a comercios que usan a Tilopay como facilitador de
   pagos. ¿Cómo sería el esquema para nosotros (Guidesk como plataforma y cada anfitrión como comercio
   afiliado)? ¿Necesitamos algún registro, licencia o contrato adicional?
2. **Afiliación de anfitriones.** ¿Qué requisitos y documentos piden a personas físicas y a empresas?
   ¿El anfitrión puede completarla en línea? ¿Cuánto tarda la aprobación? ¿Podemos iniciarla desde
   nuestra plataforma (un enlace o una API) y consultar su estado?
3. **Cobertura.** ¿Pueden afiliarse anfitriones con cuentas bancarias fuera de Costa Rica (resto de
   Centroamérica, el Caribe, México, Estados Unidos, Sudamérica)? ¿En qué países sí y en cuáles no?
4. **Tarjetas internacionales.** ¿Aceptan tarjetas emitidas en Estados Unidos, Europa y Latinoamérica?
   ¿Usan 3-D Secure? ¿Cobramos en USD y en CRC sin conversión?
5. **Reembolsos por API.** ¿Se pueden hacer reembolsos totales y parciales por API? En una orden con
   split, ¿de qué parte sale el reembolso: del anfitrión, de Guidesk o de ambas en proporción? ¿Se
   devuelve la comisión de procesamiento al reembolsar? ¿En qué plazo ve el dinero el huésped?
6. **Contracargos.** ¿Cómo es el proceso, quién responde ante el emisor, cómo se nos notifica y qué
   costo tiene?
7. **Notificaciones (webhook).** Para pagos con tarjeta por la página alojada o por links de pago, ¿qué
   esquema de firma o cifrado usa la notificación? ¿Dónde está documentado? ¿Hay reintentos? ¿Podemos
   consultar el estado de una orden por API para verificarla del lado del servidor?
8. **Comisiones.** Entendemos que la tarifa es 4.2% más USD 0.30 por transacción. ¿Aplica igual a
   tarjetas internacionales? ¿Cuál es el monto fijo en colones? En una orden con split, ¿el cargo fijo
   se cobra una vez o por cada comercio que recibe parte? ¿Hay mensualidad, costo de afiliación por
   anfitrión, costo por reembolso o por contracargo? ¿Se puede descontar la comisión de procesamiento
   solo de la parte del anfitrión?
9. **Liquidación.** ¿En qué plazo y en qué moneda se deposita a cada anfitrión y a Guidesk?
10. **Factura electrónica.** ¿Ofrecen o integran factura electrónica (Hacienda) para los comercios
    afiliados?
11. **Sandbox.** ¿Podemos usar el sandbox, incluido el split, antes de completar la afiliación de la
    empresa?
12. **Contrato.** ¿Qué documentos necesita la empresa para firmar y cuánto tarda?

¿Podríamos agendar una llamada de 30 minutos para revisarlo? Mi teléfono es [teléfono].

Muchas gracias,
[Nombre]
[Cargo], Guidesk
[correo] · [teléfono]

---

## 2. Beds24

**Subject:** Permission question: read-only import with a customer's own invite code (API V2)

Hello Beds24 team,

I'm [Name], founder of Guidesk ([Company name]). Guidesk gives short-term rental hosts a digital guest
guide and an assistant that answers guest questions. Some of our pilot hosts use Beds24, and we would
like them to import their properties and bookings into Guidesk instead of typing them again.

How it would work, entirely read-only:

- The host creates an invite code in Beds24 (Settings, Marketplace, API) with the scopes
  `read:properties`, `read:bookings`, and `read:bookings-personal`.
- Guidesk exchanges it once at `/authentication/setup` and stores only the refresh token, encrypted.
  Access tokens are kept in memory only.
- We read properties with their texts (`GET /properties?includeTexts=all`) and bookings
  (`GET /bookings`): dates, guest count, guest name, booking ID, and channel. We never write to Beds24.
- We discard guest emails, phone numbers, notes, and custom fields as soon as we receive them; they are
  never stored or logged.
- Refreshes use `modifiedFrom`, plus one daily full pass, and we never let the account's five-minute
  credits drop below 30, so the host's other tools keep working.
- When the host disconnects, we call `DELETE /authentication/token` and delete our copy.

Could you confirm in writing:

1. May a third-party service use a customer's own invite code this way, commercially, without joining
   the Beds24 Marketplace or a partner program? If a partnership is required, what are the steps and
   the fees?
2. We need `read:bookings-personal` only for the guest's name. Is there a narrower scope that gives the
   name without contact details?
3. Is the usage above acceptable for rate limits, given that credits are shared with the host's other
   tools? Is there a limit per application as well as per account?
4. Is there a test account or sandbox where we can record sample responses for our automated tests?
5. May we name Beds24 in our product and website (for example "Import from Beds24")?

Thank you,
[Name]
[Title], Guidesk
[email]

---

## 3. Hostex

**Subject:** Permission question: read-only import with a customer's own access token (Open API v3)

Hello Hostex team,

I'm [Name], founder of Guidesk ([Company name]). Guidesk gives short-term rental hosts a digital guest
guide and an assistant that answers guest questions. Some of our pilot hosts use Hostex, and we would
like them to import their properties and reservations into Guidesk.

How it would work, entirely read-only:

- The host creates an access token with the read-only scope in Hostex (OpenAPI settings, Pro edition)
  and pastes it into Guidesk, where it is stored encrypted.
- We call `GET /accounts/me` to check it, then read properties and reservations: dates, guest count,
  guest name, reservation code, stay code, and channel. We never write to Hostex.
- We discard phone numbers, emails, `guests[]`, remarks, custom fields, and `check_in_details` as soon
  as we receive them; they are never stored or logged.
- Each refresh reads reservations with checkout from today to 365 days ahead, because there is no
  "updated since" filter. Pages hold up to 100 items.
- When the host disconnects, we delete our copy and ask the host to delete the token in Hostex.

Could you confirm in writing:

1. May a third-party service use a customer's own read-only token this way, commercially, without a
   partner agreement? If an agreement is required, what are the steps and the fees?
2. Is there, or will there be, a way to revoke a token through the API, so a disconnect can revoke it
   for the host?
3. How often may we refresh reservations this way? Are webhooks available for read-only tokens?
4. Is there a test account where we can record sample responses for our automated tests?
5. The API doesn't seem to return a property's time zone, check-in and checkout times, maximum guests,
   description, house rules, or amenities. Is there an endpoint we missed, or are they planned?
6. May we name Hostex in our product and website (for example "Import from Hostex")?

Thank you,
[Name]
[Title], Guidesk
[email]

---

## 4. Viator

Joining is self-service: sign up for the Viator Partner Program, then copy the API key from the partner
dashboard (Tools, Affiliate API) into the `ViatorApiKey` secret. Send this to affiliate support after
joining.

**Subject:** Basic-access API: confirming our display and caching approach (partner ID [PID])

Hello Viator Partner team,

I'm [Name], founder of Guidesk (partner ID [PID]). Guidesk gives short-term rental hosts a digital
guest guide. We would like to show guests a short list of Viator experiences near the property, using
the Partner API v2 with basic access.

How it would work:

- A background job calls `POST /products/search` for each destination where we have an active guide,
  once per language (Spanish and English), with 30 products, every 30 minutes. Each result is kept for
  at most 60 minutes and then discarded. Guests never wait on the API.
- Each card shows the title, thumbnail, short description, average rating, review count, and price.
  "Book" opens the product's `productUrl` on viator.com, with its affiliate parameters. We don't book
  through the API.
- The guide says that Guidesk may earn a commission on bookings.

Could you confirm:

1. Is this background search (per destination and language, every 30 minutes, kept at most 60
   minutes) consistent with the basic-access terms and with the rule not to use search to ingest the
   catalog? If not, what pattern do you recommend?
2. Which `Accept-Language` values return Spanish content (for example `es`, `es-ES`, or `es-MX`)?
3. What rate limits apply to basic access?
4. Which hosts serve product images, so we can allow them in our content security policy?
5. With basic access, can we sort search results by rating, and do results include the duration?
6. Is there required wording, attribution, or a logo for the commission disclosure?
7. Can we add a campaign value to the links, one per property, to see which guides lead to bookings?

Thank you,
[Name]
[Title], Guidesk
[email]

---

## 5. Civitatis

First join the Civitatis affiliate program; the affiliate number goes in
`GUIDESK_CIVITATIS_AFFILIATE_ID`. Then send this to the affiliate team.

**Asunto:** Afiliado [número de afiliado]: acceso al feed o API y condiciones de contenido

Hola, equipo de afiliados de Civitatis:

Soy [Nombre], fundador de Guidesk ([Company name], Costa Rica). Guidesk es una plataforma para
anfitriones de alquileres vacacionales: cada propiedad tiene una guía digital para sus huéspedes. En
esa guía queremos recomendar actividades de Civitatis cerca de la propiedad, con enlaces de afiliado
(`?aid=[número de afiliado]`). El huésped reserva en civitatis.com.

Mientras no tengamos el feed, mostramos una lista corta elegida a mano por destino, con títulos y
descripciones breves escritas por nosotros, sin copiar textos ni fotos de Civitatis. La guía indica que
Guidesk puede recibir una comisión por las reservas.

Quisiéramos pedirles:

1. **Feed o API de productos.** ¿Podemos tener acceso? ¿En qué formato, para qué destinos y con qué
   condiciones? Nos interesan primero Costa Rica y [otros destinos del piloto]. Entendemos que piden
   actualizarlo al menos una vez al mes y mostrar el contenido sin modificar.
2. **Lista curada.** Mientras tanto, ¿podemos mostrar la lista con títulos y descripciones propias,
   enlazando a la ficha con nuestro `aid`? ¿Podemos usar el nombre y el logo de Civitatis?
3. **Fotos.** Con el feed, ¿podemos mostrar las fotos de los productos? ¿Desde qué dominios se sirven?
4. **Atribución y pagos.** ¿Cuánto dura la atribución después del clic? ¿Qué comisión aplica? ¿Cuál es
   el mínimo de pago, el método y la moneda? ¿Podemos añadir un subidentificador por propiedad?
5. **Aviso de comisión.** ¿Hay un texto o formato que debamos usar?

Muchas gracias,
[Nombre]
[Cargo], Guidesk
[correo]

---

## 6. Amazon SES production access

New SES accounts start in the sandbox and can only send to verified addresses. Request production
access in `us-east-1` once the sending domain is verified (deploying with `GUIDESK_EMAIL_SENDER` set
creates the identity, its DKIM records, and a DMARC record).

Before submitting:

- Check in SES (Suppression list) that the account-level suppression list is on for bounces and
  complaints; the answer below says it is.
- Have a public page at the website URL that describes Guidesk; reviewers look at it.
- Submit a few weeks before the pilot, because AWS may ask follow-up questions.

Form fields:

- **Mail type:** Transactional
- **Website URL:** [https://guidesk domain]
- **Additional contacts:** [optional]
- **Preferred contact language:** English

**Use case description:**

> Guidesk is a web application for short-term rental hosts and property managers in Costa Rica and
> Latin America. Hosts create a digital guide for each property, and an assistant answers their guests'
> questions.
>
> We send only transactional email, and only to people who created a Guidesk account or were invited
> by an account owner. The messages are: one-time sign-in codes; team invitations; security notices
> (for example a new sign-in or a new passkey); alerts when a guest conversation needs the host's
> attention; notices about guest requests for add-ons; and notices when a workspace reaches 80% and
> 100% of its monthly plan limits. We never send marketing email or newsletters, we never use purchased
> or rented lists, and we never email guests.
>
> Recipients sign up with their own address, which the first sign-in code (or Google sign-in) confirms.
> Invitations go only to addresses an account owner enters; they expire after 7 days, and resending is
> rate-limited.
>
> We start with a pilot of about 25 accounts in [month and year]. We expect fewer than 500 emails a
> day during the pilot.
>
> The sending domain is verified with DKIM and publishes a DMARC policy (p=quarantine). The
> account-level suppression list is on for bounces and complaints, so we never send again to an address
> that bounced or complained. During the pilot we review the bounce and complaint rates in the SES
> account dashboard every week.
