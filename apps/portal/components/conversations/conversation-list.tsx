"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { ConversationSummary, PropertyDetail } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

const REFRESH_MS = 15_000;

/**
 * A property's conversations (feature 005 US3, FR-024): those needing the host first, each with
 * its stay dates (or "No stay"), the reason, and the latest message as plain text.
 */
export function ConversationList({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("conversations");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const [propertyName, setPropertyName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setItems(
        await workspace.api.get<ConversationSummary[]>(`/properties/${propertyId}/conversations`),
      );
      setError(null);
    } catch {
      setError(errors("internal_error"));
    }
  }, [workspace, propertyId, errors]);

  useEffect(() => {
    if (!workspace) return;
    void workspace.api
      .get<PropertyDetail>(`/properties/${propertyId}`)
      .then((property) => setPropertyName(property.name))
      .catch(() => undefined);
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [workspace, propertyId, load]);

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return (
    <section aria-labelledby="conversations-title">
      <p>
        <Link href={`/${locale}/properties/${propertyId}`}>{t("back")}</Link>
      </p>
      <h1 id="conversations-title">
        {propertyName ? t("title", { property: propertyName }) : t("titleShort")}
      </h1>
      <p className="muted">{t("intro")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {items && items.length === 0 && <p className="card">{t("empty")}</p>}
      {items && items.length > 0 && (
        <ul className="list-plain conversation-list">
          {items.map((item) => (
            <li key={item.id} className="card conversation-item">
              <p className="property-meta">
                <span
                  className={`badge ${item.status === "needs_host" ? "badge-warning" : "badge-ready"}`}
                >
                  {item.status === "needs_host" ? t("needsHost") : t("open")}
                </span>
                <span className="badge">
                  {item.stay
                    ? t("stayDates", {
                        checkIn: item.stay.checkInDate,
                        checkout: item.stay.checkoutDate,
                      })
                    : t("noStay")}
                </span>
              </p>
              {item.reason && (
                <p className="muted">{t("reason", { reason: t(`reasons.${item.reason}`) })}</p>
              )}
              {item.lastMessage && (
                <p className="conversation-preview">
                  <strong>{t(`author.${item.lastMessage.author}`)}:</strong> {item.lastMessage.body}
                </p>
              )}
              <p className="muted">{t("lastAt", { when: when(item.lastMessageAt) })}</p>
              <Link
                className="button button-secondary"
                href={`/${locale}/properties/${propertyId}/conversations/${item.id}`}
              >
                {t("openConversation")}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
