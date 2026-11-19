"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PmsListingOption } from "@guidesk/contracts";
import { useOnline } from "@/lib/use-online";

/**
 * Choosing what to import (FR-028, T098): every listing starts selected, up to the free slots of
 * the plan. Listings already imported are marked; importing them again updates them and takes no
 * slot (FR-033).
 */
export function PmsListingSelect({
  listings,
  free,
  limit,
  busy,
  onImport,
}: {
  listings: PmsListingOption[];
  free: number;
  /** Null when the plan has no property limit (feature 011). */
  limit: number | null;
  busy: boolean;
  onImport: (externalIds: string[]) => void;
}) {
  const t = useTranslations("properties.pms");
  const online = useOnline();
  const [selected, setSelected] = useState<Set<string>>(() => {
    let room = free;
    const initial = new Set<string>();
    for (const listing of listings) {
      if (listing.alreadyImported) initial.add(listing.externalId);
      else if (room > 0) {
        initial.add(listing.externalId);
        room -= 1;
      }
    }
    return initial;
  });
  const newOnes = listings.filter(
    (listing) => selected.has(listing.externalId) && !listing.alreadyImported,
  ).length;
  const over = newOnes > free;

  function toggle(listing: PmsListingOption) {
    const next = new Set(selected);
    if (next.has(listing.externalId)) next.delete(listing.externalId);
    else next.add(listing.externalId);
    setSelected(next);
  }

  if (listings.length === 0) return <p className="muted">{t("noListings")}</p>;

  return (
    <>
      <h2>{t("chooseTitle")}</h2>
      {limit === null ? null : <p className="muted">{t("chooseIntro", { free, limit })}</p>}
      <ul className="choice-list">
        {listings.map((listing) => (
          <li key={listing.externalId}>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={selected.has(listing.externalId)}
                onChange={() => toggle(listing)}
              />
              <span>
                {listing.name}
                {listing.alreadyImported ? (
                  <span className="badge badge-ready">{t("alreadyImported")}</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {over ? (
        <p className="alert alert-info" role="status">
          {t("overLimit", { free })}
        </p>
      ) : null}
      <button
        type="button"
        className="button button-primary"
        disabled={busy || !online || selected.size === 0}
        onClick={() => onImport([...selected])}
      >
        {busy ? t("starting") : t("import", { count: selected.size })}
      </button>
    </>
  );
}
