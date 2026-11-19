"use client";

import { useId, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import type { PaymentRefundResult, RequestPayment } from "@guidesk/contracts";
import { formatMoney, parseAmount } from "@/lib/payments";
import { problemOf } from "@/lib/properties-api";
import { useStepUp } from "@/lib/use-step-up";
import { useWorkspace } from "@/lib/use-workspace";

/**
 * Refund all or part of a paid request (feature 013 FR-014): the amount defaults to what is left;
 * the API asks for re-authentication when the sign-in is older than 10 minutes.
 */
export function RefundPanel({
  locale,
  payment,
  onClose,
  onRefunded,
}: {
  locale: string;
  payment: RequestPayment;
  onClose: () => void;
  onRefunded: (payment: RequestPayment) => void;
}) {
  const t = useTranslations("payments");
  const errors = useTranslations("errors");
  const workspace = useWorkspace();
  const stepUp = useStepUp();
  const id = useId();
  const left = payment.amountMinor - payment.refundedMinor;
  const [amount, setAmount] = useState((left / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const minor = parseAmount(amount);
    if (minor === null || minor > left) {
      setError(t("refundAmountInvalid", { max: formatMoney(locale, left, payment.currency) }));
      return;
    }
    if (!workspace) return;
    setBusy(true);
    setError(null);
    try {
      const result = await stepUp.run(() =>
        workspace.api.post<PaymentRefundResult>(`/payment-orders/${payment.orderId}/refunds`, {
          amountMinor: minor,
        }),
      );
      if (result) onRefunded(result.order);
    } catch (cause) {
      const code = problemOf(cause)?.code;
      setError(
        code === "amount_too_large" || code === "not_refundable"
          ? t(`errors.${code}`)
          : errors(code === "network" ? "network" : "internal_error"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="refund-panel" onSubmit={(event) => void submit(event)} noValidate>
      <label htmlFor={`${id}-amount`}>{t("refundAmount", { currency: payment.currency })}</label>
      <input
        id={`${id}-amount`}
        inputMode="decimal"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        aria-describedby={`${id}-hint`}
        aria-invalid={error ? true : undefined}
      />
      <p id={`${id}-hint`} className="muted">
        {t("refundHint", { max: formatMoney(locale, left, payment.currency) })}
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={busy}>
          {t("refundConfirm")}
        </button>
        <button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>
          {t("back")}
        </button>
      </div>
      {stepUp.dialog}
    </form>
  );
}
