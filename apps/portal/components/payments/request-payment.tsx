"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { RequestPayment as Payment } from "@guidesk/contracts";
import { formatMoney } from "@/lib/payments";

type Panel = typeof import("./refund-panel").RefundPanel;

/**
 * A request's payment on the Requests screen (feature 013 FR-019): its state, the amounts and fees,
 * a "refund due" warning, and refunds for owners and admins.
 */
export function RequestPayment({
  locale,
  payment,
  canRefund,
  onChange,
}: {
  locale: string;
  payment: Payment;
  canRefund: boolean;
  onChange: (payment: Payment) => void;
}) {
  const t = useTranslations("payments");
  const [refunding, setRefunding] = useState(false);
  // Loaded only when a member opens a refund, so the Requests route stays small (150 KB).
  const [RefundPanel, setPanel] = useState<Panel | null>(null);
  useEffect(() => {
    if (!refunding || RefundPanel) return;
    void import("./refund-panel").then((module) => setPanel(() => module.RefundPanel));
  }, [refunding, RefundPanel]);
  const money = (minor: number) => formatMoney(locale, minor, payment.currency);
  const refundable =
    canRefund && (payment.state === "paid" || payment.state === "partially_refunded");
  return (
    <div className="request-payment">
      <p>
        <strong>{t(`states.${payment.state}`)}</strong>
        {" · "}
        {money(payment.amountMinor)}
        {payment.refundedMinor > 0
          ? ` · ${t("refunded", { amount: money(payment.refundedMinor) })}`
          : ""}
      </p>
      {payment.hostShareMinor !== null && (
        <p className="muted">
          {t("split", {
            fee: money(payment.platformFeeMinor),
            card: money(payment.providerFeeMinor ?? 0),
            share: money(payment.hostShareMinor),
          })}
        </p>
      )}
      {payment.refundDue && (
        <p className="alert alert-warning" role="status">
          {t("refundDue")}
        </p>
      )}
      {refundable && !refunding && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => setRefunding(true)}
        >
          {t("refund")}
        </button>
      )}
      {refundable && refunding && RefundPanel && (
        <RefundPanel
          locale={locale}
          payment={payment}
          onClose={() => setRefunding(false)}
          onRefunded={(updated) => {
            setRefunding(false);
            onChange(updated);
          }}
        />
      )}
    </div>
  );
}
