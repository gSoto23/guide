"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { AcceptInvitationResponse, InvitationPreview, MeResponse } from "@guidesk/contracts";
import { ApiError, apiFetch } from "@/lib/api";
import { loadAuthClient } from "@/lib/auth-client";
import { rememberReturnTo } from "@/lib/sign-in-email";

type View =
  | { kind: "loading" }
  | { kind: "gone" }
  | { kind: "signed-out"; preview: InvitationPreview }
  | { kind: "ready"; preview: InvitationPreview }
  | { kind: "mismatch"; preview: InvitationPreview }
  | { kind: "accepted"; preview: InvitationPreview; role: AcceptInvitationResponse["role"] };

/** Invitation tokens are 32 random bytes in base64url (invitation-token.ts in the API). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Opens an invitation link: sign in with the invited email, then accept (FR-019, T078). */
export function InvitationAccept({ locale, token }: { locale: string; token: string }) {
  const t = useTranslations("invite");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      // Anything else in the link never reaches the API as a path (T103).
      if (!TOKEN_PATTERN.test(token)) {
        setView({ kind: "gone" });
        return;
      }
      let preview: InvitationPreview;
      try {
        preview = await apiFetch<InvitationPreview>(
          `/api/v1/invitations/${encodeURIComponent(token)}`,
        );
      } catch {
        if (!cancelled) setView({ kind: "gone" });
        return;
      }
      const signedIn = await apiFetch<MeResponse>("/api/v1/me").then(
        () => true,
        () => false,
      );
      if (!cancelled) setView({ kind: signedIn ? "ready" : "signed-out", preview });
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  function continueToSignIn() {
    rememberReturnTo(`/${locale}/invite/${token}`);
    router.push(`/${locale}/sign-in`);
  }

  async function accept(preview: InvitationPreview) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<AcceptInvitationResponse>(
        `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
        { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } },
      );
      setView({ kind: "accepted", preview, role: result.role });
    } catch (failure) {
      const code = failure instanceof ApiError ? failure.problem.code : "internal_error";
      if (code === "email_mismatch") setView({ kind: "mismatch", preview });
      else if (code === "gone") setView({ kind: "gone" });
      else setError(errors(code === "rate_limited" ? "rate_limited" : "internal_error"));
    } finally {
      setBusy(false);
    }
  }

  async function signOut(preview: InvitationPreview) {
    await (await loadAuthClient()).signOut();
    setView({ kind: "signed-out", preview });
  }

  if (view.kind === "loading") return <p className="muted">{t("loading")}</p>;
  if (view.kind === "gone") {
    return (
      <p className="alert alert-error" role="alert">
        {t("gone")}
      </p>
    );
  }

  const { preview } = view;
  const role = t(`roles.${preview.role}`);
  // Only the workspace name when the email doesn't match (AC-SEC-002).
  if (view.kind === "mismatch") {
    return (
      <>
        <p className="alert alert-error" role="alert">
          {t("mismatch", { workspace: preview.workspaceName })}
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void signOut(preview)}
        >
          {t("signOut")}
        </button>
      </>
    );
  }

  return (
    <>
      <h1>{t("title", { workspace: preview.workspaceName })}</h1>
      <p className="muted">
        {preview.inviterName
          ? t("body", { inviter: preview.inviterName, role })
          : t("bodyNoInviter", { role })}
      </p>
      {view.kind === "signed-out" ? (
        <>
          <p>{t("signInToAccept")}</p>
          <button type="button" className="button button-primary" onClick={continueToSignIn}>
            {t("continue")}
          </button>
        </>
      ) : null}
      {view.kind === "ready" ? (
        <button
          type="button"
          className="button button-primary"
          disabled={busy}
          onClick={() => void accept(preview)}
        >
          {busy ? t("accepting") : t("accept")}
        </button>
      ) : null}
      {view.kind === "accepted" ? (
        <>
          <p className="alert alert-info" role="status">
            {t("accepted", { workspace: preview.workspaceName })}
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() =>
              router.push(view.role === "agent" ? `/${locale}` : `/${locale}/settings/members`)
            }
          >
            {view.role === "agent" ? t("goHome") : t("goToTeam")}
          </button>
        </>
      ) : null}
      {error ? (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}
