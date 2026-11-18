"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ShareStay, StayLinkCopy } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * Upcoming stays with their stay links (feature 004 US2, FR-041, FR-042): copy (after a recent
 * sign-in, because a stay link shows codes), regenerate, and revoke. Owners and admins only.
 */
export function StaysCard({
  locale,
  propertyId,
  stays,
  onChange,
  children,
}: {
  locale: string;
  propertyId: string;
  stays: ShareStay[];
  requireConfirmationCode: boolean;
  onChange: () => Promise<void>;
  children?: (stay: ShareStay) => React.ReactNode;
}) {
  const t = useTranslations("share");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [copied, setCopied] = useState<Record<string, StayLinkCopy>>({});
  const [error, setError] = useState<string | null>(null);
  const base = `/properties/${propertyId}/share/stays`;

  const day = (date: string) => {
    const [y, m, d] = date.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(y!, m! - 1, d!)));
  };
  const instant = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  async function act(stay: ShareStay, action: "copy" | "regenerate" | "revoke") {
    if (!workspace) return;
    if (action === "regenerate" && !window.confirm(t("stays.regenerateConfirm"))) return;
    if (action === "revoke" && !window.confirm(t("stays.revokeConfirm"))) return;
    setError(null);
    try {
      if (action === "revoke") {
        await workspace.api.post(`${base}/${stay.stayId}/link/revoke`);
      } else {
        const path = `${base}/${stay.stayId}/link${action === "regenerate" ? "/regenerate" : ""}`;
        const result = await run(() => workspace.api.post<StayLinkCopy>(path));
        if (!result) return;
        await navigator.clipboard?.writeText(result.url).catch(() => undefined);
        setCopied((current) => ({ ...current, [stay.stayId]: result }));
      }
      await onChange();
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setError(
        errors(
          code === "stay_not_eligible" || code === "guide_not_published" ? code : "internal_error",
        ),
      );
    }
  }

  return (
    <div className="card">
      <h2>{t("stays.title")}</h2>
      <p className="muted">{t("stays.body")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {stays.length === 0 ? (
        <p>{t("stays.empty")}</p>
      ) : (
        <ul className="list-plain">
          {stays.map((stay) => {
            const link = copied[stay.stayId];
            const canCopy = stay.link.status !== "ended";
            return (
              <li key={stay.stayId} className="stay-row">
                <p>
                  <strong>
                    {t("stays.dates", {
                      checkIn: day(stay.checkInDate),
                      checkout: day(stay.checkoutDate),
                    })}
                  </strong>{" "}
                  · {stay.channel}
                  {stay.mayBeBlock ? ` · ${t("stays.mayBeBlock")}` : ""}
                </p>
                <p className="muted">
                  {t(`stays.status.${stay.link.status}`)} ·{" "}
                  {t("stays.devices", { count: stay.link.devices })}
                  {stay.link.firstOpenedAt
                    ? ` · ${t("stays.firstOpened", { date: instant(stay.link.firstOpenedAt) })}`
                    : ""}
                  {stay.link.devices > 0
                    ? ` · ${t("stays.valuesShown", { count: stay.link.valuesShown })}`
                    : ""}
                </p>
                {stay.link.lockedUntil && (
                  <p className="alert alert-info">
                    {t("stays.locked", { time: instant(stay.link.lockedUntil) })}
                  </p>
                )}
                {link && (
                  <p className="share-url" role="status">
                    <span className="visually-hidden">{t("stays.copied")}</span>
                    <code>{link.url}</code>
                    {link.confirmationCode && (
                      <span>{t("stays.code", { code: link.confirmationCode })}</span>
                    )}
                  </p>
                )}
                <div className="actions">
                  {canCopy && (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void act(stay, "copy")}
                    >
                      {link ? t("stays.copied") : t("stays.copy")}
                    </button>
                  )}
                  {children?.(stay)}
                  {canCopy && stay.link.status !== "not_created" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void act(stay, "regenerate")}
                    >
                      {t("stays.regenerate")}
                    </button>
                  )}
                  {stay.link.status === "active" || stay.link.status === "device_limit" ? (
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => void act(stay, "revoke")}
                    >
                      {t("stays.revoke")}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {dialog}
    </div>
  );
}
