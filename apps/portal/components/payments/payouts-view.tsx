"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { PayoutOnboarding, Payouts } from "@guidesk/contracts";
import { formatMoney } from "@/lib/payments";
import { problemOf } from "@/lib/properties-api";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * Payouts (feature 013 US2 and US3; screen H-33): whether guests can pay online, the payout account
 * at the provider and its state, the platform fee, how fees work, and this month's totals. Only the
 * owner starts or resumes onboarding; identity and bank checks happen at the provider.
 */
export function PayoutsView({ locale }: { locale: string }) {
  const t = useTranslations("payments");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const [payouts, setPayouts] = useState<Payouts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = workspace?.api ?? null;

  useEffect(() => {
    if (!api) return;
    const controller = new AbortController();
    api
      .get<Payouts>("/payouts", controller.signal)
      .then(setPayouts)
      .catch(() => {
        if (!controller.signal.aborted) setError(errors("internal_error"));
      });
    return () => controller.abort();
  }, [api, errors]);

  async function start() {
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const { onboardingUrl } = await api.post<PayoutOnboarding>(
        `/payouts/onboarding?lang=${locale === "en" ? "en" : "es"}`,
      );
      window.location.assign(onboardingUrl);
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setError(code === "payments_off" ? t("off") : errors("internal_error"));
      setBusy(false);
    }
  }

  if (!payouts) {
    return (
      <>
        <h1>{t("title")}</h1>
        {error ? (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        ) : (
          <p className="muted">{t("loading")}</p>
        )}
      </>
    );
  }

  const status = payouts.account?.status ?? "none";
  return (
    <>
      <h1>{t("title")}</h1>
      <p className="muted">{t("intro")}</p>
      {payouts.mode === "off" ? (
        <p className="alert alert-info" role="status">
          {t("off")}
        </p>
      ) : (
        <section className="card" aria-labelledby="payouts-account">
          <h2 id="payouts-account">{t("accountTitle")}</h2>
          {payouts.mode === "simulated" && <p className="muted">{t("simulated")}</p>}
          <p>
            <strong>{t(`account.${status}`)}</strong>
          </p>
          <p className="muted">{t(`accountHint.${status}`)}</p>
          {payouts.canManage && status !== "active" ? (
            <button
              type="button"
              className="button button-primary"
              disabled={busy}
              onClick={() => void start()}
            >
              {status === "none" ? t("setUp") : t("resume")}
            </button>
          ) : status !== "active" ? (
            <p className="muted">{t("ownerOnly")}</p>
          ) : null}
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}
      <section className="card" aria-labelledby="payouts-fees">
        <h2 id="payouts-fees">{t("feesTitle")}</h2>
        <p>
          {t("fee", {
            percent: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
              payouts.feePercent,
            ),
          })}{" "}
          {payouts.feeSource === "custom" ? t("feeCustom") : t("feePlan")}
        </p>
        <p className="muted">{t("feesHow")}</p>
      </section>
      <section className="card" aria-labelledby="payouts-month">
        <h2 id="payouts-month">{t("monthTitle")}</h2>
        {payouts.month.length === 0 ? (
          <p className="muted">{t("monthEmpty")}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <caption>{t("monthCaption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("columns.currency")}</th>
                  <th scope="col">{t("columns.orders")}</th>
                  <th scope="col">{t("columns.paid")}</th>
                  <th scope="col">{t("columns.refunded")}</th>
                  <th scope="col">{t("columns.platformFee")}</th>
                  <th scope="col">{t("columns.providerFee")}</th>
                  <th scope="col">{t("columns.hostShare")}</th>
                </tr>
              </thead>
              <tbody>
                {payouts.month.map((row) => (
                  <tr key={row.currency}>
                    <th scope="row">{row.currency}</th>
                    <td>{row.orders}</td>
                    <td>{formatMoney(locale, row.paidMinor, row.currency)}</td>
                    <td>{formatMoney(locale, row.refundedMinor, row.currency)}</td>
                    <td>{formatMoney(locale, row.platformFeeMinor, row.currency)}</td>
                    <td>{formatMoney(locale, row.providerFeeMinor, row.currency)}</td>
                    <td>{formatMoney(locale, row.hostShareMinor, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
