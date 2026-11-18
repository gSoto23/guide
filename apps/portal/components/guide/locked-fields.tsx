"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { LockedFieldView, RevealedValue, RevealHistory } from "@guidesk/contracts";
import { LOCKED_FIELD_KIND_VALUES } from "@guidesk/contracts/values";
import { problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";

type ManagedField = Extract<LockedFieldView, { isSet: boolean }>;

function isManaged(field: LockedFieldView): field is ManagedField {
  return "isSet" in field;
}

/**
 * Locked fields (screen H-18, feature 003 US2): masked inputs, "set on …", reveal after step-up
 * for 60 seconds (FR-016, FR-017), the public Wi-Fi switch (FR-021), deletes that warn when the
 * published guide uses the field (FR-024), and the reveal history. Agents see only that fields
 * exist (FR-063).
 */
export function LockedFields({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("guide.locked");
  const guide = useTranslations("guide");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const { run, dialog } = useStepUp();
  const [fields, setFields] = useState<LockedFieldView[] | null>(null);
  const [history, setHistory] = useState<RevealHistory | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; value: string; left: number } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<(typeof LOCKED_FIELD_KIND_VALUES)[number]>("door_code");
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [changing, setChanging] = useState<string | null>(null);
  const base = `/properties/${propertyId}/guide/locked-fields`;

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .get<LockedFieldView[]>(base)
      .then(setFields, () => setError(errors("internal_error")));
    if (workspace.canManage)
      workspace.api.get<RevealHistory>(`${base}/reveals`).then(setHistory, () => undefined);
  }, [workspace, base, errors]);

  // A revealed value hides itself after its time, and when the host leaves the page (FR-016).
  useEffect(() => {
    if (!revealed) return;
    if (revealed.left <= 0) {
      setRevealed(null);
      return;
    }
    const timer = setTimeout(
      () => setRevealed((current) => (current ? { ...current, left: current.left - 1 } : null)),
      1000,
    );
    return () => clearTimeout(timer);
  }, [revealed]);

  if (!workspace) return null;

  function failure(caught: unknown) {
    const code = problemOf(caught)?.code ?? "internal_error";
    setError(errors.has(code) ? errors(code) : errors("internal_error"));
  }

  async function refresh() {
    if (!workspace) return;
    setFields(await workspace.api.get<LockedFieldView[]>(base));
    if (workspace.canManage)
      setHistory(await workspace.api.get<RevealHistory>(`${base}/reveals`).catch(() => null));
  }

  async function add(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setError(null);
    try {
      const created = await run(() =>
        workspace.api.post<LockedFieldView>(
          base,
          { kind, ...(label.trim() ? { label: label.trim() } : {}), ...(value ? { value } : {}) },
          { idempotent: true },
        ),
      );
      if (!created) return;
      setAdding(false);
      setLabel("");
      setValue("");
      await refresh();
    } catch (caught) {
      failure(caught);
    }
  }

  async function reveal(field: ManagedField) {
    if (!workspace) return;
    setError(null);
    try {
      const answer = await run(() =>
        workspace.api.post<RevealedValue>(`${base}/${field.id}/reveal`),
      );
      if (answer) setRevealed({ id: field.id, value: answer.value, left: answer.hideAfterSeconds });
      void refresh();
    } catch (caught) {
      failure(caught);
    }
  }

  async function change(field: ManagedField, next: string) {
    if (!workspace || !next) return;
    try {
      const saved = await run(() =>
        workspace.api.patch<LockedFieldView>(`${base}/${field.id}`, { value: next }),
      );
      if (saved) {
        setChanging(null);
        await refresh();
      }
    } catch (caught) {
      failure(caught);
    }
  }

  async function remove(field: ManagedField) {
    if (!workspace || !window.confirm(t("deleteConfirm"))) return;
    try {
      await run(() => workspace.api.delete(`${base}/${field.id}`));
      await refresh();
    } catch (caught) {
      if (
        problemOf(caught)?.code === "locked_field_referenced" &&
        window.confirm(t("referenced"))
      ) {
        await run(() => workspace.api.delete(`${base}/${field.id}?confirm=true`)).catch(failure);
        await refresh();
      } else {
        failure(caught);
      }
    }
  }

  async function togglePublic(field: ManagedField) {
    if (!workspace) return;
    if (!field.isPublic && !window.confirm(t("publicWifiWarning"))) return;
    try {
      await run(() =>
        workspace.api.put<LockedFieldView>(`${base}/${field.id}/visibility`, {
          public: !field.isPublic,
        }),
      );
      await refresh();
    } catch (caught) {
      failure(caught);
    }
  }

  const dateOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
      new Date(iso),
    );

  return (
    <section aria-labelledby="locked-title">
      {dialog}
      <p>
        <Link href={`/${locale}/properties/${propertyId}/guide`}>
          {guide("editor.backToGuide")}
        </Link>
      </p>
      <h1 id="locked-title">{t("title")}</h1>
      <p className="muted">{workspace.canManage ? t("intro") : t("agentNotice")}</p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <ul className="restricted-list">
        {(fields ?? []).map((field) => (
          <li key={field.id} className="card">
            <strong>{field.label}</strong>{" "}
            <span className="badge">{guide(`lockedKinds.${field.kind}`)}</span>
            {isManaged(field) ? (
              <>
                <p className="muted">
                  {field.isPublic ? t("isPublic") : t("locked")} ·{" "}
                  {field.isSet && field.valueSetAt
                    ? t("set", { date: dateOf(field.valueSetAt) })
                    : t("notSet")}
                </p>
                {revealed?.id === field.id ? (
                  <p>
                    <code aria-live="polite">{revealed.value}</code>{" "}
                    <span className="muted">{t("hidesIn", { seconds: revealed.left })}</span>{" "}
                    <button type="button" className="button-link" onClick={() => setRevealed(null)}>
                      {t("hide")}
                    </button>
                  </p>
                ) : (
                  <p aria-hidden="true">••••••</p>
                )}
                {changing === field.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const input = event.currentTarget.elements.namedItem(
                        "value",
                      ) as HTMLInputElement;
                      void change(field, input.value);
                    }}
                  >
                    <label htmlFor={`value-${field.id}`}>{t("value")}</label>
                    <input
                      id={`value-${field.id}`}
                      name="value"
                      type="password"
                      autoComplete="off"
                      maxLength={200}
                      required
                    />
                    <button type="submit" className="button button-primary">
                      {t("save")}
                    </button>
                  </form>
                ) : null}
                <div className="actions">
                  {field.isSet && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void reveal(field)}
                    >
                      {t("reveal")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => setChanging(field.id)}
                  >
                    {t("change")}
                  </button>
                  {field.kind === "wifi_password" && (
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={field.isPublic}
                        onChange={() => void togglePublic(field)}
                      />
                      {t("publicWifi")}
                    </label>
                  )}
                  <button
                    type="button"
                    className="button button-danger"
                    onClick={() => void remove(field)}
                  >
                    {t("delete")}
                  </button>
                </div>
              </>
            ) : (
              <p className="muted">{t("locked")}</p>
            )}
          </li>
        ))}
      </ul>

      {workspace.canManage &&
        (adding ? (
          <form className="card" onSubmit={add}>
            <label htmlFor="locked-kind">{t("kind")}</label>
            <select
              id="locked-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              {LOCKED_FIELD_KIND_VALUES.map((option) => (
                <option key={option} value={option}>
                  {guide(`lockedKinds.${option}`)}
                </option>
              ))}
            </select>
            <label htmlFor="locked-label">{t("label")}</label>
            <input
              id="locked-label"
              value={label}
              maxLength={80}
              onChange={(event) => setLabel(event.target.value)}
            />
            <label htmlFor="locked-value">{t("value")}</label>
            <input
              id="locked-value"
              type="password"
              autoComplete="off"
              value={value}
              maxLength={200}
              onChange={(event) => setValue(event.target.value)}
            />
            <div className="actions">
              <button type="submit" className="button button-primary">
                {t("save")}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAdding(false)}
              >
                {guide("review.cancel")}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="button button-primary" onClick={() => setAdding(true)}>
            {t("add")}
          </button>
        ))}

      {workspace.canManage && history && (
        <div className="card" aria-labelledby="history-title">
          <h2 id="history-title">{t("history")}</h2>
          {history.items.length === 0 ? (
            <p>{t("historyEmpty")}</p>
          ) : (
            <ul className="event-list">
              {history.items.slice(0, 20).map((item, index) => (
                <li key={`${item.fieldId}-${index}`}>
                  {item.source === "guest"
                    ? t("historyGuest", { label: item.label, date: dateOf(item.at) })
                    : item.source === "export"
                      ? t("historyExport", { name: item.revealedBy ?? "—", date: dateOf(item.at) })
                      : t("historyItem", {
                          name: item.revealedBy ?? "—",
                          label: item.label,
                          date: dateOf(item.at),
                        })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
