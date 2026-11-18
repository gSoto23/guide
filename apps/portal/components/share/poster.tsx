"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ShareOverview } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * The printable QR poster (feature 004 FR-037): the QR code, the property name, an optional Wi-Fi
 * network name typed here and never saved, and the line that it opens the public guide only.
 */
export function Poster({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("share");
  const workspace = useWorkspace();
  const [overview, setOverview] = useState<ShareOverview | null>(null);
  const [network, setNetwork] = useState("");
  const base = `/properties/${propertyId}/share`;

  useEffect(() => {
    if (!workspace) return;
    workspace.api.get<ShareOverview>(base).then(setOverview, () => setOverview(null));
  }, [workspace, base]);

  if (!workspace || !overview?.propertyLink) return null;
  const qr = `/api/v1/workspaces/${workspace.workspaceId}${base}/qr.svg`;

  return (
    <section className="poster-page">
      <div className="poster-controls no-print">
        <p>
          <Link href={`/${locale}${base}`}>{t("back")}</Link>
        </p>
        <label htmlFor="poster-wifi">{t("poster.wifiLabel")}</label>
        <input
          id="poster-wifi"
          className="input"
          value={network}
          maxLength={40}
          onChange={(event) => setNetwork(event.target.value)}
        />
        <p className="muted">{t("poster.hint")}</p>
        <button type="button" className="button button-primary" onClick={() => window.print()}>
          {t("poster.print")}
        </button>
      </div>
      <article className="poster">
        <h1>{overview.propertyName}</h1>
        <p className="poster-lead">{t("poster.title")}</p>
        <img src={qr} alt="" width={320} height={320} className="poster-qr" />
        {network && <p className="poster-wifi">{t("poster.wifi", { network })}</p>}
        <p className="poster-note">{t("poster.public")}</p>
      </article>
    </section>
  );
}
