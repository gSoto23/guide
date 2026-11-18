"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import type { PushStatus } from "@guidesk/contracts";
import { apiFetch } from "@/lib/api";
import {
  currentSubscription,
  deviceLabel,
  pushSupport,
  rememberedSubscriptionId,
  rememberSubscriptionId,
  subscribe,
} from "@/lib/push";

type State =
  "loading" | "unavailable" | "unsupported" | "ios-home-screen" | "blocked" | "off" | "on";

/** Web push on this device (feature 006 US4, FR-015): turn on, test, turn off. Email always arrives. */
export function AlertsCard({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("alerts");
  const errors = useTranslations("errors");
  const id = useId();
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const loaded = await apiFetch<PushStatus>("/api/v1/me/push");
      setStatus(loaded);
      if (!loaded.available) return setState("unavailable");
      const support = pushSupport();
      if (support !== "supported") return setState(support);
      if (Notification.permission === "denied") return setState("blocked");
      setState((await currentSubscription()) ? "on" : "off");
    } catch {
      setState("unavailable");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function enable() {
    if (!status?.publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await subscribe(status.publicKey);
      if (subscription === "blocked") {
        setState("blocked");
        return;
      }
      const json = subscription.toJSON() as {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      };
      const created = await apiFetch<{ id: string }>("/api/v1/me/push/subscriptions", {
        method: "POST",
        body: { endpoint: json.endpoint, keys: json.keys, device: deviceLabel() },
      });
      rememberSubscriptionId(created.id);
      setState("on");
      setMessage({ kind: "success", text: t("enabled") });
      await load();
    } catch {
      setMessage({ kind: "error", text: errors("internal_error") });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const subscription = await currentSubscription();
      await subscription?.unsubscribe();
      const remembered = rememberedSubscriptionId();
      if (remembered) {
        await apiFetch(`/api/v1/me/push/subscriptions/${remembered}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
      rememberSubscriptionId(null);
      setState("off");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      await apiFetch("/api/v1/me/push/test", { method: "POST" });
      setMessage({ kind: "success", text: t("tested") });
    } catch {
      setMessage({ kind: "error", text: errors("rate_limited") });
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return null;
  // In the inbox, the banner shows only when this device could have alerts but doesn't.
  if (compact) {
    if (state !== "off" && state !== "ios-home-screen" && state !== "blocked") return null;
    return (
      <p className="alert alert-info" role="status">
        {state === "ios-home-screen" ? t("ios") : state === "blocked" ? t("blocked") : t("banner")}{" "}
        {state === "off" && (
          <button
            type="button"
            className="link-button"
            onClick={() => void enable()}
            disabled={busy}
          >
            {t("bannerLink")}
          </button>
        )}
      </p>
    );
  }

  return (
    <section className="card" aria-labelledby={`${id}-title`} id="alerts">
      <h2 id={`${id}-title`}>{t("title")}</h2>
      <p className="muted">{t("body")}</p>
      {state === "unavailable" && <p>{t("unavailable")}</p>}
      {state === "unsupported" && <p>{t("unsupported")}</p>}
      {state === "ios-home-screen" && <p>{t("ios")}</p>}
      {state === "blocked" && <p>{t("blocked")}</p>}
      {status && status.available && (
        <p className="field-hint">{t("devices", { count: status.devices.length })}</p>
      )}
      {message && (
        <p
          className={`alert ${message.kind === "error" ? "alert-error" : "alert-success"}`}
          role={message.kind === "error" ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      <div className="actions">
        {state === "off" && (
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={() => void enable()}
          >
            {t("enable")}
          </button>
        )}
        {state === "on" && (
          <>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void test()}
            >
              {t("test")}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void disable()}
            >
              {t("disable")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
