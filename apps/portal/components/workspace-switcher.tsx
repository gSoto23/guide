"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { MeResponse, Workspace } from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";

/**
 * Workspace switcher (FR-022, T085): the current workspace is always visible, and switching takes
 * two taps (open, pick). Creating a workspace switches to it (FR-023).
 */
export function WorkspaceSwitcher({
  me,
  onChanged,
}: {
  me: MeResponse;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("workspace");
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current =
    me.memberships.find((m) => m.workspaceId === me.lastWorkspaceId) ?? me.memberships[0];

  async function choose(workspaceId: string) {
    setError(null);
    if (workspaceId === current?.workspaceId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      await apiFetch("/api/v1/me/current-workspace", { method: "PUT", body: { workspaceId } });
      await onChanged();
      setOpen(false);
    } catch {
      setError(t("switchFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch<Workspace>("/api/v1/workspaces", { method: "POST", body: { name } });
      await onChanged();
      setName("");
      setCreating(false);
      setOpen(false);
    } catch {
      setError(t("switchFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="switcher">
      <button
        type="button"
        className="switcher-current"
        aria-expanded={open}
        aria-controls="workspace-list"
        aria-label={`${t("switchLabel")}: ${current?.workspaceName ?? ""}`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="switcher-name" data-testid="current-workspace">
          {current?.workspaceName ?? t("none")}
        </span>
        {current ? <span className="switcher-role">{t(`roles.${current.role}`)}</span> : null}
        <span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id="workspace-list" className="switcher-menu card">
          <h2 className="switcher-title">{t("listTitle")}</h2>
          <ul>
            {me.memberships.map((membership) => (
              <li key={membership.workspaceId}>
                <button
                  type="button"
                  className="switcher-option"
                  aria-current={
                    membership.workspaceId === current?.workspaceId ? "true" : undefined
                  }
                  disabled={busy}
                  onClick={() => void choose(membership.workspaceId)}
                >
                  <span>{membership.workspaceName}</span>
                  <span className="switcher-role">
                    {t(`roles.${membership.role}`)}
                    {membership.status === "pending_deletion" ? ` · ${t("pendingDeletion")}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {creating ? (
            <form onSubmit={create} noValidate>
              <label htmlFor="new-workspace">{t("nameLabel")}</label>
              <input
                id="new-workspace"
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || name.trim().length === 0}
              >
                {busy ? t("creating") : t("createSubmit")}
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setCreating(true)}
            >
              {t("create")}
            </button>
          )}
          {error ? (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
