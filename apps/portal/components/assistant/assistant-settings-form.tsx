"use client";

import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type {
  AssistantGroups,
  AssistantInstructions,
  AssistantLevel,
  AssistantMember,
  PropertyAssistant,
  WorkspaceAssistant,
} from "@guidesk/contracts";
import {
  INSTRUCTIONS_MAX as INSTRUCTIONS_MAX_LENGTH,
  LEVELS as ASSISTANT_LEVELS,
  LOCKED as LOCKED_CATEGORIES,
  TOPICS as ASSISTANT_TOPICS,
} from "@/lib/assistant";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";
import { AssistantTestPanel } from "./assistant-test-panel";

type Follows = PropertyAssistant["follows"];
type GroupKey = keyof Follows;

interface FormState {
  version: number;
  groups: AssistantGroups;
  follows: Follows | null;
  instructions: string;
  saved: AssistantInstructions | null;
  workspace: (AssistantGroups & { instructions: AssistantInstructions | null }) | null;
  members: AssistantMember[];
  canEdit: boolean;
  timeZone: string | null;
  hasPublishedGuide: boolean;
}

const ALL_FOLLOW: Follows = { autonomy: true, tone: true, quietHours: true, contacts: true };

function fromWorkspace(data: WorkspaceAssistant): FormState {
  return {
    version: data.version,
    groups: {
      autonomy: data.autonomy,
      tone: data.tone,
      quietHours: data.quietHours,
      contacts: data.contacts,
    },
    follows: null,
    instructions: data.instructions?.text ?? "",
    saved: data.instructions,
    workspace: null,
    members: data.members,
    canEdit: data.canEdit,
    timeZone: null,
    hasPublishedGuide: false,
  };
}

function fromProperty(data: PropertyAssistant): FormState {
  return {
    version: data.version,
    groups: data.own,
    follows: data.follows,
    instructions: data.instructions?.text ?? "",
    saved: data.instructions,
    workspace: data.workspace,
    members: data.members,
    canEdit: data.canEdit,
    timeZone: data.timeZone,
    hasPublishedGuide: data.hasPublishedGuide,
  };
}

/**
 * The assistant's settings (feature 007 US1, US3, US4, screen H-26): autonomy per topic with the
 * mandatory categories locked, tone, quiet hours, escalation contacts, and custom instructions, for
 * the workspace or for one property (each group follows the workspace or has its own values). Owners
 * and admins save; agents read. A save based on old values reloads them (FR-016).
 */
export function AssistantSettingsForm({
  locale,
  propertyId,
}: {
  locale: string;
  propertyId?: string;
}) {
  const t = useTranslations("assistant");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const id = useId();
  const [state, setState] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const path = propertyId ? `/properties/${propertyId}/assistant` : "/assistant";

  const load = useCallback(async () => {
    if (!workspace) return;
    try {
      setState(
        propertyId
          ? fromProperty(await workspace.api.get<PropertyAssistant>(path))
          : fromWorkspace(await workspace.api.get<WorkspaceAssistant>(path)),
      );
    } catch (cause) {
      setMessage({
        kind: "error",
        text: errors(problemOf(cause)?.code === "not_found" ? "not_found" : "internal_error"),
      });
    }
  }, [workspace, path, propertyId, errors]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!workspace || !state) {
    return message ? (
      <p className="alert alert-error" role="alert">
        {message.text}
      </p>
    ) : null;
  }

  const editable = state.canEdit && !busy;
  const follows = state.follows;
  const following = (group: GroupKey) => follows?.[group] ?? false;
  /** The values shown for a group: the workspace's while the property follows it. */
  const shown = <K extends GroupKey>(group: K): AssistantGroups[K] =>
    following(group) && state.workspace ? state.workspace[group] : state.groups[group];

  const setGroup = <K extends GroupKey>(group: K, value: AssistantGroups[K]) =>
    setState((current) =>
      current ? { ...current, groups: { ...current.groups, [group]: value } } : current,
    );
  const setFollow = (group: GroupKey, value: boolean) =>
    setState((current) => {
      if (!current?.follows) return current;
      // Unfollowing starts from the workspace's values the first time (research R14).
      const groups =
        !value && current.workspace && current.version === 0
          ? { ...current.groups, [group]: current.workspace[group] }
          : current.groups;
      return { ...current, groups, follows: { ...current.follows, [group]: value } };
    });

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!workspace || !state) return;
    setBusy(true);
    setMessage(null);
    setIssues([]);
    try {
      const body = propertyId
        ? {
            version: state.version,
            follows: state.follows ?? ALL_FOLLOW,
            own: state.groups,
            instructions: state.instructions,
          }
        : { version: state.version, ...state.groups, instructions: state.instructions };
      const saved = propertyId
        ? fromProperty(await workspace.api.put<PropertyAssistant>(path, body))
        : fromWorkspace(await workspace.api.put<WorkspaceAssistant>(path, body));
      setState(saved);
      setMessage({ kind: "success", text: t("saved") });
    } catch (cause) {
      const problem = problemOf(cause);
      const code = problem?.code;
      if (code === "settings_changed") {
        await load();
        setMessage({ kind: "error", text: t("conflict") });
      } else if (code === "instructions_invalid") {
        setIssues(Array.isArray(problem?.issues) ? (problem.issues as string[]) : []);
        setMessage({ kind: "error", text: t("instructions.issuesIntro") });
      } else if (code === "time_zone_required") {
        setMessage({ kind: "error", text: t("quiet.noZone") });
      } else {
        setMessage({ kind: "error", text: errors("internal_error") });
      }
    } finally {
      setBusy(false);
    }
  }

  const followBox = (group: GroupKey) =>
    follows ? (
      <label className="checkbox">
        <input
          type="checkbox"
          checked={following(group)}
          disabled={!editable}
          onChange={(event) => setFollow(group, event.target.checked)}
        />
        {t("follow")}
      </label>
    ) : null;

  const autonomy = shown("autonomy");
  const tone = shown("tone");
  const quiet = shown("quietHours");
  const contacts = shown("contacts");
  const quietLocked = !editable || following("quietHours");
  const quietInvalid = quiet.enabled && (!quiet.start || !quiet.end || quiet.start === quiet.end);
  const chosen = new Set(contacts.mode === "selected" ? contacts.memberIds : []);
  const length = [...state.instructions].length;

  return (
    <>
      <form className="assistant-settings" onSubmit={(event) => void save(event)} noValidate>
        <h1>{propertyId ? t("propertyTitle") : t("title")}</h1>
        <p className="muted">{propertyId ? t("propertyBody") : t("workspaceBody")}</p>
        {!state.canEdit && <p className="muted">{t("readOnly")}</p>}

        <section className="card" aria-labelledby={`${id}-autonomy`}>
          <h2 id={`${id}-autonomy`}>{t("autonomy.title")}</h2>
          <p className="muted">{t("autonomy.body")}</p>
          {followBox("autonomy")}
          <ul className="list-plain level-help">
            {ASSISTANT_LEVELS.map((level) => (
              <li key={level}>
                <strong>{t(`autonomy.levels.${level}`)}:</strong> {t(`autonomy.help.${level}`)}
              </li>
            ))}
          </ul>
          <div className="topic-rows">
            {ASSISTANT_TOPICS.map((topic) => (
              <div className="topic-row" key={topic}>
                <label htmlFor={`${id}-topic-${topic}`}>{t(`autonomy.topics.${topic}`)}</label>
                <select
                  id={`${id}-topic-${topic}`}
                  value={autonomy[topic]}
                  disabled={!editable || following("autonomy")}
                  onChange={(event) =>
                    setGroup("autonomy", {
                      ...state.groups.autonomy,
                      [topic]: event.target.value as AssistantLevel,
                    })
                  }
                >
                  {ASSISTANT_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {t(`autonomy.levels.${level}`)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <h3>{t("autonomy.locked")}</h3>
          <ul className="locked-list">
            {LOCKED_CATEGORIES.map((category) => (
              <li key={category}>
                <span aria-hidden="true">🔒 </span>
                {t(`autonomy.lockedItems.${category}`)}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby={`${id}-tone`}>
          <h2 id={`${id}-tone`}>{t("tone.title")}</h2>
          <p className="muted">{t("tone.body")}</p>
          {followBox("tone")}
          <fieldset className="choices" disabled={!editable || following("tone")}>
            <legend className="visually-hidden">{t("tone.title")}</legend>
            {(["casual", "formal"] as const).map((option) => (
              <label key={option} className="choice">
                <input
                  type="radio"
                  name={`${id}-tone`}
                  value={option}
                  checked={tone === option}
                  onChange={() => setGroup("tone", option)}
                />
                {t(`tone.${option}`)}
              </label>
            ))}
          </fieldset>
        </section>

        <section className="card" aria-labelledby={`${id}-quiet`}>
          <h2 id={`${id}-quiet`}>{t("quiet.title")}</h2>
          <p className="muted">{t("quiet.body")}</p>
          {followBox("quietHours")}
          <p className="field-hint">
            {propertyId
              ? state.timeZone
                ? t("quiet.zone", { zone: state.timeZone })
                : t("quiet.noZone")
              : t("quiet.zoneWorkspace")}
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={quiet.enabled}
              disabled={quietLocked}
              onChange={(event) =>
                setGroup("quietHours", {
                  enabled: event.target.checked,
                  start: state.groups.quietHours.start ?? "22:00",
                  end: state.groups.quietHours.end ?? "07:00",
                })
              }
            />
            {t("quiet.enable")}
          </label>
          {quiet.enabled && (
            <div className="field-row">
              <div>
                <label htmlFor={`${id}-quiet-start`}>{t("quiet.start")}</label>
                <input
                  id={`${id}-quiet-start`}
                  type="time"
                  value={quiet.start ?? ""}
                  disabled={quietLocked}
                  aria-describedby={quietInvalid ? `${id}-quiet-error` : undefined}
                  onChange={(event) =>
                    setGroup("quietHours", {
                      ...state.groups.quietHours,
                      start: event.target.value,
                    })
                  }
                />
              </div>
              <div>
                <label htmlFor={`${id}-quiet-end`}>{t("quiet.end")}</label>
                <input
                  id={`${id}-quiet-end`}
                  type="time"
                  value={quiet.end ?? ""}
                  disabled={quietLocked}
                  aria-describedby={quietInvalid ? `${id}-quiet-error` : undefined}
                  onChange={(event) =>
                    setGroup("quietHours", { ...state.groups.quietHours, end: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          {quietInvalid && (
            <span id={`${id}-quiet-error`} className="field-error">
              {t("quiet.same")}
            </span>
          )}
        </section>

        <section className="card" aria-labelledby={`${id}-contacts`}>
          <h2 id={`${id}-contacts`}>{t("contacts.title")}</h2>
          <p className="muted">{t("contacts.body")}</p>
          {followBox("contacts")}
          <fieldset className="choices" disabled={!editable || following("contacts")}>
            <legend className="visually-hidden">{t("contacts.title")}</legend>
            <label className="choice">
              <input
                type="radio"
                name={`${id}-contacts`}
                checked={contacts.mode === "all"}
                onChange={() => setGroup("contacts", { mode: "all" })}
              />
              {t("contacts.all")}
            </label>
            <label className="choice">
              <input
                type="radio"
                name={`${id}-contacts`}
                checked={contacts.mode === "selected"}
                onChange={() => setGroup("contacts", { mode: "selected", memberIds: [] })}
              />
              {t("contacts.selected")}
            </label>
          </fieldset>
          {contacts.mode === "selected" && (
            <>
              <p className="field-hint">{t("contacts.chosen", { count: chosen.size })}</p>
              <ul className="choice-list">
                {state.members.map((member) => (
                  <li key={member.id}>
                    <label className="checkbox">
                      <input
                        type="checkbox"
                        checked={chosen.has(member.id)}
                        disabled={!editable || following("contacts")}
                        onChange={(event) => {
                          const next = new Set(chosen);
                          if (event.target.checked) next.add(member.id);
                          else next.delete(member.id);
                          setGroup("contacts", { mode: "selected", memberIds: [...next] });
                        }}
                      />
                      {member.name}
                      <span className="badge">{t(`contacts.roles.${member.role}`)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="field-hint">{t("contacts.emergencyNote")}</p>
        </section>

        <section className="card" aria-labelledby={`${id}-instructions`}>
          <h2 id={`${id}-instructions`}>{t("instructions.title")}</h2>
          <p className="muted">{t("instructions.body")}</p>
          {propertyId && (
            <p className="field-hint">
              {t("instructions.propertyNote")}{" "}
              {state.workspace?.instructions &&
                t("instructions.workspaceText", { text: state.workspace.instructions.text })}
            </p>
          )}
          <label htmlFor={`${id}-instructions-text`}>{t("instructions.label")}</label>
          <textarea
            id={`${id}-instructions-text`}
            rows={4}
            maxLength={INSTRUCTIONS_MAX_LENGTH}
            value={state.instructions}
            placeholder={t("instructions.placeholder")}
            disabled={!editable}
            aria-describedby={`${id}-instructions-counter`}
            onChange={(event) => setState({ ...state, instructions: event.target.value })}
          />
          <span id={`${id}-instructions-counter`} className="field-hint">
            {t("instructions.counter", { count: length })}
          </span>
          {state.saved && (
            <p className="field-hint">
              {state.saved.updatedBy
                ? t("instructions.updated", {
                    date: new Date(state.saved.updatedAt).toLocaleDateString(locale, {
                      dateStyle: "medium",
                    }),
                    name: state.saved.updatedBy,
                  })
                : t("instructions.updatedNoName", {
                    date: new Date(state.saved.updatedAt).toLocaleDateString(locale, {
                      dateStyle: "medium",
                    }),
                  })}
            </p>
          )}
          {issues.length > 0 && (
            <ul className="field-error">
              {issues.map((issue) => (
                <li key={issue}>{t(`instructions.issues.${issue}`)}</li>
              ))}
            </ul>
          )}
        </section>

        {message && (
          <p
            className={`alert ${message.kind === "error" ? "alert-error" : "alert-success"}`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
        {state.canEdit && (
          <div className="actions">
            <button type="submit" className="button button-primary" disabled={busy || quietInvalid}>
              {busy ? t("saving") : t("save")}
            </button>
          </div>
        )}
      </form>
      {propertyId && (
        <AssistantTestPanel
          locale={locale}
          propertyId={propertyId}
          hasPublishedGuide={state.hasPublishedGuide}
        />
      )}
    </>
  );
}
