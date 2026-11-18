"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { MemberList, Workspace, WorkspaceDeletionResponse } from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";
import { useMeContext } from "@/lib/me-context";
import { errorKey, useStepUp } from "@/lib/use-step-up";
import { AssistantCard } from "./assistant/assistant-card";

const KNOWN = [
  "forbidden",
  "not_found",
  "gone",
  "validation_failed",
  "rate_limited",
  "mfa_enrollment_required",
  "owner_must_transfer",
  "target_not_admin",
  "target_mfa_required",
  "workspace_pending_deletion",
] as const;

/** Workspace settings (FR-026, FR-027, T099): rename, transfer, leave, delete, restore. */
export function WorkspaceSettings({ locale }: { locale: string }) {
  const t = useTranslations("settings.workspace");
  const errors = useTranslations("errors");
  const context = useMeContext();
  const me = context?.me ?? null;
  const workspaceId = me?.lastWorkspaceId ?? null;
  const { run, dialog } = useStepUp();

  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [admins, setAdmins] = useState<MemberList["members"]>([]);
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void apiFetch<Workspace>(`/api/v1/workspaces/${workspaceId}`).then((ws) => {
      if (cancelled) return;
      setWorkspace(ws);
      setName(ws.name);
      if (ws.role === "owner" && ws.status === "active") {
        void apiFetch<MemberList>(`/api/v1/workspaces/${workspaceId}/members`).then((list) => {
          if (!cancelled) setAdmins(list.members.filter((m) => m.role === "admin"));
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (!me || !workspace || !workspaceId) return <p className="muted">{t("title")}…</p>;
  const base = `/api/v1/workspaces/${workspaceId}`;
  const isOwner = workspace.role === "owner";
  const canEdit = workspace.role !== "agent";
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(locale);

  async function attempt(action: () => Promise<void>) {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ kind: "error", text: errors(errorKey(error, KNOWN)) });
    }
  }

  const rename = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      const updated = await apiFetch<Workspace>(base, { method: "PATCH", body: { name } });
      setWorkspace(updated);
      await context?.refresh();
      setMessage({ kind: "info", text: t("saved") });
    });
  };

  const transfer = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      const updated = await run(() =>
        apiFetch<Workspace>(`${base}/ownership-transfer`, {
          method: "POST",
          body: { membershipId: target },
        }),
      );
      if (!updated) return;
      setWorkspace(updated);
      await context?.refresh();
      setMessage({ kind: "info", text: t("transferred") });
    });
  };

  const leave = () =>
    void attempt(async () => {
      await apiFetch(`${base}/leave`, { method: "POST" });
      await context?.refresh();
      window.location.assign(`/${locale}/start`);
    });

  const remove = (event: FormEvent) => {
    event.preventDefault();
    void attempt(async () => {
      const result = await run(() =>
        apiFetch<WorkspaceDeletionResponse>(base, { method: "DELETE", body: { confirmName } }),
      );
      if (!result) return;
      setWorkspace({ ...workspace, status: "pending_deletion", purgeAfter: result.purgeAfter });
      setMessage({ kind: "info", text: t("deleted", { date: dateOf(result.purgeAfter) }) });
    });
  };

  const restore = () =>
    void attempt(async () => {
      const restored = await run(() => apiFetch<Workspace>(`${base}/restore`, { method: "POST" }));
      if (!restored) return;
      setWorkspace(restored);
      await context?.refresh();
      setMessage({ kind: "info", text: t("restored") });
    });

  return (
    <>
      <h1>{t("title")}</h1>
      {message ? (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      ) : null}

      {workspace.status === "pending_deletion" ? (
        <section className="card danger-zone" aria-labelledby="pending-title">
          <h2 id="pending-title">{t("pendingTitle")}</h2>
          <p>
            {t("pendingBody", { date: workspace.purgeAfter ? dateOf(workspace.purgeAfter) : "—" })}
          </p>
          <button type="button" className="button button-primary" onClick={restore}>
            {t("restore")}
          </button>
        </section>
      ) : (
        <>
          <section className="card" aria-labelledby="name-title">
            <h2 id="name-title">{t("renameTitle")}</h2>
            {canEdit ? (
              <form onSubmit={rename} noValidate>
                <label htmlFor="workspace-name">{t("nameLabel")}</label>
                <input
                  id="workspace-name"
                  maxLength={80}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <button type="submit" className="button button-secondary" disabled={!name.trim()}>
                  {t("save")}
                </button>
              </form>
            ) : (
              <p className="muted">
                {workspace.name} — {t("readOnly")}
              </p>
            )}
          </section>

          <AssistantCard locale={locale} />

          {isOwner ? (
            <section className="card" aria-labelledby="transfer-title">
              <h2 id="transfer-title">{t("transferTitle")}</h2>
              <p className="muted">{t("transferBody")}</p>
              {admins.length === 0 ? (
                <p>{t("transferNone")}</p>
              ) : (
                <form onSubmit={transfer} noValidate>
                  <label htmlFor="transfer-target">{t("transferLabel")}</label>
                  <select
                    id="transfer-target"
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                  >
                    <option value="" />
                    {admins.map((admin) => (
                      <option key={admin.membershipId} value={admin.membershipId}>
                        {admin.name ? `${admin.name} · ${admin.email}` : admin.email}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="button button-secondary" disabled={!target}>
                    {t("transfer")}
                  </button>
                </form>
              )}
            </section>
          ) : null}

          <section className="card" aria-labelledby="leave-title">
            <h2 id="leave-title">{t("leaveTitle")}</h2>
            <p className="muted">{isOwner ? t("leaveOwner") : t("leaveBody")}</p>
            <button
              type="button"
              className="button button-secondary"
              disabled={isOwner}
              onClick={leave}
            >
              {t("leave")}
            </button>
          </section>

          {isOwner ? (
            <section className="card danger-zone" aria-labelledby="delete-title">
              <h2 id="delete-title">{t("deleteTitle")}</h2>
              <p className="muted">{t("deleteBody")}</p>
              <form onSubmit={remove} noValidate>
                <label htmlFor="confirm-name">{t("deleteLabel")}</label>
                <input
                  id="confirm-name"
                  autoComplete="off"
                  value={confirmName}
                  onChange={(event) => setConfirmName(event.target.value)}
                />
                <button
                  type="submit"
                  className="button button-danger"
                  disabled={confirmName.trim() !== workspace.name}
                >
                  {t("delete")}
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
      {dialog}
    </>
  );
}
