import { eq } from "drizzle-orm";
import { paymentOrder, property, serviceRequest, type Database } from "@guidesk/db";
import { JOB_QUEUES, localized } from "@guidesk/domain";
import { renderPaymentDisputed, renderPaymentPaid } from "@guidesk/emails";
import type { EmailMessage } from "@guidesk/integrations";
import { loadAppliedSettings } from "./assistant-pipeline.js";
import { membersOf, recipientsFor } from "./chat-reply.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * Payment emails (feature 013 research R8): a paid add-on to the property's escalation contacts
 * (spec 007), a dispute to the owners. The extra's name and the amount only.
 */
export interface PaymentNotifyJob {
  orderId: string;
  kind: "paid" | "disputed";
}

export interface PaymentNotifyDeps {
  db: Database;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  span?: JobSpanDeps;
}

function formatAmount(amountMinor: number, currency: string, locale: "es" | "en"): string {
  const number = new Intl.NumberFormat(locale === "en" ? "en-US" : "es-CR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `${number} ${currency}`;
}

export async function runPaymentNotify(
  deps: PaymentNotifyDeps,
  job: PaymentNotifyJob,
): Promise<number> {
  const { db } = deps;
  const [row] = await db
    .select({
      workspaceId: paymentOrder.workspaceId,
      propertyId: paymentOrder.propertyId,
      amountMinor: paymentOrder.amountMinor,
      currency: paymentOrder.currency,
      propertyName: property.name,
      timeZone: property.timeZone,
      extraName: serviceRequest.extraName,
      sourceLanguage: serviceRequest.sourceLanguage,
    })
    .from(paymentOrder)
    .innerJoin(property, eq(property.id, paymentOrder.propertyId))
    .leftJoin(serviceRequest, eq(serviceRequest.id, paymentOrder.serviceRequestId))
    .where(eq(paymentOrder.id, job.orderId))
    .limit(1);
  if (!row) return 0;
  const recipients =
    job.kind === "paid"
      ? await recipientsFor(
          db,
          row.workspaceId,
          (
            await loadAppliedSettings(db, {
              workspaceId: row.workspaceId,
              propertyId: row.propertyId,
              timeZone: row.timeZone,
            })
          ).effective.contacts,
          "draft_ready",
        )
      : await membersOf(db, row.workspaceId, ["owner"]);
  for (const recipient of recipients) {
    const details = {
      propertyName: row.propertyName,
      extraName: row.extraName
        ? localized(row.extraName, recipient.locale, row.sourceLanguage ?? "es").text
        : "—",
      amount: formatAmount(row.amountMinor, row.currency, recipient.locale),
      requestsLink: `${deps.portalUrl}/${recipient.locale}/requests`,
    };
    const rendered =
      job.kind === "paid"
        ? await renderPaymentPaid(recipient.locale, details)
        : await renderPaymentDisputed(recipient.locale, details);
    await deps.queueEmail({ to: recipient.email, ...rendered, template: `payment.${job.kind}` });
  }
  return recipients.length;
}

/** The pg-boss handler: one span per job with counts only (constitution VIII). */
export function createPaymentNotifyHandler(deps: PaymentNotifyDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<PaymentNotifyJob>;
      if (typeof data.orderId !== "string" || (data.kind !== "paid" && data.kind !== "disputed")) {
        continue;
      }
      const payload: PaymentNotifyJob = { orderId: data.orderId, kind: data.kind };
      await runInJobSpan(
        { queue: JOB_QUEUES.paymentNotify },
        async (span) => {
          const sent = await runPaymentNotify(deps, payload);
          span.set({ "job.outcome": "completed", "emails.queued": sent });
        },
        deps.span,
      );
    }
  };
}
