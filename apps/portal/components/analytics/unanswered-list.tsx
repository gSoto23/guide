"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { UnansweredPage, UnansweredQuestion } from "@guidesk/contracts";
import type { Formatters, PeriodValue } from "@/lib/analytics";
import { useWorkspace } from "@/lib/use-workspace";

/** Questions the assistant couldn't answer, newest first, as plain text (FR-009, AC-SEC-003). */
export function UnansweredList({
  locale,
  period,
  propertyId,
  format,
  showProperty,
}: {
  locale: string;
  period: PeriodValue;
  propertyId: string | undefined;
  format: Formatters;
  showProperty: boolean;
}) {
  const t = useTranslations("analytics");
  const workspace = useWorkspace();
  const [items, setItems] = useState<UnansweredQuestion[] | null>(null);
  const [next, setNext] = useState<string | null>(null);

  const load = useCallback(
    async (cursor: string | null) => {
      if (!workspace) return;
      const params = new URLSearchParams({ period });
      if (propertyId) params.set("propertyId", propertyId);
      if (cursor) params.set("cursor", cursor);
      const page = await workspace.api.get<UnansweredPage>(`/analytics/unanswered?${params}`);
      setItems((current) => (cursor && current ? [...current, ...page.items] : page.items));
      setNext(page.next);
    },
    [workspace, period, propertyId],
  );

  useEffect(() => {
    setItems(null);
    void load(null).catch(() => setItems([]));
  }, [load]);

  if (items === null) return <p className="muted">{t("loading")}</p>;
  if (items.length === 0) return <p className="muted">{t("unansweredEmpty")}</p>;
  return (
    <>
      <p className="field-hint">{t("unansweredHint")}</p>
      <ul className="list-plain unanswered-list">
        {items.map((item) => (
          <li key={item.traceId} className="unanswered-item">
            <p className="transcript-text">{item.text ?? t("removedText")}</p>
            <p className="muted">
              {format.dateTime(item.at)}
              {showProperty ? ` · ${item.propertyName}` : ""}
              {" · "}
              <Link
                href={`/${locale}/properties/${item.propertyId}/conversations/${item.conversationId}`}
              >
                {t("openConversation")}
              </Link>
            </p>
          </li>
        ))}
      </ul>
      {next ? (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void load(next).catch(() => undefined)}
        >
          {t("more")}
        </button>
      ) : null}
    </>
  );
}
