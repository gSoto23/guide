"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Invitation, InvitationList, MemberList } from "@guidesk/contracts";
import { ApiError, apiFetch } from "@/lib/api";
import type { StepUpMethod } from "@/lib/step-up";
import { useMe } from "@/lib/use-me";
import { useStepUp } from "@/lib/use-step-up";
import { StepUpDialog } from "./step-up-dialog";

const KNOWN_ERRORS = new Set([
  "forbidden",
  "mfa_enrollment_required",
  "not_found",
  "gone",
  "validation_failed",
  "rate_limited",
  "seat_limit_reached",
  "already_member",
  "already_invited",
  "idempotency_conflict",
  "workspace_pending_deletion",
]);

/** Team members and invitations for owners and admins (FR-016, FR-018, T077). */
export function MembersSettings({ locale }: { locale: string }) {
  const t = useTranslations("team");
  const errors = useTranslations("errors");
  const plan = useTranslations("plan");
  const me = useMe(locale);
  const workspaceId = me?.lastWorkspaceId ?? null;
  const role = me?.memberships.find((m) => m.workspaceId === workspaceId)?.role ?? null;
  const canManage = role === "owner" || role === "admin";

  const [members, setMembers] = useState<MemberList["members"]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [seats, setSeats] = useState<InvitationList["seats"] | null>(null);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "agent">("agent");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [stepUp, setStepUp] = useState<{ methods: StepUpMethod[]; retry: () => void } | null>(null);

  const base = workspaceId ? `/api/v1/workspaces/${workspaceId}` : null;
  const memberActions = useStepUp();

  const refresh = useCallback(async () => {
    if (!base) return;
    const [memberList, invitationList] = await Promise.all([
      apiFetch<MemberList>(`${base}/members`),
      apiFetch<InvitationList>(`${base}/invitations`),
    ]);
    setMembers(memberList.members);
    setInvitations(invitationList.invitations);
    setSeats(invitationList.seats);
  }, [base]);

  useEffect(() => {
    if (canManage) void refresh().catch(() => undefined);
  }, [canManage, refresh]);

  function showError(error: unknown) {
    const code = error instanceof ApiError ? error.problem.code : "internal_error";
    setMessage({ kind: "error", text: errors(KNOWN_ERRORS.has(code) ? code : "internal_error") });
  }

  /** Inviting needs a recent re-authentication: ask for it, then retry once (FR-011). */
  async function sendInvitation(idempotencyKey: string) {
    if (!base) return;
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch<Invitation>(`${base}/invitations`, {
        method: "POST",
        body: { email, role: inviteRole },
        headers: { "idempotency-key": idempotencyKey },
      });
      setMessage({ kind: "info", text: t("sent", { email: email.trim().toLowerCase() }) });
      setEmail("");
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.problem.code === "step_up_required") {
        setStepUp({
          methods: (error.problem.methods ?? ["email_otp"]) as StepUpMethod[],
          retry: () => void sendInvitation(idempotencyKey),
        });
      } else {
        showError(error);
      }
    } finally {
      setBusy(false);
    }
  }

  function invite(event: FormEvent) {
    event.preventDefault();
    void sendInvitation(crypto.randomUUID());
  }

  async function act(invitation: Invitation, action: "resend" | "revoke") {
    if (!base) return;
    setMessage(null);
    try {
      if (action === "resend") {
        await apiFetch(`${base}/invitations/${invitation.id}/resend`, { method: "POST" });
        setMessage({ kind: "info", text: t("resent") });
      } else {
        await apiFetch(`${base}/invitations/${invitation.id}`, { method: "DELETE" });
        setMessage({ kind: "info", text: t("revoked") });
      }
      await refresh();
    } catch (error) {
      showError(error);
    }
  }

  /** Role change and removal need a recent re-authentication (FR-025, FR-011). */
  async function manage(
    member: MemberList["members"][number],
    action: "promote" | "demote" | "remove",
  ) {
    if (!base) return;
    const name = member.name || member.email;
    if (action === "remove" && !window.confirm(t("removeConfirm", { name }))) return;
    setMessage(null);
    try {
      const done = await memberActions.run(() =>
        action === "remove"
          ? apiFetch(`${base}/members/${member.membershipId}`, { method: "DELETE" }).then(
              () => true,
            )
          : apiFetch(`${base}/members/${member.membershipId}`, {
              method: "PATCH",
              body: { role: action === "promote" ? "admin" : "agent" },
            }).then(() => true),
      );
      if (!done) return;
      setMessage({
        kind: "info",
        text:
          action === "remove"
            ? t("removed", { name })
            : t("roleChanged", {
                name,
                role: t(`roles.${action === "promote" ? "admin" : "agent"}`),
              }),
      });
      await refresh();
    } catch (error) {
      showError(error);
    }
  }

  if (!me) return <p className="muted">{t("loading")}</p>;

  return (
    <>
      <h1>{t("title")}</h1>
      {!canManage ? (
        <p className="alert alert-info" role="status">
          {t("notAllowed")}
        </p>
      ) : (
        <>
          <section className="card" aria-labelledby="invite-title">
            <h2 id="invite-title">{t("inviteTitle")}</h2>
            {seats ? (
              <p className="muted">
                {seats.limit === null
                  ? t("seatsUnlimited", { used: seats.used })
                  : t("seats", { used: seats.used, limit: seats.limit })}{" "}
                <Link href={`/${locale}/settings/plan`}>{plan("link")}</Link>
              </p>
            ) : null}
            <form onSubmit={invite} noValidate>
              <label htmlFor="invite-email">{t("emailLabel")}</label>
              <input
                id="invite-email"
                type="email"
                inputMode="email"
                autoComplete="off"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <fieldset className="choices">
                <legend>{t("roleLabel")}</legend>
                {(["agent", "admin"] as const).map((option) => (
                  <label key={option} className="choice">
                    <input
                      type="radio"
                      name="invite-role"
                      value={option}
                      checked={inviteRole === option}
                      onChange={() => setInviteRole(option)}
                    />
                    <span>
                      <strong>{t(`roles.${option}`)}</strong> — {t(`roleHelp.${option}`)}
                    </span>
                  </label>
                ))}
              </fieldset>
              <button
                type="submit"
                className="button button-primary"
                disabled={busy || !email.includes("@")}
              >
                {busy ? t("sending") : t("send")}
              </button>
            </form>
          </section>

          {message ? (
            <p
              className={`alert ${message.kind === "error" ? "alert-error" : "alert-info"}`}
              role={message.kind === "error" ? "alert" : "status"}
            >
              {message.text}
              {message.kind === "error" && message.text === errors("mfa_enrollment_required") ? (
                <>
                  {" "}
                  <Link href={`/${locale}/settings/security`}>{t("securityLink")}</Link>
                </>
              ) : null}
            </p>
          ) : null}

          <section className="card" aria-labelledby="members-title">
            <h2 id="members-title">{t("membersTitle")}</h2>
            <ul>
              {members.map((member) => (
                <li key={member.membershipId}>
                  {member.name ? `${member.name} · ` : ""}
                  {member.email}
                  {member.userId === me.user.id ? ` (${t("you")})` : ""} ·{" "}
                  {t(`roles.${member.role}`)}
                  {member.role !== "owner" && member.userId !== me.user.id ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() =>
                          void manage(member, member.role === "agent" ? "promote" : "demote")
                        }
                      >
                        {member.role === "agent" ? t("makeAdmin") : t("makeAgent")}
                      </button>
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() => void manage(member, "remove")}
                      >
                        {t("remove")}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="card" aria-labelledby="invitations-title">
            <h2 id="invitations-title">{t("invitationsTitle")}</h2>
            {invitations.length === 0 ? <p className="muted">{t("noInvitations")}</p> : null}
            <ul>
              {invitations.map((invitation) => (
                <li key={invitation.id}>
                  {invitation.email} · {t(`roles.${invitation.role}`)} ·{" "}
                  {t(`status.${invitation.status}`)}
                  {invitation.status === "pending" ? (
                    <>
                      {" · "}
                      {t("expires", {
                        date: new Date(invitation.expiresAt).toLocaleDateString(locale),
                      })}{" "}
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() => void act(invitation, "resend")}
                      >
                        {t("resend")}
                      </button>
                      <button
                        type="button"
                        className="button button-link"
                        onClick={() => void act(invitation, "revoke")}
                      >
                        {t("revoke")}
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      <p>
        <Link href={`/${locale}/settings/security`}>{t("securityLink")}</Link>
      </p>

      {memberActions.dialog}
      {stepUp ? (
        <StepUpDialog
          methods={stepUp.methods}
          onCancel={() => setStepUp(null)}
          onDone={() => {
            const { retry } = stepUp;
            setStepUp(null);
            retry();
          }}
        />
      ) : null}
    </>
  );
}
