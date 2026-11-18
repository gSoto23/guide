/**
 * The guide builder (feature 003 data model §1–§5): guides, sections, items with a document per
 * language, topic marks, published versions, shared blocks, media, documents read for knowledge,
 * the interview, and AI usage. RLS policies, grants, and the backfill live in migration 0019.
 *
 * Every table is tenant-owned (`workspace_id`), with RLS enabled and forced (SEC-14). Documents
 * (`doc` columns) are validated against the content schema in `@guidesk/contracts` on every
 * write; snapshots never hold a locked value (research R12).
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { createdAt, inList, updatedAt } from "./columns.js";
import { upload } from "./extractions.js";
import { GUIDE_LANGUAGES } from "./enums.js";
import { property } from "./properties.js";
import { workspace } from "./tenancy.js";

export const GUIDE_STATUSES = ["draft", "published", "unpublished"] as const;
export const GUIDE_DRAFT_STATES = [
  "pending",
  "drafting",
  "ready",
  "waiting_limit",
  "failed",
] as const;
/** The nine default sections, in their default order (FR-001), plus custom sections (FR-002). */
export const DEFAULT_SECTION_KINDS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
] as const;
export const SECTION_KINDS = [...DEFAULT_SECTION_KINDS, "custom"] as const;
export const SECTION_STATUSES = ["missing", "needs_review", "ready"] as const;
export const GUIDE_ITEM_KINDS = ["text", "image", "video", "recommendation", "fact"] as const;
export const GUIDE_ITEM_SOURCES = [
  "host",
  "listing",
  "pms",
  "document",
  "interview",
  "copy",
] as const;
export const FACT_KEYS = ["check_in_time", "checkout_time", "max_guests", "address"] as const;
export const TEXT_ORIGINS = ["source", "machine", "reviewed"] as const;
export const TEXT_STATES = ["current", "stale", "out_of_date", "pending", "failed"] as const;
export const TEXT_PENDING_REASONS = ["ai_limit", "ai_unavailable", "tokens_mismatch"] as const;
export const TOPIC_MARKS = ["covered", "not_applicable"] as const;
export const GUIDE_VERSION_CAUSES = ["publish", "shared_block", "shared_block_removed"] as const;
export const SHARED_BLOCK_STATUSES = ["draft", "published"] as const;
export const SHARED_LINK_MODES = ["override", "exclude"] as const;
export const MEDIA_KINDS = ["image", "video"] as const;
export const MEDIA_STATUSES = ["uploading", "processing", "ready", "rejected"] as const;
export const VIDEO_CODECS = ["h264", "hevc"] as const;
export const GUIDE_DOCUMENT_KINDS = ["pdf", "photo"] as const;
export const GUIDE_DOCUMENT_STATUSES = ["checking", "reading", "done", "rejected"] as const;
export const INTERVIEW_STATUSES = ["active", "finished"] as const;
export const ANSWER_KINDS = ["text", "voice"] as const;
export const TURN_STATUSES = ["queued", "transcribing", "drafting", "done", "failed"] as const;
export const GUIDE_AI_KINDS = [
  "draft_listing",
  "interview_answer",
  "document",
  "translation",
] as const;
export const GUIDE_AI_OUTCOMES = [
  "ok",
  "refused",
  "truncated",
  "invalid",
  "timeout",
  "unavailable",
] as const;

const languageCheck = (column: AnyPgColumn) => inList(column, GUIDE_LANGUAGES);

// §1 Guides, sections, and items -------------------------------------------------------------

export const guide = pgTable(
  "guide",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => property.id, { onDelete: "cascade" }),
    status: text("status", { enum: GUIDE_STATUSES }).notNull().default("draft"),
    hasUnpublishedChanges: boolean("has_unpublished_changes").notNull().default(false),
    /** What guests (spec 004) and the agent (spec 005) read (FR-052). */
    publishedVersionId: uuid("published_version_id").references(
      (): AnyPgColumn => guideVersion.id,
      { onDelete: "set null" },
    ),
    draftState: text("draft_state", { enum: GUIDE_DRAFT_STATES }).notNull().default("pending"),
    completeness: smallint("completeness").notNull().default(0),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("guide_property_uq").on(t.propertyId),
    index("guide_workspace_idx").on(t.workspaceId),
    check("guide_status_valid", inList(t.status, GUIDE_STATUSES)),
    check("guide_draft_state_valid", inList(t.draftState, GUIDE_DRAFT_STATES)),
    check("guide_completeness_range", sql`${t.completeness} BETWEEN 0 AND 100`),
  ],
);

export const guideSection = pgTable(
  "guide_section",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => guide.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SECTION_KINDS }).notNull(),
    /** Custom sections only: `{es?, en?}`, each 1–80 characters. */
    title: jsonb("title").$type<Partial<Record<(typeof GUIDE_LANGUAGES)[number], string>>>(),
    position: smallint("position").notNull(),
    hidden: boolean("hidden").notNull().default(false),
    /** Incremented by every write to the section or its items (research R17). */
    revision: integer("revision").notNull().default(0),
    status: text("status", { enum: SECTION_STATUSES }).notNull().default("missing"),
    completeness: smallint("completeness"),
    updatedAt: updatedAt(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    uniqueIndex("guide_section_kind_uq")
      .on(t.guideId, t.kind)
      .where(sql`${t.kind} <> 'custom'`),
    index("guide_section_guide_idx").on(t.guideId, t.position),
    index("guide_section_workspace_idx").on(t.workspaceId),
    check("guide_section_kind_valid", inList(t.kind, SECTION_KINDS)),
    check("guide_section_status_valid", inList(t.status, SECTION_STATUSES)),
    check(
      "guide_section_title_custom_only",
      sql`(${t.kind} = 'custom') = (${t.title} IS NOT NULL)`,
    ),
    check("guide_section_hidden_default_only", sql`NOT (${t.hidden} AND ${t.kind} = 'custom')`),
    check(
      "guide_section_completeness_range",
      sql`${t.completeness} IS NULL OR ${t.completeness} BETWEEN 0 AND 100`,
    ),
  ],
);

export const guideItem = pgTable(
  "guide_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => guideSection.id, { onDelete: "cascade" }),
    sharedBlockId: uuid("shared_block_id").references((): AnyPgColumn => sharedBlock.id, {
      onDelete: "cascade",
    }),
    kind: text("kind", { enum: GUIDE_ITEM_KINDS }).notNull(),
    position: smallint("position").notNull(),
    source: text("source", { enum: GUIDE_ITEM_SOURCES }).notNull(),
    /** PMS name, file name, or copied property or block name. */
    sourceDetail: text("source_detail"),
    /** Null means "Needs review" (FR-005). */
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    sourceLanguage: text("source_language", { enum: GUIDE_LANGUAGES }).notNull(),
    /** Topic IDs from `GUIDE_TOPICS` tagged by the AI (research R10). */
    topics: text("topics")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    factKey: text("fact_key", { enum: FACT_KEYS }),
    mediaId: uuid("media_id").references((): AnyPgColumn => mediaObject.id, {
      onDelete: "restrict",
    }),
    recommendation: jsonb("recommendation").$type<{
      name: string;
      category: string;
      url?: string;
      address?: string;
      benefit?: "none" | "commission" | "discount" | "other";
      benefitNote?: string;
      personalTip: boolean;
    }>(),
    /** Hash of the text the host chose to keep despite a code warning (research R5). */
    codeWarningAck: text("code_warning_ack"),
    interviewTurnId: uuid("interview_turn_id").references((): AnyPgColumn => interviewTurn.id, {
      onDelete: "set null",
    }),
    documentId: uuid("document_id").references((): AnyPgColumn => guideDocument.id, {
      onDelete: "set null",
    }),
    /** For an override's copies: the shared block they came from, so "Reset to shared" finds them (FR-059). */
    copiedFromBlockId: uuid("copied_from_block_id").references((): AnyPgColumn => sharedBlock.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    index("guide_item_section_idx").on(t.sectionId, t.position),
    index("guide_item_shared_block_idx").on(t.sharedBlockId, t.position),
    index("guide_item_workspace_idx").on(t.workspaceId),
    index("guide_item_media_idx").on(t.mediaId),
    index("guide_item_document_idx").on(t.documentId),
    index("guide_item_copied_from_block_idx").on(t.copiedFromBlockId),
    check("guide_item_one_owner", sql`(${t.sectionId} IS NULL) <> (${t.sharedBlockId} IS NULL)`),
    check("guide_item_kind_valid", inList(t.kind, GUIDE_ITEM_KINDS)),
    check("guide_item_source_valid", inList(t.source, GUIDE_ITEM_SOURCES)),
    check("guide_item_language_valid", languageCheck(t.sourceLanguage)),
    check(
      "guide_item_source_detail_length",
      sql`${t.sourceDetail} IS NULL OR char_length(${t.sourceDetail}) <= 120`,
    ),
    check(
      "guide_item_fact_key",
      sql`(${t.kind} = 'fact') = (${t.factKey} IS NOT NULL) AND (${t.factKey} IS NULL OR ${inList(t.factKey, FACT_KEYS)})`,
    ),
    check("guide_item_media", sql`(${t.kind} IN ('image', 'video')) = (${t.mediaId} IS NOT NULL)`),
    check(
      "guide_item_recommendation",
      sql`(${t.kind} = 'recommendation') = (${t.recommendation} IS NOT NULL)`,
    ),
    check("guide_item_host_reviewed", sql`${t.source} <> 'host' OR ${t.reviewedAt} IS NOT NULL`),
  ],
);

export const guideItemText = pgTable(
  "guide_item_text",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => guideItem.id, { onDelete: "cascade" }),
    language: text("language", { enum: GUIDE_LANGUAGES }).notNull(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    /** The document (research R2). Null while a new item's translation is stale or pending. */
    doc: jsonb("doc"),
    /** Plain-text length, for the 20,000-character section limit (FR-010). */
    textLength: integer("text_length").notNull().default(0),
    origin: text("origin", { enum: TEXT_ORIGINS }).notNull(),
    state: text("state", { enum: TEXT_STATES }).notNull().default("current"),
    sourceHash: text("source_hash"),
    pendingReason: text("pending_reason", { enum: TEXT_PENDING_REASONS }),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.language] }),
    index("guide_item_text_workspace_idx").on(t.workspaceId),
    index("guide_item_text_stale_idx")
      .on(t.state)
      .where(sql`${t.state} IN ('stale', 'pending')`),
    check("guide_item_text_language_valid", languageCheck(t.language)),
    check("guide_item_text_origin_valid", inList(t.origin, TEXT_ORIGINS)),
    check("guide_item_text_state_valid", inList(t.state, TEXT_STATES)),
    check(
      "guide_item_text_pending_reason_valid",
      sql`${t.pendingReason} IS NULL OR ${inList(t.pendingReason, TEXT_PENDING_REASONS)}`,
    ),
    check("guide_item_text_length_range", sql`${t.textLength} BETWEEN 0 AND 20000`),
  ],
);

export const guideTopicMark = pgTable(
  "guide_topic_mark",
  {
    guideId: uuid("guide_id")
      .notNull()
      .references(() => guide.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull(),
    mark: text("mark", { enum: TOPIC_MARKS }).notNull(),
    setBy: text("set_by").references(() => user.id, { onDelete: "set null" }),
    setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guideId, t.topicId] }),
    index("guide_topic_mark_workspace_idx").on(t.workspaceId),
    check("guide_topic_mark_valid", inList(t.mark, TOPIC_MARKS)),
    check("guide_topic_mark_topic_length", sql`char_length(${t.topicId}) BETWEEN 1 AND 60`),
  ],
);

// §3 Versions ---------------------------------------------------------------------------------

export const guideVersion = pgTable(
  "guide_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id")
      .notNull()
      .references((): AnyPgColumn => guide.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    cause: text("cause", { enum: GUIDE_VERSION_CAUSES }).notNull(),
    /** Built by the domain snapshot builder; never contains a locked value (research R12). */
    snapshot: jsonb("snapshot").notNull(),
    snapshotSchema: smallint("snapshot_schema").notNull(),
    languages: text("languages", { enum: GUIDE_LANGUAGES }).array().notNull(),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    sharedBlockId: uuid("shared_block_id"),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("guide_version_number_uq").on(t.guideId, t.number),
    index("guide_version_workspace_idx").on(t.workspaceId),
    check("guide_version_cause_valid", inList(t.cause, GUIDE_VERSION_CAUSES)),
    check("guide_version_number_positive", sql`${t.number} > 0`),
  ],
);

// §4 Shared content ---------------------------------------------------------------------------

export const sharedBlock = pgTable(
  "shared_block",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sectionKind: text("section_kind", { enum: DEFAULT_SECTION_KINDS }).notNull(),
    name: text("name").notNull(),
    position: smallint("position").notNull().default(0),
    revision: integer("revision").notNull().default(0),
    status: text("status", { enum: SHARED_BLOCK_STATUSES }).notNull().default("draft"),
    hasUnpublishedChanges: boolean("has_unpublished_changes").notNull().default(false),
    publishedRevision: integer("published_revision"),
    /** Reviewed items in every workspace language, as in a version snapshot (research R14). */
    publishedSnapshot: jsonb("published_snapshot"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: text("published_by").references(() => user.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("shared_block_workspace_idx").on(t.workspaceId, t.sectionKind, t.position),
    check("shared_block_section_kind_valid", inList(t.sectionKind, DEFAULT_SECTION_KINDS)),
    check("shared_block_status_valid", inList(t.status, SHARED_BLOCK_STATUSES)),
    check("shared_block_name_length", sql`char_length(${t.name}) BETWEEN 1 AND 80`),
  ],
);

export const guideSharedLink = pgTable(
  "guide_shared_link",
  {
    guideId: uuid("guide_id")
      .notNull()
      .references(() => guide.id, { onDelete: "cascade" }),
    sharedBlockId: uuid("shared_block_id")
      .notNull()
      .references(() => sharedBlock.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    mode: text("mode", { enum: SHARED_LINK_MODES }).notNull(),
    /** For `override`: the published revision copied (FR-061). */
    basedOnRevision: integer("based_on_revision"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.guideId, t.sharedBlockId] }),
    index("guide_shared_link_block_idx").on(t.sharedBlockId),
    index("guide_shared_link_workspace_idx").on(t.workspaceId),
    check("guide_shared_link_mode_valid", inList(t.mode, SHARED_LINK_MODES)),
  ],
);

// §5 Media, documents, and the interview -----------------------------------------------------

export const mediaObject = pgTable(
  "media_object",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    status: text("status", { enum: MEDIA_STATUSES }).notNull().default("uploading"),
    /** `media/{workspace_id}/{media_id}/`; never derived from the file name. */
    objectPrefix: text("object_prefix").notNull(),
    variants: jsonb("variants")
      .$type<Record<string, { key: string; bytes: number; width?: number; height?: number }>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Counts toward the storage limit only when `ready` (FR-065). */
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    videoCodec: text("video_codec", { enum: VIDEO_CODECS }),
    rejectReason: text("reject_reason"),
    uploadId: uuid("upload_id").references((): AnyPgColumn => upload.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    unreferencedSince: timestamp("unreferenced_since", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("media_object_prefix_uq").on(t.objectPrefix),
    index("media_object_workspace_idx").on(t.workspaceId, t.status),
    check("media_object_kind_valid", inList(t.kind, MEDIA_KINDS)),
    check("media_object_status_valid", inList(t.status, MEDIA_STATUSES)),
    check(
      "media_object_codec_valid",
      sql`${t.videoCodec} IS NULL OR ${inList(t.videoCodec, VIDEO_CODECS)}`,
    ),
    check(
      "media_object_duration_range",
      sql`${t.durationMs} IS NULL OR ${t.durationMs} BETWEEN 0 AND 90000`,
    ),
    check("media_object_bytes_range", sql`${t.bytes} >= 0`),
  ],
);

export const guideDocument = pgTable(
  "guide_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => guide.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    kind: text("kind", { enum: GUIDE_DOCUMENT_KINDS }).notNull(),
    status: text("status", { enum: GUIDE_DOCUMENT_STATUSES }).notNull().default("checking"),
    rejectReason: text("reject_reason"),
    pages: smallint("pages"),
    scannedPages: smallint("scanned_pages"),
    /** Read text after the detector (research R5); deleted 7 days after reading (FR-043). */
    text: text("text"),
    redactions: jsonb("redactions")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    suggestionCount: smallint("suggestion_count").notNull().default(0),
    uploadedBy: text("uploaded_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
    textDeletedAt: timestamp("text_deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("guide_document_guide_idx").on(t.guideId, t.createdAt),
    index("guide_document_workspace_idx").on(t.workspaceId),
    check("guide_document_kind_valid", inList(t.kind, GUIDE_DOCUMENT_KINDS)),
    check("guide_document_status_valid", inList(t.status, GUIDE_DOCUMENT_STATUSES)),
    check("guide_document_file_name_length", sql`char_length(${t.fileName}) BETWEEN 1 AND 120`),
    check("guide_document_text_length", sql`${t.text} IS NULL OR char_length(${t.text}) <= 200000`),
  ],
);

export const interviewSession = pgTable(
  "interview_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id")
      .notNull()
      .references(() => guide.id, { onDelete: "cascade" }),
    scopeSectionKind: text("scope_section_kind", { enum: DEFAULT_SECTION_KINDS }),
    status: text("status", { enum: INTERVIEW_STATUSES }).notNull().default("active"),
    skippedTopics: text("skipped_topics")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    startedBy: text("started_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("interview_session_active_uq")
      .on(t.guideId)
      .where(sql`${t.status} = 'active'`),
    index("interview_session_workspace_idx").on(t.workspaceId),
    check("interview_session_status_valid", inList(t.status, INTERVIEW_STATUSES)),
    check(
      "interview_session_scope_valid",
      sql`${t.scopeSectionKind} IS NULL OR ${inList(t.scopeSectionKind, DEFAULT_SECTION_KINDS)}`,
    ),
  ],
);

export const interviewTurn = pgTable(
  "interview_turn",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => interviewSession.id, { onDelete: "cascade" }),
    topicId: text("topic_id").notNull(),
    followUp: text("follow_up"),
    answerKind: text("answer_kind", { enum: ANSWER_KINDS }).notNull(),
    /** After the detector; deleted after 7 days. */
    answerText: text("answer_text"),
    /** After the detector; deleted after 7 days. */
    transcript: text("transcript"),
    uploadId: uuid("upload_id").references((): AnyPgColumn => upload.id, { onDelete: "set null" }),
    status: text("status", { enum: TURN_STATUSES }).notNull().default("queued"),
    errorCode: text("error_code"),
    redactions: jsonb("redactions")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    contentDeletedAt: timestamp("content_deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("interview_turn_session_idx").on(t.sessionId, t.createdAt),
    index("interview_turn_workspace_idx").on(t.workspaceId),
    check("interview_turn_answer_kind_valid", inList(t.answerKind, ANSWER_KINDS)),
    check("interview_turn_status_valid", inList(t.status, TURN_STATUSES)),
    check(
      "interview_turn_answer_length",
      sql`${t.answerText} IS NULL OR char_length(${t.answerText}) <= 2000`,
    ),
    check(
      "interview_turn_follow_up_length",
      sql`${t.followUp} IS NULL OR char_length(${t.followUp}) <= 300`,
    ),
    check("interview_turn_topic_length", sql`char_length(${t.topicId}) BETWEEN 1 AND 60`),
  ],
);

export const guideAiRequest = pgTable(
  "guide_ai_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    guideId: uuid("guide_id").references(() => guide.id, { onDelete: "set null" }),
    kind: text("kind", { enum: GUIDE_AI_KINDS }).notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    outcome: text("outcome", { enum: GUIDE_AI_OUTCOMES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("guide_ai_request_workspace_idx").on(t.workspaceId, t.createdAt),
    check("guide_ai_request_kind_valid", inList(t.kind, GUIDE_AI_KINDS)),
    check("guide_ai_request_outcome_valid", inList(t.outcome, GUIDE_AI_OUTCOMES)),
  ],
);
