import type {
  GuestGuide,
  GuestItem,
  GuestLockedField,
  GuestRecommendation,
} from "@guidesk/contracts";
import { GuideDocumentView, type RenderableDocument } from "@guidesk/ui";
import type { Translate } from "../i18n.js";

/**
 * Guide content as the guest sees it (feature 004 FR-003 to FR-010). Locked fields render as
 * placeholders with their label; the browser script turns them into "Show code" for a stay
 * session inside its window. No value is ever rendered here, except a public Wi-Fi password.
 */
export function LockedField({ field, t }: { field: GuestLockedField | undefined; t: Translate }) {
  if (!field) return null;
  if (!field.set) {
    return (
      <span className="locked locked-unset">
        <span className="locked-label">{field.label}</span>{" "}
        <span className="locked-status">{t("locked.notSet")}</span>
      </span>
    );
  }
  return (
    <span className="locked" data-field-id={field.id} data-kind={field.kind} data-state="public">
      <span className="locked-label">{field.label}</span>
      <span className="locked-status" aria-live="polite">
        {t("locked.public")}
      </span>
      <span className="locked-fallback">{t("locked.fallback")}</span>
    </span>
  );
}

export function CopyValue({ value, t }: { value: string; t: Translate }) {
  return (
    <span className="copy-value">
      <span className="value">{value}</span>
      <button type="button" className="copy" data-copy={value} hidden>
        {t("copy.copy")}
      </button>
    </span>
  );
}

function renderField(guide: GuestGuide, t: Translate) {
  return (fieldId: string) => {
    if (guide.wifi.fieldId === fieldId && guide.wifi.password) {
      return <CopyValue value={guide.wifi.password} t={t} />;
    }
    return <LockedField field={guide.lockedFields.find((field) => field.id === fieldId)} t={t} />;
  };
}

export function MapLinks({ address, t }: { address: string; t: Translate }) {
  const query = encodeURIComponent(address);
  return (
    <span className="map-links">
      <a
        className="button-secondary"
        href={`https://www.google.com/maps/search/?api=1&query=${query}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {t("facts.openMaps")}
      </a>
      <a
        className="button-secondary"
        href={`https://waze.com/ul?q=${query}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        {t("facts.openWaze")}
      </a>
    </span>
  );
}

function Recommendation({ rec, t }: { rec: GuestRecommendation; t: Translate }) {
  const href = rec.url && /^https?:\/\//.test(rec.url) ? rec.url : null;
  return (
    <div className="card recommendation">
      <h3 className="recommendation-name">{rec.name}</h3>
      {rec.personalTip ? <p className="muted">{t("item.personalTip")}</p> : null}
      {rec.address ? <p>{rec.address}</p> : null}
      {href ? (
        <a href={href} rel="noopener noreferrer nofollow" target="_blank">
          {t("item.openSite")}
        </a>
      ) : null}
      {rec.benefit ? (
        <p className="disclosure" role="note">
          {t("item.disclosure")}
        </p>
      ) : null}
    </div>
  );
}

function Fact({ item, t }: { item: GuestItem; t: Translate }) {
  const fact = item.fact;
  if (!fact || fact.value === null) return null;
  switch (fact.key) {
    case "check_in_time":
      return (
        <p className="fact">
          <strong>{t("facts.checkIn")}</strong> {t("facts.from", { time: fact.value.slice(0, 5) })}
        </p>
      );
    case "checkout_time":
      return (
        <p className="fact">
          <strong>{t("facts.checkout")}</strong>{" "}
          {t("facts.until", { time: fact.value.slice(0, 5) })}
        </p>
      );
    case "max_guests":
      return <p className="fact">{t("facts.maxGuests", { count: Number(fact.value) })}</p>;
    case "address":
      return (
        <div className="fact">
          <p>
            <strong>{t("facts.address")}</strong> {fact.value}
          </p>
          <MapLinks address={fact.value} t={t} />
        </div>
      );
  }
}

export function Item({
  item,
  guide,
  sectionTitle,
  t,
  eager,
}: {
  item: GuestItem;
  guide: GuestGuide;
  sectionTitle: string;
  t: Translate;
  eager: boolean;
}) {
  if (item.kind === "fact") return <Fact item={item} t={t} />;
  if (item.kind === "recommendation" && item.recommendation) {
    return <Recommendation rec={item.recommendation} t={t} />;
  }
  if ((item.kind === "image" || item.kind === "video") && item.media) {
    const media = item.media;
    const ratio = media.width && media.height ? { width: media.width, height: media.height } : {};
    if (media.kind === "video") {
      return (
        <video
          className="media"
          controls
          playsInline
          preload="none"
          src={media.url}
          aria-label={t("item.video", { section: sectionTitle })}
          {...ratio}
        />
      );
    }
    return (
      <img
        className="media"
        src={media.url}
        srcSet={media.smallUrl ? `${media.smallUrl} 640w, ${media.url} 1600w` : undefined}
        sizes={media.smallUrl ? "(max-width: 44rem) 100vw, 42rem" : undefined}
        alt={t("item.photo", { section: sectionTitle })}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        {...ratio}
      />
    );
  }
  return (
    <div className="item" lang={item.translated ? undefined : item.language}>
      <GuideDocumentView
        doc={item.doc as RenderableDocument | null}
        renderLockedField={renderField(guide, t)}
      />
      {item.translated ? null : (
        <p className="muted untranslated" lang={guide.language}>
          {t("item.notTranslated")}
        </p>
      )}
    </div>
  );
}

export function sectionTitle(section: GuestGuide["sections"][number], t: Translate): string {
  return section.kind === "custom"
    ? (section.title ?? t("sections.custom"))
    : t(`sections.${section.kind}`);
}
