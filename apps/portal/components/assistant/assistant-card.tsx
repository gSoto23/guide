"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { AssistantGroups, PropertyAssistant, WorkspaceAssistant } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * A summary of the assistant's settings with a link to the settings screen (feature 007 US1):
 * on the property page (what applies there) and in workspace settings (the defaults).
 */
export function AssistantCard({ locale, propertyId }: { locale: string; propertyId?: string }) {
  const t = useTranslations("assistant");
  const workspace = useWorkspace();
  const id = useId();
  const [summary, setSummary] = useState<{ groups: AssistantGroups; own: boolean } | null>(null);

  useEffect(() => {
    if (!workspace) return;
    let active = true;
    const load = propertyId
      ? workspace.api
          .get<PropertyAssistant>(`/properties/${propertyId}/assistant`)
          .then((data) => ({
            groups: data.effective,
            own: Object.values(data.follows).some((follows) => !follows) || !!data.instructions,
          }))
      : workspace.api.get<WorkspaceAssistant>("/assistant").then((data) => ({
          groups: data,
          own: false,
        }));
    load.then((value) => active && setSummary(value)).catch(() => undefined);
    return () => {
      active = false;
    };
  }, [workspace, propertyId]);

  if (!workspace || !summary) return null;
  const automatic = Object.values(summary.groups.autonomy).filter(
    (level) => level !== "draft",
  ).length;
  const href = propertyId
    ? `/${locale}/properties/${propertyId}/assistant`
    : `/${locale}/settings/assistant`;
  const quiet = summary.groups.quietHours;
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("title")}</h2>
      <ul className="why-list">
        <li>{t("summary.automatic", { count: automatic })}</li>
        <li>{t("summary.tone", { tone: t(`tone.${summary.groups.tone}`) })}</li>
        {quiet.enabled && quiet.start && quiet.end && (
          <li>{t("summary.quiet", { start: quiet.start, end: quiet.end })}</li>
        )}
      </ul>
      {summary.own && <p className="muted">{t("summary.own")}</p>}
      <p>
        <Link href={href}>{t("summary.configure")}</Link>
      </p>
    </section>
  );
}
