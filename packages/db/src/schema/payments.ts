/**
 * Feature 013 (data model): payouts, orders, refunds, and provider events. Members read their
 * workspace's rows; only the system context writes (the API after its own checks, provider events).
 * Amounts are integer minor units; no personal data.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { createdAt, inList, updatedAt } from "./columns.js";
import { serviceRequest } from "./extras.js";
import { property } from "./properties.js";
import { stay } from "./stays.js";
import { workspace } from "./tenancy.js";

export const PAYMENT_PROVIDERS = ["simulated", "tilopay"] as const;
export const PAYOUT_STATUSES = ["pending", "active", "rejected"] as const;
export const PAYMENT_ORDER_STATUSES = [
  "open",
  "paid",
  "partially_refunded",
  "refunded",
  "disputed",
  "failed",
  "expired",
  "cancelled",
] as const;
export const PAYMENT_REFUND_STATUSES = ["succeeded", "pending", "failed"] as const;

export const payoutAccount = pgTable(
  "payout_account",
  {
    workspaceId: uuid("workspace_id")
      .primaryKey()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }).notNull(),
    providerAccountId: text("provider_account_id"),
    status: text("status", { enum: PAYOUT_STATUSES }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payout_account_provider_valid", inList(t.provider, PAYMENT_PROVIDERS)),
    check("payout_account_status_valid", inList(t.status, PAYOUT_STATUSES)),
  ],
);

export const paymentOrder = pgTable(
  "payment_order",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    stayId: uuid("stay_id").references(() => stay.id, { onDelete: "set null" }),
    serviceRequestId: uuid("service_request_id").references(() => serviceRequest.id, {
      onDelete: "set null",
    }),
    provider: text("provider", { enum: PAYMENT_PROVIDERS }).notNull(),
    providerReference: text("provider_reference"),
    status: text("status", { enum: PAYMENT_ORDER_STATUSES }).notNull().default("open"),
    currency: char("currency", { length: 3 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    platformFeeBps: integer("platform_fee_bps").notNull(),
    platformFeeMinor: bigint("platform_fee_minor", { mode: "number" }).notNull(),
    providerFeeMinor: bigint("provider_fee_minor", { mode: "number" }),
    hostShareMinor: bigint("host_share_minor", { mode: "number" }),
    refundedMinor: bigint("refunded_minor", { mode: "number" }).notNull().default(0),
    refundDue: boolean("refund_due").notNull().default(false),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("payment_order_status_valid", inList(t.status, PAYMENT_ORDER_STATUSES)),
    check("payment_order_provider_valid", inList(t.provider, PAYMENT_PROVIDERS)),
    check("payment_order_amount_positive", sql`${t.amountMinor} > 0`),
    check("payment_order_fee_bps_range", sql`${t.platformFeeBps} BETWEEN 0 AND 3000`),
    check("payment_order_refunded_range", sql`${t.refundedMinor} BETWEEN 0 AND ${t.amountMinor}`),
    uniqueIndex("payment_order_open_request_uq")
      .on(t.serviceRequestId)
      .where(sql`${t.status} = 'open'`),
    uniqueIndex("payment_order_provider_reference_uq").on(t.provider, t.providerReference),
    index("payment_order_workspace_paid_idx").on(t.workspaceId, t.paidAt),
    index("payment_order_request_idx").on(t.serviceRequestId),
  ],
);

export const paymentRefund = pgTable(
  "payment_refund",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrder.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: text("status", { enum: PAYMENT_REFUND_STATUSES }).notNull(),
    providerRefundId: text("provider_refund_id"),
    requestedBy: text("requested_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("payment_refund_status_valid", inList(t.status, PAYMENT_REFUND_STATUSES)),
    check("payment_refund_amount_positive", sql`${t.amountMinor} > 0`),
    index("payment_refund_order_idx").on(t.orderId),
  ],
);

export const paymentEvent = pgTable(
  "payment_event",
  {
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    type: text("type").notNull(),
    orderId: uuid("order_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.eventId] })],
);
