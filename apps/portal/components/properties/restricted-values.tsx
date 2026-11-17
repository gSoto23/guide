"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { RestrictedValue, RestrictedValueList } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * Codes found in imported PMS text (FR-031, T100): their kind and where they came from, masked.
 * The values are encrypted and never sent to the portal; the guide builder (spec 003) puts them in
 * the guide's locked fields. Owners and admins only; loaded on demand by the property page.
 */
export function RestrictedValues({ propertyId }: { propertyId: string }) {
  const t = useTranslations("properties.restricted");
  const workspace = useWorkspace();
  const [items, setItems] = useState<RestrictedValue[] | null>(null);

  useEffect(() => {
    if (!workspace?.canManage) return;
    const controller = new AbortController();
    workspace.api
      .get<RestrictedValueList>(`/properties/${propertyId}/restricted-values`, controller.signal)
      .then((list) => setItems(list.items))
      .catch(() => setItems([]));
    return () => controller.abort();
  }, [workspace, propertyId]);

  if (!items || items.length === 0) return null;
  return (
    <section aria-labelledby="restricted-title">
      <h2 id="restricted-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <ul className="facts-list restricted-list">
        {items.map((item) => (
          <li key={item.id}>
            <span>
              {t(`kinds.${item.kind}`)}
              {item.label ? <span className="muted"> · {item.label}</span> : null}
            </span>
            <span aria-label={t("masked")}>••••</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
