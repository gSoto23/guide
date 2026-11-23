"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { ExtraInput, MemberExtra, MemberExtras, PropertyList } from "@guidesk/contracts";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { blankExtra, ExtraForm, WEEKDAYS } from "./extra-form";
import { formatPrice, SUGGESTIONS } from "@/lib/extras";

type Suggestion = (typeof SUGGESTIONS)[number];

/** Suggested rules; the names and descriptions come from the catalog texts (FR-004). */
const SUGGESTED: Record<Suggestion, Partial<ExtraInput>> = {
  airport_pickup: { leadTimeHours: 24, needsDate: true, needsTime: true, dateRange: "stay" },
  extra_cleaning: { leadTimeHours: 24, needsDate: true, needsTime: false, dateRange: "stay" },
  grocery_stocking: {
    leadTimeHours: 48,
    needsDate: false,
    needsTime: false,
    dateRange: "before_arrival",
  },
  late_checkout: {
    leadTimeHours: 24,
    needsDate: false,
    needsTime: false,
    turnover: "late_checkout",
  },
};

const nameOf = (extra: Pick<MemberExtra, "name" | "sourceLanguage">, locale: string) =>
  extra.name[locale === "en" ? "en" : "es"] ?? extra.name[extra.sourceLanguage] ?? "";

type Editing = { kind: "new"; input: ExtraInput } | { kind: "edit"; extra: MemberExtra } | null;

/**
 * A property's extras (feature 008 US1, screen H-27): suggestions when empty, the form with rules,
 * order, hide, copy to other properties, and delete. Agents see the catalog without actions (FR-005).
 */
export function PropertyExtras({ locale, propertyId }: { locale: string; propertyId: string }) {
  const t = useTranslations("extras");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [data, setData] = useState<MemberExtras | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [copying, setCopying] = useState<MemberExtra | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const lang = locale === "en" ? "en" : "es";

  const load = useCallback(async () => {
    if (!workspace) return;
    setData(await workspace.api.get<MemberExtras>(`/properties/${propertyId}/extras`));
  }, [workspace, propertyId]);

  useEffect(() => {
    void load().catch(() => setMessage({ kind: "error", text: errors("internal_error") }));
  }, [load, errors]);

  if (!workspace || !data) return null;
  const canEdit = data.canEdit;

  async function act(work: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    try {
      const done = await work();
      if (done) setMessage({ kind: "success", text: done });
    } catch (cause) {
      const code = problemOf(cause)?.code;
      if (code === "extra_changed") {
        await load();
        setEditing(null);
        setMessage({ kind: "error", text: t("changed") });
      } else {
        setMessage({
          kind: "error",
          text: code && errors.has(code) ? errors(code) : errors("internal_error"),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  const save = (input: ExtraInput) =>
    act(async () => {
      if (!editing) return null;
      if (editing.kind === "new") {
        await workspace.api.post(`/properties/${propertyId}/extras`, input);
      } else {
        await workspace.api.put(`/properties/${propertyId}/extras/${editing.extra.id}`, {
          version: editing.extra.version,
          extra: input,
        });
      }
      await load();
      setEditing(null);
      return t("saved");
    });

  const inputOf = (extra: MemberExtra): ExtraInput => ({
    sourceLanguage: extra.sourceLanguage,
    name: extra.name,
    description: extra.description,
    price: extra.price,
    currency: extra.currency,
    leadTimeHours: extra.leadTimeHours,
    weekdays: extra.weekdays,
    needsDate: extra.needsDate,
    needsTime: extra.needsTime,
    dateRange: extra.dateRange,
    maxPerStay: extra.maxPerStay,
    preApproved: extra.preApproved,
    turnover: extra.turnover,
    visible: extra.visible,
  });

  const toggle = (extra: MemberExtra) =>
    act(async () => {
      await workspace.api.put(`/properties/${propertyId}/extras/${extra.id}`, {
        version: extra.version,
        extra: { ...inputOf(extra), visible: !extra.visible },
      });
      await load();
      return t("saved");
    });

  const move = (index: number, step: -1 | 1) =>
    act(async () => {
      const ids = data.extras.map((extra) => extra.id);
      const [moved] = ids.splice(index, 1);
      ids.splice(index + step, 0, moved!);
      setData(
        await workspace.api.put<MemberExtras>(`/properties/${propertyId}/extras/order`, { ids }),
      );
      return null;
    });

  const remove = (extra: MemberExtra) => {
    if (!window.confirm(t("deleteConfirm", { name: nameOf(extra, locale) }))) return;
    void act(async () => {
      await workspace.api.delete(`/properties/${propertyId}/extras/${extra.id}`);
      await load();
      return t("deleted");
    });
  };

  const suggest = (key: Suggestion) => {
    const texts = {
      es: t(`suggestions.${key}.es`),
      en: t(`suggestions.${key}.en`),
      esDescription: t(`suggestions.${key}.esDescription`),
      enDescription: t(`suggestions.${key}.enDescription`),
    };
    setEditing({
      kind: "new",
      input: {
        ...blankExtra(lang),
        ...SUGGESTED[key],
        name: { es: texts.es, en: texts.en },
        description: { es: texts.esDescription, en: texts.enDescription },
      },
    });
  };

  const rules = (extra: MemberExtra) => {
    const parts = [t("rules.notice", { hours: extra.leadTimeHours })];
    parts.push(
      extra.weekdays.length === WEEKDAYS.length
        ? t("rules.everyDay")
        : t("rules.days", {
            days: extra.weekdays.map((day) => t(`weekdayNames.${day}`)).join(", "),
          }),
    );
    if (extra.turnover) parts.push(t(`rules.${extra.turnover}`));
    else if (extra.needsDate) {
      const kind = extra.needsTime ? t("rules.dateTime") : t("rules.date");
      parts.push(
        extra.dateRange === "before_arrival" ? `${kind}, ${t("rules.beforeArrival")}` : kind,
      );
    } else parts.push(t("rules.noDate"));
    if (!extra.turnover) parts.push(t("rules.max", { count: extra.maxPerStay }));
    if (extra.preApproved) parts.push(t("rules.preApproved"));
    return parts.join(" · ");
  };

  return (
    <section aria-labelledby={`${id}-title`} className="extras">
      <h1 id={`${id}-title`}>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {!canEdit && <p className="muted">{t("readOnly")}</p>}
      <div role="status" aria-live="polite">
        {message && (
          <p className={`alert ${message.kind === "success" ? "alert-success" : "alert-error"}`}>
            {message.text}
          </p>
        )}
      </div>

      {editing ? (
        <ExtraForm
          key={editing.kind === "edit" ? editing.extra.id : "new"}
          title={
            editing.kind === "edit"
              ? t("editTitle", { name: nameOf(editing.extra, locale) })
              : t("newTitle")
          }
          initial={
            editing.kind === "edit"
              ? { ...inputOf(editing.extra), mediaId: editing.extra.mediaId ?? null }
              : editing.input
          }
          propertyId={propertyId}
          media={editing.kind === "edit" ? editing.extra.media : null}
          busy={busy}
          onSave={(input) => void save(input)}
          onCancel={() => setEditing(null)}
        />
      ) : (
        canEdit && (
          <p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setEditing({ kind: "new", input: blankExtra(lang) })}
            >
              {t("add")}
            </button>
          </p>
        )
      )}

      {data.extras.length === 0 && !editing && (
        <div className="card">
          <p>{t("empty")}</p>
          {canEdit && (
            <>
              <h2>{t("suggestionsTitle")}</h2>
              <p className="field-hint">{t("suggestionsHint")}</p>
              <ul className="list-plain extra-suggestions">
                {SUGGESTIONS.map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => suggest(key)}
                    >
                      {t(`suggestions.${key}.${lang}`)}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {data.extras.length > 0 && (
        <ul className="list-plain extra-list">
          {data.extras.map((extra, index) => {
            const name = nameOf(extra, locale);
            return (
              <li key={extra.id} className="card extra-row">
                {extra.media ? (
                  <img
                    className="extra-thumb"
                    src={extra.media.smallUrl ?? extra.media.url}
                    alt=""
                    width={640}
                    height={360}
                    loading="lazy"
                  />
                ) : null}
                <h2>{name}</h2>
                <p>
                  {formatPrice(locale, extra.price, extra.currency, t("free"))}
                  {!extra.visible && <span className="badge badge-warning">{t("hidden")}</span>}
                </p>
                <p className="muted">{rules(extra)}</p>
                {canEdit && (
                  <div className="actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => setEditing({ kind: "edit", extra })}
                    >
                      {t("edit")}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => void toggle(extra)}
                    >
                      {extra.visible ? t("hide") : t("show")}
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || index === 0}
                      aria-label={t("moveUp", { name })}
                      onClick={() => void move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy || index === data.extras.length - 1}
                      aria-label={t("moveDown", { name })}
                      onClick={() => void move(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      disabled={busy}
                      onClick={() => setCopying(extra)}
                    >
                      {t("copy")}
                    </button>
                    <button
                      type="button"
                      className="button button-danger-quiet"
                      disabled={busy}
                      onClick={() => remove(extra)}
                    >
                      {t("delete")}
                    </button>
                  </div>
                )}
                {copying?.id === extra.id && (
                  <CopyExtra
                    extra={extra}
                    name={name}
                    propertyId={propertyId}
                    busy={busy}
                    onDone={(count) => {
                      setCopying(null);
                      setMessage({ kind: "success", text: t("copied", { count }) });
                    }}
                    onCancel={() => setCopying(null)}
                    onError={(text) => setMessage({ kind: "error", text })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Copy one extra to other properties of the workspace (FR-003). */
function CopyExtra({
  extra,
  name,
  propertyId,
  busy,
  onDone,
  onCancel,
  onError,
}: {
  extra: MemberExtra;
  name: string;
  propertyId: string;
  busy: boolean;
  onDone: (count: number) => void;
  onCancel: () => void;
  onError: (text: string) => void;
}) {
  const t = useTranslations("extras");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [others, setOthers] = useState<{ id: string; name: string }[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    workspace.api
      .get<PropertyList>("/properties?limit=100")
      .then((list) =>
        setOthers(
          list.items
            .filter((item) => item.status === "active" && item.id !== propertyId)
            .map((item) => ({ id: item.id, name: item.name })),
        ),
      )
      .catch(() => setOthers([]));
  }, [workspace, propertyId]);

  if (!workspace || others === null) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!workspace || chosen.length === 0) return;
    setSending(true);
    try {
      const result = await workspace.api.post<{ copied: number }>(
        `/properties/${propertyId}/extras/${extra.id}/copy`,
        { propertyIds: chosen },
      );
      onDone(result.copied);
    } catch {
      onError(errors("internal_error"));
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="extra-copy"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => void submit(event)}
    >
      <h3 id={`${id}-title`}>{t("copyTitle", { name })}</h3>
      {others.length === 0 ? (
        <p className="muted">{t("copyNone")}</p>
      ) : (
        <fieldset className="choices">
          <legend>{t("copyLegend")}</legend>
          {others.map((other) => (
            <label key={other.id} className="checkbox">
              <input
                type="checkbox"
                checked={chosen.includes(other.id)}
                onChange={(event) =>
                  setChosen(
                    event.target.checked
                      ? [...chosen, other.id]
                      : chosen.filter((value) => value !== other.id),
                  )
                }
              />
              {other.name}
            </label>
          ))}
        </fieldset>
      )}
      <div className="actions">
        {others.length > 0 && (
          <button
            type="submit"
            className="button button-primary"
            disabled={busy || sending || chosen.length === 0}
          >
            {t("copyConfirm")}
          </button>
        )}
        <button type="button" className="button button-secondary" onClick={onCancel}>
          {t("cancel")}
        </button>
      </div>
    </form>
  );
}
