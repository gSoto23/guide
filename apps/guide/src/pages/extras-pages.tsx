import type { GuestExtra, GuestExtras, GuestGuide } from "@guidesk/contracts";
import { coverPreview, Layout, type PageChrome } from "../components/layout.js";
import type { GuestLocale, Translate } from "../i18n.js";
import { clientTexts } from "./guide-pages.js";

/**
 * Extras (feature 008 screens G-08 and G-09, research R6): the host's services with their price or
 * "Free" and "Offered by your host", and one extra with its rules and the request form. The pages
 * are public and cached; the stay's requests and the form appear only through the page script,
 * so no personal state is ever in the HTML (spec 004 R9). Host text is rendered as text.
 */
export interface ExtrasPageInput extends PageChrome {
  guide: GuestGuide;
  extras: GuestExtras;
}

const SHORT_DESCRIPTION = 140;
const STATUSES = ["waiting", "confirmed", "declined", "cancelled", "host_cancelled", "expired"];
const NOTED = ["waiting", "declined", "cancelled", "expired"];
const REASONS = ["unavailable", "fully_booked", "too_late", "other", "stay"];
const RULES = [
  "quantity",
  "needs_date",
  "needs_time",
  "date_range",
  "weekday",
  "lead_time",
  "max_per_stay",
  "turnover",
];
const ERRORS = [
  "duplicate",
  "too_many_requests",
  "not_requestable",
  "no_session",
  "not_waiting",
  "offline",
  "generic",
];

function chrome(input: ExtrasPageInput, path: string) {
  const { guide, locale } = input;
  const other = guide.languages.find((language) => language !== locale) ?? null;
  return {
    publicId: guide.publicId,
    propertyName: guide.propertyName,
    homeHref: `/g/${guide.publicId}/${locale}`,
    emergencyHref: `/g/${guide.publicId}/${locale}/emergency`,
    switchHref: other ? `/g/${guide.publicId}/${other}${path}` : null,
    switchLocale: (other as GuestLocale | null) ?? null,
    previewImage: coverPreview(guide.cover, input.guideUrl),
  };
}

/** Strings the page script shows for requests, with `{hours}` left for it to fill. */
export function extrasTexts(t: Translate): Record<string, string> {
  const texts = clientTexts(t);
  const keys = [
    ...STATUSES.map((status) => `extras.status.${status}`),
    ...NOTED.map((status) => `extras.statusNote.${status}`),
    ...REASONS.map((reason) => `extras.reasons.${reason}`),
    ...RULES.map((rule) => `extras.rules.${rule}`),
    ...ERRORS.map((code) => `extras.errors.${code}`),
    "extras.blocked.no_session",
    "extras.blocked.ended",
    "extras.blocked.verify",
    "extras.free",
    "extras.cancel",
    "extras.cancelled",
    "extras.sent",
    "extras.sentConfirmed",
    "extras.status.confirmed_payable",
    // Feature 013: payment states, with their placeholders left for the script.
    "extras.payment.pay",
    "extras.payment.total",
    "extras.payment.open",
    "extras.payment.processing",
    "extras.payment.paid",
    "extras.payment.reference",
    "extras.payment.refunded",
    "extras.payment.disputed",
    "extras.payment.redirecting",
    "extras.payment.errors.not_payable",
    "extras.payment.errors.already_paid",
    "extras.payment.errors.rate_limited",
  ];
  const placeholders = { hours: "{hours}", amount: "{amount}", reference: "{reference}" };
  for (const key of keys) texts[key] = t(key, placeholders);
  return texts;
}

/** The price in the extra's currency, or "Free". */
export function priceOf(
  extra: Pick<GuestExtra, "price" | "currency">,
  t: Translate,
  locale: GuestLocale,
) {
  if (extra.price === 0) return t("extras.free");
  try {
    return new Intl.NumberFormat(locale === "es" ? "es-CR" : "en-US", {
      style: "currency",
      currency: extra.currency,
      maximumFractionDigits: extra.price % 1 === 0 ? 0 : 2,
    }).format(extra.price);
  } catch {
    return `${extra.price} ${extra.currency}`;
  }
}

function short(text: string): string {
  if (text.length <= SHORT_DESCRIPTION) return text;
  const cut = text.slice(0, SHORT_DESCRIPTION);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** "lunes, miércoles y viernes": ISO weekdays (1 is Monday) in the guest's language. */
function weekdayList(days: readonly number[], locale: GuestLocale): string {
  const name = new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
  // 1 January 2024 was a Monday.
  const names = [...days]
    .sort((a, b) => a - b)
    .map((day) => name.format(new Date(Date.UTC(2024, 0, day))));
  return new Intl.ListFormat(locale, { type: "conjunction" }).format(names);
}

function Rules({ extra, t, locale }: { extra: GuestExtra; t: Translate; locale: GuestLocale }) {
  const lines: string[] = [];
  if (extra.turnover === "early_check_in") lines.push(t("extras.earlyCheckIn"));
  else if (extra.turnover === "late_checkout") lines.push(t("extras.lateCheckout"));
  else if (extra.needsDate) {
    lines.push(
      t(extra.dateRange === "before_arrival" ? "extras.rangeArrival" : "extras.rangeStay"),
    );
  }
  if (extra.needsDate && !extra.turnover && extra.weekdays.length < 7) {
    lines.push(t("extras.weekdays", { days: weekdayList(extra.weekdays, locale) }));
  }
  if (extra.leadTimeHours > 0) lines.push(t("extras.lead", { hours: extra.leadTimeHours }));
  lines.push(t("extras.max", { count: extra.maxPerStay }));
  return (
    <section aria-labelledby="extra-rules">
      <h2 id="extra-rules" className="subtitle">
        {t("extras.rulesTitle")}
      </h2>
      <ul className="extra-rules">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

/** The stay's requests, filled by the page script (hidden until there are some). */
function Requests({ t, extraId }: { t: Translate; extraId?: string }) {
  return (
    <section
      className="extra-requests"
      aria-labelledby="extra-requests-title"
      data-extra-requests
      data-extra-filter={extraId}
      hidden
    >
      <h2 id="extra-requests-title" className="subtitle">
        {t("extras.yourRequests")}
      </h2>
      <ul className="requests" />
    </section>
  );
}

/** G-08: the host's extras. */
export function ExtrasPage(input: ExtrasPageInput) {
  const { guide, extras, t, locale } = input;
  const base = `/g/${guide.publicId}/${locale}/extras`;
  return (
    <Layout
      {...input}
      title={`${t("extras.title")} · ${guide.propertyName}`}
      guide={chrome(input, "/extras")}
      clientTexts={extrasTexts(t)}
    >
      <a className="back" href={`/g/${guide.publicId}/${locale}`}>
        {t("nav.back")}
      </a>
      <h1 className="title" data-extras-page="list">
        {t("extras.title")}
      </h1>
      <p className="lead">{t("extras.intro")}</p>
      <p className="disclosure" role="note">
        {t("extras.optional")}
      </p>
      <Requests t={t} />
      {extras.extras.length > 0 ? (
        <ul className="extras">
          {extras.extras.map((extra) => (
            <li key={extra.id} className="card extra">
              {extra.image ? (
                // Feature 016 FR-009: the extra's photo in a fixed 16:9 box; decorative here.
                <img
                  className="extra-image"
                  src={extra.image.smallUrl ?? extra.image.url}
                  alt=""
                  width={extra.image.width ?? 1600}
                  height={extra.image.height ?? 900}
                  loading="lazy"
                  decoding="async"
                />
              ) : null}
              <h2
                className="extra-name"
                lang={extra.language !== locale ? extra.language : undefined}
              >
                <a href={`${base}/${extra.id}`}>{extra.name}</a>
              </h2>
              <p className="extra-price">{priceOf(extra, t, locale)}</p>
              {extra.description ? (
                <p
                  className="extra-description"
                  lang={extra.language !== locale ? extra.language : undefined}
                >
                  {short(extra.description)}
                </p>
              ) : null}
              <p className="muted">{t("extras.offeredBy")}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("extras.empty")}</p>
      )}
    </Layout>
  );
}

/** G-09: one extra, its rules, and the request form the page script shows to a stay's guest. */
export function ExtraPage(input: ExtrasPageInput & { extra: GuestExtra }) {
  const { guide, extra, t, locale } = input;
  const other = extra.language !== locale ? extra.language : undefined;
  const dateField = extra.needsDate && !extra.turnover;
  const timeField = extra.needsTime && (extra.needsDate || extra.turnover !== null);
  return (
    <Layout
      {...input}
      title={`${extra.name} · ${guide.propertyName}`}
      guide={chrome(input, `/extras/${extra.id}`)}
      clientTexts={extrasTexts(t)}
    >
      <a className="back" href={`/g/${guide.publicId}/${locale}/extras`}>
        {t("extras.back")}
      </a>
      {extra.image ? (
        <img
          className="cover"
          src={extra.image.smallUrl ?? extra.image.url}
          srcSet={
            extra.image.smallUrl
              ? `${extra.image.smallUrl} 640w, ${extra.image.url} 1600w`
              : undefined
          }
          sizes="(max-width: 40rem) 100vw, 40rem"
          alt={t("extras.photoAlt", { name: extra.name })}
          width={extra.image.width ?? 1600}
          height={extra.image.height ?? 900}
          decoding="async"
        />
      ) : null}
      <h1 className="title" data-extras-page="detail" lang={other}>
        {extra.name}
      </h1>
      <p className="extra-price">{priceOf(extra, t, locale)}</p>
      <p className="muted">{t("extras.offeredBy")}</p>
      {other ? <p className="muted">{t(`extras.onlyIn.${extra.language}`)}</p> : null}
      {extra.description ? (
        <section aria-labelledby="extra-description">
          <h2 id="extra-description" className="subtitle">
            {t("extras.description")}
          </h2>
          <p className="extra-description" lang={other}>
            {extra.description}
          </p>
        </section>
      ) : null}
      <Rules extra={extra} t={t} locale={locale} />
      <section
        className="card extra-request"
        aria-labelledby="extra-request-title"
        data-extra-request
        data-extra-id={extra.id}
        data-date-range={extra.dateRange}
        data-lead={extra.leadTimeHours}
      >
        <h2 id="extra-request-title" className="card-title">
          {t("extras.requestTitle")}
        </h2>
        <p data-request-note>{t("extras.blocked.no_session")}</p>
        <button type="button" className="button-secondary" data-request-verify hidden>
          {t("extras.verify")}
        </button>
        <form className="extra-form" data-request-form hidden>
          {dateField ? (
            <div className="field">
              <label className="label" htmlFor="extra-date">
                {t("extras.date")}
              </label>
              <input className="field-input" id="extra-date" name="date" type="date" required />
            </div>
          ) : null}
          {timeField ? (
            <div className="field">
              <label className="label" htmlFor="extra-time">
                {t("extras.time")}
              </label>
              <input className="field-input" id="extra-time" name="time" type="time" required />
            </div>
          ) : null}
          {extra.maxPerStay > 1 ? (
            <div className="field">
              <label className="label" htmlFor="extra-quantity">
                {t("extras.quantity")}
              </label>
              <input
                className="field-input"
                id="extra-quantity"
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={extra.maxPerStay}
                defaultValue={1}
                required
              />
            </div>
          ) : null}
          <div className="field">
            <label className="label" htmlFor="extra-note">
              {t("extras.note")}
            </label>
            <p className="field-hint" id="extra-note-hint">
              {t("extras.noteHint")}
            </p>
            <textarea
              className="field-input"
              id="extra-note"
              name="note"
              rows={3}
              maxLength={300}
              aria-describedby="extra-note-hint"
            />
          </div>
          <p className="error" role="alert" data-request-error />
          <button type="submit" className="button-primary">
            {t("extras.request")}
          </button>
          <p className="muted" data-request-offline hidden>
            {t("extras.offline")}
          </p>
        </form>
        <p className="success" role="status" data-request-status />
        <p className="muted">{t("extras.payment")}</p>
      </section>
      <Requests t={t} extraId={extra.id} />
    </Layout>
  );
}

export function findExtra(extras: GuestExtras, id: string): GuestExtra | null {
  return extras.extras.find((extra) => extra.id === id) ?? null;
}
