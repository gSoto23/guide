"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { PropertyAssistantSettings, WorkspaceAssistantSettings } from "@guidesk/contracts";
import { useWorkspace } from "@/lib/use-workspace";

type Choice = "draft" | "auto" | "inherit";

/**
 * The assistant's autonomy (feature 005 US4, FR-022): the workspace default in workspace settings,
 * or the property's override on the property page. Owners and admins change it; agents read it.
 */
export function AssistantCard({ propertyId }: { propertyId?: string }) {
  const t = useTranslations("assistant");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [inherited, setInherited] = useState<"draft" | "auto">("draft");
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const path = propertyId ? `/properties/${propertyId}/assistant-settings` : "/assistant-settings";

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      if (propertyId) {
        const [settings, defaults] = await Promise.all([
          workspace.api.get<PropertyAssistantSettings>(path),
          workspace.api.get<WorkspaceAssistantSettings>("/assistant-settings"),
        ]);
        setInherited(defaults.autonomy);
        setChoice(settings.override ?? "inherit");
      } else {
        setChoice((await workspace.api.get<WorkspaceAssistantSettings>(path)).autonomy);
      }
    } catch {
      setMessage({ kind: "error", text: errors("internal_error") });
    }
  }, [workspace, path, propertyId, errors]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace || choice === null) return null;
  const canEdit = workspace.canManage;

  async function save(next: Choice) {
    if (!workspace) return;
    const previous = choice;
    setChoice(next);
    setMessage(null);
    try {
      await workspace.api.put(
        path,
        propertyId ? { override: next === "inherit" ? null : next } : { autonomy: next },
      );
      setMessage({ kind: "success", text: t("saved") });
    } catch {
      setChoice(previous);
      setMessage({ kind: "error", text: errors("internal_error") });
    }
  }

  const options: Choice[] = propertyId ? ["inherit", "draft", "auto"] : ["draft", "auto"];
  return (
    <section className="card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t("title")}</h2>
      <p className="muted">{propertyId ? t("propertyBody") : t("workspaceBody")}</p>
      <fieldset disabled={!canEdit}>
        <legend className="visually-hidden">{t("legend")}</legend>
        {options.map((option) => (
          <label key={option} className="choice">
            <input
              type="radio"
              name={`${id}-autonomy`}
              value={option}
              checked={choice === option}
              onChange={() => void save(option)}
            />{" "}
            {option === "inherit" ? t("inherit", { mode: t(`modes.${inherited}`) }) : t(option)}
          </label>
        ))}
      </fieldset>
      {!canEdit && <p className="muted">{t("readOnly")}</p>}
      {message && (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-success"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
    </section>
  );
}
