import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  GuestCheckout,
  GuestPayment,
  PaymentRefundResult,
  PayoutTotals,
  Payouts,
  RequestPayment,
} from "@guidesk/contracts";
import {
  extra,
  paymentEvent,
  paymentOrder,
  paymentRefund,
  payoutAccount,
  serviceRequest,
  workspace,
  type Database,
  type DbHandle,
  type Transaction,
} from "@guidesk/db";
import {
  CHECKOUT_TTL_MS,
  currentStatus,
  isPayableRequest,
  isPlan,
  JOB_QUEUES,
  localized,
  monthBounds,
  platformFeeBps,
  platformFeeOf,
  refundableMinor,
  splitAmounts,
  statusAfterRefund,
  toMinor,
  type OrderStatus,
} from "@guidesk/domain";
import type { PaymentEvent, PaymentPort, PaymentsMode } from "@guidesk/integrations";
import { ApiProblem } from "../common/problem.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { PAYMENT_ADAPTER, PAYMENTS_MODE } from "./payment-adapter.js";

type OrderRow = typeof paymentOrder.$inferSelect;
type RequestRow = typeof serviceRequest.$inferSelect;
type Db = Database | Transaction;

/** States where money was taken; the guest and the host see these over an open checkout. */
const SETTLED: OrderStatus[] = ["paid", "partially_refunded", "refunded", "disputed"];

export interface PaymentNotifyJob {
  orderId: string;
  kind: "paid" | "disputed";
}

/** The order the request shows: a settled one first, else the newest. */
function shownOrder(orders: OrderRow[]): OrderRow | undefined {
  return orders.find((order) => SETTLED.includes(order.status)) ?? orders[0];
}

function requestPayment(order: OrderRow, now: Date): RequestPayment {
  return {
    orderId: order.id,
    state: currentStatus(order.status, order.expiresAt, now),
    amountMinor: order.amountMinor,
    currency: order.currency,
    refundedMinor: order.refundedMinor,
    platformFeeMinor: order.platformFeeMinor,
    providerFeeMinor: order.providerFeeMinor,
    hostShareMinor: order.hostShareMinor,
    refundDue: order.refundDue,
  };
}

/**
 * Add-on payments (feature 013): guest checkout, provider events, refunds, and payouts. Writes go
 * through the system handle after each route's own checks (members only read these tables); orders
 * become paid only through a verified provider event (SEC-21).
 */
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(PAYMENT_ADAPTER) private readonly adapter: PaymentPort | null,
    @Inject(PAYMENTS_MODE) readonly mode: PaymentsMode,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly jobs: JobQueueService,
    private readonly securityLog: SecurityLogService,
  ) {}

  private async ordersFor(db: Db, requestIds: string[]): Promise<Map<string, OrderRow[]>> {
    const byRequest = new Map<string, OrderRow[]>();
    if (requestIds.length === 0) return byRequest;
    const rows = await db
      .select()
      .from(paymentOrder)
      .where(inArray(paymentOrder.serviceRequestId, requestIds))
      .orderBy(desc(paymentOrder.createdAt));
    for (const row of rows) {
      const list = byRequest.get(row.serviceRequestId!) ?? [];
      list.push(row);
      byRequest.set(row.serviceRequestId!, list);
    }
    return byRequest;
  }

  private async payoutsActive(db: Db, workspaceId: string): Promise<boolean> {
    if (!this.adapter) return false;
    const [account] = await db
      .select({ status: payoutAccount.status, provider: payoutAccount.provider })
      .from(payoutAccount)
      .where(eq(payoutAccount.workspaceId, workspaceId))
      .limit(1);
    return account?.status === "active" && account.provider === this.adapter.provider;
  }

  private async turnovers(db: Db, rows: RequestRow[]): Promise<Map<string, string | null>> {
    const ids = [...new Set(rows.map((row) => row.extraId).filter((id): id is string => !!id))];
    if (ids.length === 0) return new Map();
    const extras = await db
      .select({ id: extra.id, turnover: extra.turnover })
      .from(extra)
      .where(inArray(extra.id, ids));
    return new Map(extras.map((row) => [row.id, row.turnover]));
  }

  /** Each request's payment for the guest (FR-018): null when online payment isn't possible. */
  async guestPayments(
    db: Db,
    workspaceId: string,
    rows: RequestRow[],
    now: Date = new Date(),
  ): Promise<Map<string, GuestPayment | null>> {
    const result = new Map<string, GuestPayment | null>();
    const orders = await this.ordersFor(
      db,
      rows.map((row) => row.id),
    );
    const active = await this.payoutsActive(db, workspaceId);
    const turnovers = await this.turnovers(db, rows);
    for (const row of rows) {
      const order = shownOrder(orders.get(row.id) ?? []);
      const status = order ? currentStatus(order.status, order.expiresAt, now) : null;
      if (order && status && (SETTLED.includes(status) || status === "open")) {
        result.set(row.id, {
          state: status as GuestPayment["state"],
          amountMinor: order.amountMinor,
          currency: order.currency,
          refundedMinor: order.refundedMinor,
          reference: SETTLED.includes(status) ? order.providerReference : null,
        });
        continue;
      }
      // An extra deleted since the request has no turnover record: not offered (OQ-35 caution).
      const turnover = row.extraId ? (turnovers.get(row.extraId) ?? null) : "unknown";
      const payable = active && isPayableRequest({ ...row, turnover });
      result.set(
        row.id,
        payable
          ? {
              state: "payable",
              amountMinor: toMinor(row.price, row.quantity),
              currency: row.currency,
              refundedMinor: 0,
              reference: null,
            }
          : null,
      );
    }
    return result;
  }

  /** Each request's latest order for members (FR-019). */
  async memberPayments(
    db: Db,
    requestIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, RequestPayment | null>> {
    const orders = await this.ordersFor(db, requestIds);
    return new Map(
      requestIds.map((id) => {
        const order = shownOrder(orders.get(id) ?? []);
        return [id, order ? requestPayment(order, now) : null];
      }),
    );
  }

  /** A paid request can't be cancelled until it is fully refunded (FR-015). */
  async assertCancellable(db: Db, requestId: string): Promise<void> {
    const orders = await this.ordersFor(db, [requestId]);
    const held = (orders.get(requestId) ?? []).some(
      (order) => SETTLED.includes(order.status) && order.refundedMinor < order.amountMinor,
    );
    if (held) {
      throw new ApiProblem(
        409,
        "refund_first",
        "Refund this request in full before cancelling it.",
      );
    }
  }

  /**
   * Starts or reuses the request's checkout (FR-004 to FR-008). The stay and property come from the
   * guest's session; the amount always comes from the stored request (AC-SEC-002).
   */
  async startCheckout(input: {
    workspaceId: string;
    propertyId: string;
    stayId: string;
    requestId: string;
    publicId: string;
    language: "es" | "en";
    now?: Date;
  }): Promise<GuestCheckout> {
    const adapter = this.adapter;
    if (!adapter) throw new ApiProblem(409, "not_payable");
    const now = input.now ?? new Date();
    return this.handle.db.transaction(async (tx) => {
      const locked = await tx.execute<{ id: string }>(sql`
        SELECT id FROM service_request
         WHERE id = ${input.requestId} AND stay_id = ${input.stayId}
           AND property_id = ${input.propertyId} AND workspace_id = ${input.workspaceId}
         FOR UPDATE`);
      if (!locked.rows[0]) throw new ApiProblem(404, "not_found");
      const [request] = await tx
        .select()
        .from(serviceRequest)
        .where(eq(serviceRequest.id, input.requestId));
      const [ws] = await tx
        .select({
          status: workspace.status,
          plan: workspace.plan,
          feeBps: workspace.platformFeeBps,
        })
        .from(workspace)
        .where(eq(workspace.id, input.workspaceId));
      const [account] = await tx
        .select()
        .from(payoutAccount)
        .where(eq(payoutAccount.workspaceId, input.workspaceId));
      const orders = (await this.ordersFor(tx, [input.requestId])).get(input.requestId) ?? [];
      if (orders.some((order) => SETTLED.includes(order.status))) {
        throw new ApiProblem(409, "already_paid");
      }
      const turnover = request!.extraId
        ? ((await this.turnovers(tx, [request!])).get(request!.extraId) ?? null)
        : "unknown";
      if (
        ws?.status !== "active" ||
        account?.status !== "active" ||
        account.provider !== adapter.provider ||
        !account.providerAccountId ||
        !isPayableRequest({ ...request!, turnover })
      ) {
        throw new ApiProblem(409, "not_payable");
      }
      const open = orders.find((order) => order.status === "open");
      if (open && open.expiresAt.getTime() > now.getTime() && open.checkoutUrl) {
        return {
          orderId: open.id,
          checkoutUrl: open.checkoutUrl,
          expiresAt: open.expiresAt.toISOString(),
        };
      }
      if (open) {
        await tx
          .update(paymentOrder)
          .set({ status: "expired", checkoutUrl: null })
          .where(eq(paymentOrder.id, open.id));
      }
      const amountMinor = toMinor(request!.price, request!.quantity);
      const feeBps = platformFeeBps(isPlan(ws.plan) ? ws.plan : "free", ws.feeBps);
      const platformFeeMinor = platformFeeOf(amountMinor, feeBps);
      const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);
      const [order] = await tx
        .insert(paymentOrder)
        .values({
          workspaceId: input.workspaceId,
          propertyId: input.propertyId,
          stayId: input.stayId,
          serviceRequestId: input.requestId,
          provider: adapter.provider,
          currency: request!.currency,
          amountMinor,
          platformFeeBps: feeBps,
          platformFeeMinor,
          expiresAt,
        })
        .returning({ id: paymentOrder.id });
      const orderId = order!.id;
      const guideUrl = this.config.GUIDE_URL.replace(/\/$/, "");
      const checkout = await adapter.createCheckout({
        orderId,
        amountMinor,
        currency: request!.currency,
        description: localized(request!.extraName, input.language, request!.sourceLanguage).text,
        merchantAccountId: account.providerAccountId,
        platformFeeMinor,
        returnUrl: `${guideUrl}/g/${input.publicId}/${input.language}/extras?payment=${orderId}`,
        expiresAt,
      });
      await tx
        .update(paymentOrder)
        .set({ providerReference: checkout.providerReference, checkoutUrl: checkout.checkoutUrl })
        .where(eq(paymentOrder.id, orderId));
      return { orderId, checkoutUrl: checkout.checkoutUrl, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * One provider event (FR-009, research R3): verified, recorded once, then applied to the order or
   * the payout account inside the same transaction. Returns `duplicate` for a repeated event.
   */
  async handleEvent(
    provider: string,
    payload: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ status: "handled" | "duplicate" }> {
    const adapter = this.adapter;
    if (!adapter || adapter.provider !== provider) throw new ApiProblem(404, "not_found");
    const event = adapter.verifyEvent(payload, headers);
    if (!event) {
      await this.refuse(provider, "signature");
      throw new ApiProblem(400, "invalid_event");
    }
    const notify: PaymentNotifyJob[] = [];
    const outcome = await this.handle.db.transaction(async (tx) => {
      const recorded = await tx
        .insert(paymentEvent)
        .values({
          provider,
          eventId: event.eventId,
          type: event.type,
          orderId: "orderId" in event ? (event as { orderId: string }).orderId : null,
        })
        .onConflictDoNothing()
        .returning({ eventId: paymentEvent.eventId });
      if (recorded.length === 0) return "duplicate" as const;
      await this.apply(tx, provider, event, notify);
      return "handled" as const;
    });
    for (const job of notify) {
      await this.jobs.send(JOB_QUEUES.paymentNotify, job, { retryLimit: 3, retryDelay: 30 });
    }
    return { status: outcome };
  }

  private async refuse(provider: string, reason: string, workspaceId?: string): Promise<void> {
    await this.securityLog.record({
      type: "payment.event_refused",
      outcome: "denied",
      workspaceId: workspaceId ?? null,
      metadata: { provider, reason },
    });
  }

  private async lockOrder(tx: Transaction, orderId: string): Promise<OrderRow | null> {
    const locked = await tx.execute<{ id: string }>(
      sql`SELECT id FROM payment_order WHERE id = ${orderId} FOR UPDATE`,
    );
    if (!locked.rows[0]) return null;
    const [order] = await tx.select().from(paymentOrder).where(eq(paymentOrder.id, orderId));
    return order ?? null;
  }

  private async apply(
    tx: Transaction,
    provider: string,
    event: PaymentEvent,
    notify: PaymentNotifyJob[],
  ): Promise<void> {
    if ("workspaceId" in event) {
      const status = event.type === "merchant.activated" ? "active" : "rejected";
      await tx
        .insert(payoutAccount)
        .values({
          workspaceId: event.workspaceId,
          provider: provider as "simulated" | "tilopay",
          providerAccountId: event.providerAccountId,
          status,
        })
        .onConflictDoUpdate({
          target: payoutAccount.workspaceId,
          set: {
            provider: provider as "simulated" | "tilopay",
            providerAccountId: event.providerAccountId,
            status,
            updatedAt: new Date(),
          },
        });
      await this.securityLog.record({
        type: "payouts.status_changed",
        outcome: "success",
        workspaceId: event.workspaceId,
        metadata: { provider, status },
      });
      return;
    }
    const order = await this.lockOrder(tx, event.orderId);
    if (!order || order.provider !== provider) {
      await this.refuse(provider, "unknown_order");
      return;
    }
    if (event.type === "payment.succeeded") {
      if (event.amountMinor !== order.amountMinor || event.currency !== order.currency) {
        await this.refuse(provider, "amount_mismatch", order.workspaceId);
        return;
      }
      if (SETTLED.includes(order.status)) return;
      const [request] = order.serviceRequestId
        ? await tx
            .select({ status: serviceRequest.status })
            .from(serviceRequest)
            .where(eq(serviceRequest.id, order.serviceRequestId))
        : [];
      const split = splitAmounts(order.amountMinor, order.platformFeeBps, event.providerFeeMinor);
      await tx
        .update(paymentOrder)
        .set({
          status: "paid",
          providerReference: order.providerReference ?? event.providerReference,
          platformFeeMinor: split.platformFeeMinor,
          providerFeeMinor: split.providerFeeMinor,
          hostShareMinor: split.hostShareMinor,
          // Paid after the checkout closed or the request stopped being confirmed: the host refunds.
          refundDue: order.status !== "open" || request?.status !== "confirmed",
          checkoutUrl: null,
          paidAt: new Date(),
        })
        .where(eq(paymentOrder.id, order.id));
      notify.push({ orderId: order.id, kind: "paid" });
      return;
    }
    if (event.type === "payment.failed") {
      if (order.status === "open") {
        await tx
          .update(paymentOrder)
          .set({ status: "failed", checkoutUrl: null })
          .where(eq(paymentOrder.id, order.id));
      }
      return;
    }
    if (event.type === "payment.disputed") {
      if (order.status === "paid" || order.status === "partially_refunded") {
        await tx
          .update(paymentOrder)
          .set({ status: "disputed" })
          .where(eq(paymentOrder.id, order.id));
        await this.securityLog.record({
          type: "payment.disputed",
          outcome: "success",
          workspaceId: order.workspaceId,
          targetType: "payment_order",
          targetId: order.id,
          metadata: { orderId: order.id },
        });
        notify.push({ orderId: order.id, kind: "disputed" });
      }
      return;
    }
    if (event.type !== "refund.succeeded") return;
    // A refund the provider accepted later.
    await tx
      .update(paymentRefund)
      .set({ status: "succeeded" })
      .where(
        and(
          eq(paymentRefund.orderId, order.id),
          eq(paymentRefund.providerRefundId, event.providerRefundId),
        ),
      );
  }

  /**
   * Refunds part or all of a paid order (FR-014). The order row is locked, so concurrent refunds can't
   * exceed what was paid (AC-SEC-004). The route checks the capability and the step-up.
   */
  async refund(
    actorUserId: string,
    workspaceId: string,
    orderId: string,
    amountMinor: number,
  ): Promise<PaymentRefundResult> {
    const adapter = this.adapter;
    const result = await this.handle.db.transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order || order.workspaceId !== workspaceId) return null;
      if (!adapter || order.provider !== adapter.provider) {
        throw new ApiProblem(409, "not_refundable");
      }
      if (order.status !== "paid" && order.status !== "partially_refunded") {
        throw new ApiProblem(409, "not_refundable");
      }
      const left = refundableMinor(order);
      if (amountMinor > left) {
        throw new ApiProblem(422, "amount_too_large", undefined, { details: { left } });
      }
      const refunded = await adapter.refund({
        orderId: order.id,
        providerReference: order.providerReference ?? order.id,
        amountMinor,
        currency: order.currency,
      });
      const [row] = await tx
        .insert(paymentRefund)
        .values({
          workspaceId,
          orderId: order.id,
          amountMinor,
          status: refunded.status,
          providerRefundId: refunded.providerRefundId,
          requestedBy: actorUserId,
        })
        .returning();
      const total = order.refundedMinor + amountMinor;
      const status = statusAfterRefund(order.amountMinor, total);
      const [updated] = await tx
        .update(paymentOrder)
        .set({
          refundedMinor: total,
          status,
          refundDue: status === "refunded" ? false : order.refundDue,
        })
        .where(eq(paymentOrder.id, order.id))
        .returning();
      return { refund: row!, order: updated!, full: status === "refunded" };
    });
    if (!result) throw new ApiProblem(404, "not_found");
    await this.securityLog.record({
      type: "payment.refunded",
      outcome: "success",
      actorUserId,
      workspaceId,
      targetType: "payment_order",
      targetId: orderId,
      metadata: {
        orderId,
        amountMinor,
        currency: result.order.currency,
        full: result.full,
      },
    });
    return {
      refund: {
        id: result.refund.id,
        amountMinor: result.refund.amountMinor,
        status: result.refund.status,
      },
      order: requestPayment(result.order, new Date()),
    };
  }

  /** Payouts for members (FR-002, FR-020); `db` is the member's request transaction. */
  async payouts(
    db: Db,
    workspaceId: string,
    role: string,
    now: Date = new Date(),
  ): Promise<Payouts> {
    const [ws] = await db
      .select({ plan: workspace.plan, feeBps: workspace.platformFeeBps })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    const [account] = await db
      .select({ provider: payoutAccount.provider, status: payoutAccount.status })
      .from(payoutAccount)
      .where(eq(payoutAccount.workspaceId, workspaceId));
    const bps = platformFeeBps(isPlan(ws?.plan) ? ws.plan : "free", ws?.feeBps);
    const start = monthBounds(now).start;
    const totals = await db.execute<{
      currency: string;
      orders: number;
      paid: string;
      refunded: string;
      platform: string;
      provider: string;
      host: string;
    }>(sql`
      SELECT currency, count(*)::int AS orders, sum(amount_minor) AS paid,
             sum(refunded_minor) AS refunded, sum(platform_fee_minor) AS platform,
             coalesce(sum(provider_fee_minor), 0) AS provider, coalesce(sum(host_share_minor), 0) AS host
        FROM payment_order
       WHERE workspace_id = ${workspaceId} AND paid_at >= ${start.toISOString()}::timestamptz
         AND status IN ('paid', 'partially_refunded', 'refunded', 'disputed')
       GROUP BY currency ORDER BY currency`);
    const month: PayoutTotals[] = totals.rows.map((row) => ({
      currency: row.currency,
      orders: Number(row.orders),
      paidMinor: Number(row.paid),
      refundedMinor: Number(row.refunded),
      platformFeeMinor: Number(row.platform),
      providerFeeMinor: Number(row.provider),
      hostShareMinor: Number(row.host),
    }));
    return {
      mode: this.mode,
      account: account ?? null,
      feePercent: bps / 100,
      feeSource: ws?.feeBps === null || ws?.feeBps === undefined ? "plan" : "custom",
      canManage: role === "owner" && this.mode !== "off",
      month,
    };
  }

  /** The owner starts or resumes onboarding (FR-002). */
  async startOnboarding(
    actorUserId: string,
    workspaceId: string,
    language: "es" | "en",
  ): Promise<{ onboardingUrl: string }> {
    const adapter = this.adapter;
    if (!adapter) throw new ApiProblem(409, "payments_off");
    const [account] = await this.handle.db
      .select({ status: payoutAccount.status })
      .from(payoutAccount)
      .where(eq(payoutAccount.workspaceId, workspaceId));
    if (account?.status === "active") throw new ApiProblem(409, "conflict", "Payouts are active.");
    if (!account) {
      await this.handle.db
        .insert(payoutAccount)
        .values({ workspaceId, provider: adapter.provider, status: "pending" })
        .onConflictDoNothing();
    }
    await this.securityLog.record({
      type: "payouts.onboarding_started",
      outcome: "success",
      actorUserId,
      workspaceId,
      metadata: { provider: adapter.provider },
    });
    const portal = this.config.PORTAL_URL.replace(/\/$/, "");
    return adapter.createOnboarding({
      workspaceId,
      returnUrl: `${portal}/${language}/settings/payouts`,
    });
  }
}
