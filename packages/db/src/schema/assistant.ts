/**
 * The assistant's settings (feature 007 data model): one row per scope (the workspace's defaults and
 * each property's own values), the escalation contacts, immutable custom instruction versions, and
 * the "test the assistant" runs. RLS policies and grants live in migration 0027.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
  boolean,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { createdAt, inList } from "./columns.js";
import { property } from "./properties.js";
import { membership, workspace } from "./tenancy.js";

export const ASSISTANT_TONES = ["casual", "formal"] as const;
export const ASSISTANT_CONTACT_MODES = ["all", "selected"] as const;
export const ASSISTANT_GROUPS = ["autonomy", "tone", "quiet_hours", "contacts"] as const;
export const ASSISTANT_TEST_STATUSES = ["pending", "done"] as const;
export const ASSISTANT_TEST_OUTCOMES = [
  "sent",
  "draft",
  "held",
  "pointer",
  "greeting",
  "limited",
  "unavailable",
] as const;
export const ANSWER_KIND_VALUES = ["grounded", "general", "clarify"] as const;

export const assistantInstructionVersion = pgTable(
  "assistant_instruction_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Null for the workspace's instructions. */
    propertyId: uuid("property_id").references(() => property.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("assistant_instruction_version_scope_idx").on(t.workspaceId, t.propertyId),
    check("assistant_instruction_version_text_len", sql`char_length(${t.text}) BETWEEN 1 AND 1000`),
  ],
);

export const assistantSettings = pgTable(
  "assistant_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** Null for the workspace's defaults. */
    propertyId: uuid("property_id").references(() => property.id, { onDelete: "cascade" }),
    /** `{ topic: level }` (research R1); missing topics read as `draft`. */
    autonomy: jsonb("autonomy").$type<Record<string, string>>().notNull().default({}),
    tone: text("tone", { enum: ASSISTANT_TONES }).notNull().default("casual"),
    quietEnabled: boolean("quiet_enabled").notNull().default(false),
    quietStart: time("quiet_start"),
    quietEnd: time("quiet_end"),
    contactsMode: text("contacts_mode", { enum: ASSISTANT_CONTACT_MODES }).notNull().default("all"),
    /** Property rows: the groups the property sets itself (FR-014). */
    ownGroups: text("own_groups")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    instructionVersionId: uuid("instruction_version_id").references(
      (): AnyPgColumn => assistantInstructionVersion.id,
      { onDelete: "set null" },
    ),
    version: integer("version").notNull().default(1),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("assistant_settings_scope_uq").on(t.workspaceId, t.propertyId).nullsNotDistinct(),
    check("assistant_settings_tone_valid", inList(t.tone, ASSISTANT_TONES)),
    check(
      "assistant_settings_contacts_mode_valid",
      inList(t.contactsMode, ASSISTANT_CONTACT_MODES),
    ),
    check(
      "assistant_settings_own_groups_valid",
      sql`${t.ownGroups} <@ ARRAY['autonomy','tone','quiet_hours','contacts']::text[]`,
    ),
    check(
      "assistant_settings_quiet_valid",
      sql`NOT ${t.quietEnabled} OR (${t.quietStart} IS NOT NULL AND ${t.quietEnd} IS NOT NULL AND ${t.quietStart} <> ${t.quietEnd})`,
    ),
  ],
);

export const assistantContact = pgTable(
  "assistant_contact",
  {
    settingsId: uuid("settings_id")
      .notNull()
      .references(() => assistantSettings.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => membership.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.settingsId, t.membershipId] }),
    index("assistant_contact_membership_idx").on(t.membershipId),
  ],
);

export const assistantTest = pgTable(
  "assistant_test",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    /** The member's screen language: holding replies and pointers are written in it. */
    language: text("language", { enum: ["es", "en"] })
      .notNull()
      .default("es"),
    status: text("status", { enum: ASSISTANT_TEST_STATUSES }).notNull().default("pending"),
    outcome: text("outcome", { enum: ASSISTANT_TEST_OUTCOMES }),
    reason: text("reason"),
    topic: text("topic"),
    answerKind: text("answer_kind", { enum: ANSWER_KIND_VALUES }),
    reply: text("reply"),
    sectionIds: uuid("section_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("assistant_test_property_idx").on(t.propertyId, t.createdAt),
    index("assistant_test_created_idx").on(t.createdAt),
    check("assistant_test_question_len", sql`char_length(${t.question}) BETWEEN 1 AND 2000`),
    check("assistant_test_status_valid", inList(t.status, ASSISTANT_TEST_STATUSES)),
  ],
);
