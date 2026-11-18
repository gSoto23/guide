import type { ItemView, SectionView } from "@guidesk/contracts";

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A section's title: the template name, or the custom title in the reader's language. */
export function sectionTitle(
  t: Translate,
  section: Pick<SectionView, "kind" | "title">,
  locale: string,
): string {
  if (section.kind !== "custom") return t(`sections.${section.kind}`);
  const title = section.title ?? {};
  return (locale === "en" ? (title.en ?? title.es) : (title.es ?? title.en)) ?? "";
}

/** The source label of an item (FR-005): who wrote it, or where it came from until reviewed. */
export function sourceLabel(
  t: Translate,
  item: Pick<ItemView, "source" | "sourceDetail" | "reviewed">,
): string {
  if (item.source === "host") return t("source.host");
  if (item.reviewed) return t("source.reviewed");
  switch (item.source) {
    case "pms":
      return t("source.pms", { provider: item.sourceDetail ?? "PMS" });
    case "document":
      return t("source.document", { file: item.sourceDetail ?? "" });
    case "copy":
      return t("source.copy", { name: item.sourceDetail ?? "" });
    default:
      return t(`source.${item.source}`);
  }
}

export function guideStatusKey(status: string, hasUnpublishedChanges: boolean): string {
  return status === "published" && hasUnpublishedChanges ? "published_changes" : status;
}

/** Human-readable bytes, for the storage line. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}
