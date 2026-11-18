/**
 * The in-guide chat (feature 005 data model §1–§3): conversations, messages, the assistant's drafts
 * and traces, and daily usage. RLS policies, grants, and the member trace view live in migration
 * 0024. No table holds guest contact data; the chat cookie is stored only as a hash.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ANSWER_KIND_VALUES,
  ASSISTANT_TONES,
  assistantInstructionVersion,
  assistantTest,
} from "./assistant.js";
import { user } from "./auth.js";
import { createdAt, inList } from "./columns.js";
import { guideVersion } from "./guides.js";
import { property } from "./properties.js";
import { stay } from "./stays.js";
import { workspace } from "./tenancy.js";

export const CONVERSATION_STATUSES = ["open", "needs_host"] as const;
export const NEEDS_HOST_REASON_VALUES = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "not_confident",
  "draft_ready",
  "check_failed",
  "limit",
  "unavailable",
] as const;
export const MESSAGE_AUTHORS = ["guest", "assistant", "host"] as const;
export const MESSAGE_KINDS = [
  "text",
  "holding",
  "emergency",
  "pointer",
  "greeting",
  "pause",
] as const;
export const DRAFT_STATUSES = ["open", "sent", "edited", "superseded", "discarded"] as const;
export const TRACE_DECISIONS = [
  "answered",
  "drafted",
  "held",
  "pointer",
  "greeting",
  "paused",
] as const;

export const conversation = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    stayId: uuid("stay_id").references(() => stay.id, { onDelete: "set null" }),
    cookieHash: text("cookie_hash").notNull(),
    status: text("status", { enum: CONVERSATION_STATUSES }).notNull().default("open"),
    needsHostReason: text("needs_host_reason", { enum: NEEDS_HOST_REASON_VALUES }),
    language: text("language", { enum: ["es", "en"] }).notNull(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversation_device_uq").on(t.propertyId, t.cookieHash),
    index("conversation_property_status_idx").on(t.propertyId, t.status, t.lastMessageAt),
    index("conversation_workspace_idx").on(t.workspaceId),
    check("conversation_cookie_hash_format", sql`${t.cookieHash} ~ '^[0-9a-f]{64}$'`),
    check("conversation_status_valid", inList(t.status, CONVERSATION_STATUSES)),
    check(
      "conversation_reason_consistent",
      sql`(${t.status} = 'needs_host') = (${t.needsHostReason} IS NOT NULL)`,
    ),
  ],
);

export const chatMessage = pgTable(
  "chat_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    author: text("author", { enum: MESSAGE_AUTHORS }).notNull(),
    kind: text("kind", { enum: MESSAGE_KINDS }).notNull().default("text"),
    body: text("body").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    authorUserId: text("author_user_id").references(() => user.id, { onDelete: "set null" }),
    clientId: text("client_id"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chat_message_seq_uq").on(t.conversationId, t.seq),
    uniqueIndex("chat_message_client_uq")
      .on(t.conversationId, t.clientId)
      .where(sql`${t.clientId} IS NOT NULL`),
    index("chat_message_workspace_idx").on(t.workspaceId),
    check("chat_message_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
    check("chat_message_author_valid", inList(t.author, MESSAGE_AUTHORS)),
    check("chat_message_kind_valid", inList(t.kind, MESSAGE_KINDS)),
  ],
);

export const agentTrace = pgTable(
  "agent_trace",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Null for "test the assistant" traces (feature 007 research R13). */
    conversationId: uuid("conversation_id").references(() => conversation.id, {
      onDelete: "cascade",
    }),
    assistantTestId: uuid("assistant_test_id").references(() => assistantTest.id, {
      onDelete: "cascade",
    }),
    guestMessageId: uuid("guest_message_id").references((): AnyPgColumn => chatMessage.id, {
      onDelete: "set null",
    }),
    replyMessageId: uuid("reply_message_id").references((): AnyPgColumn => chatMessage.id, {
      onDelete: "set null",
    }),
    classification: jsonb("classification").$type<Record<string, unknown>>(),
    decision: text("decision", { enum: TRACE_DECISIONS }).notNull(),
    reason: text("reason", { enum: NEEDS_HOST_REASON_VALUES }),
    autonomy: text("autonomy", { enum: ["draft", "auto", "full_auto"] }).notNull(),
    /** Feature 007 (FR-020): where the level came from and the other settings that applied. */
    autonomySource: text("autonomy_source", { enum: ["workspace", "property"] }),
    answerKind: text("answer_kind", { enum: ANSWER_KIND_VALUES }),
    tone: text("tone", { enum: ASSISTANT_TONES }),
    quietHours: boolean("quiet_hours").notNull().default(false),
    workspaceInstructionVersionId: uuid("workspace_instruction_version_id").references(
      () => assistantInstructionVersion.id,
      { onDelete: "no action" },
    ),
    propertyInstructionVersionId: uuid("property_instruction_version_id").references(
      () => assistantInstructionVersion.id,
      { onDelete: "no action" },
    ),
    guideVersionId: uuid("guide_version_id").references(() => guideVersion.id, {
      onDelete: "set null",
    }),
    sectionIds: uuid("section_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    checks: jsonb("checks").$type<{ check: string; passed: boolean }[]>().notNull().default([]),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull().default(0),
    sentBy: text("sent_by").references(() => user.id, { onDelete: "set null" }),
    edited: boolean("edited").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_trace_conversation_idx").on(t.conversationId),
    index("agent_trace_created_idx").on(t.createdAt),
    index("agent_trace_test_idx").on(t.assistantTestId),
    check("agent_trace_decision_valid", inList(t.decision, TRACE_DECISIONS)),
    check(
      "agent_trace_subject",
      sql`(${t.conversationId} IS NULL) <> (${t.assistantTestId} IS NULL)`,
    ),
  ],
);

export const agentDraft = pgTable(
  "agent_draft",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    traceId: uuid("trace_id").references(() => agentTrace.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    sectionIds: uuid("section_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text("status", { enum: DRAFT_STATUSES }).notNull().default("open"),
    actedBy: text("acted_by").references(() => user.id, { onDelete: "set null" }),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("agent_draft_open_uq")
      .on(t.conversationId)
      .where(sql`${t.status} = 'open'`),
    index("agent_draft_workspace_idx").on(t.workspaceId),
    check("agent_draft_status_valid", inList(t.status, DRAFT_STATUSES)),
    check("agent_draft_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
  ],
);

export const chatUsageDaily = pgTable(
  "chat_usage_daily",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    replies: integer("replies").notNull().default(0),
    costUsdMicros: bigint("cost_usd_micros", { mode: "number" }).notNull().default(0),
    limitNotifiedAt: timestamp("limit_notified_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.propertyId, t.day] }),
    index("chat_usage_daily_workspace_idx").on(t.workspaceId, t.day),
  ],
);

/**
 * A "needs the host" email waiting for the end of quiet hours (feature 007 research R7). One per
 * recipient and conversation; the `chat.quiet-digest` job turns due notices into summaries. System
 * only: no member policies or grants.
 */
export const chatHeldNotice = pgTable(
  "chat_held_notice",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversation.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    reason: text("reason", { enum: NEEDS_HOST_REASON_VALUES }).notNull(),
    releaseAt: timestamp("release_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("chat_held_notice_uq").on(t.conversationId, t.userId),
    index("chat_held_notice_release_idx").on(t.releaseAt),
  ],
);
