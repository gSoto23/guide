import { z } from "zod";
import {
  guideDocumentSchema,
  sharedBlockDocumentSchema,
  type GuideDocument,
} from "./guide-document.js";
import {
  BENEFIT_VALUES,
  DEFAULT_SECTION_KIND_VALUES,
  FACT_KEY_VALUES,
  GUIDE_DRAFT_STATE_VALUES,
  GUIDE_ITEM_KIND_VALUES,
  GUIDE_ITEM_SOURCE_VALUES,
  GUIDE_LANGUAGE_VALUES,
  GUIDE_STATUS_VALUES,
  LOCKED_FIELD_KIND_VALUES,
  MEDIA_KIND_VALUES,
  MEDIA_STATUS_VALUES,
  RECOMMENDATION_CATEGORY_VALUES,
  SECTION_KIND_VALUES,
  SECTION_STATUS_VALUES,
  TEXT_ORIGIN_VALUES,
  TEXT_PENDING_REASON_VALUES,
  TEXT_STATE_VALUES,
  TOPIC_MARK_VALUES,
} from "./values.js";

/** Contracts for the guide builder (feature 003 contracts/http-api.md). */
const language = z.enum(GUIDE_LANGUAGE_VALUES);
type Language = z.infer<typeof language>;

const customTitle = z
  .object({
    es: z.string().trim().min(1).max(80).optional(),
    en: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((title) => Boolean(title.es || title.en), { message: "A title needs a language" });

const revision = z.int().min(0);

const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:";
    } catch {
      return false;
    }
  }, "Use a web address");

/** A recommendation (FR-014, PC-07); the benefit answer is required before approval. */
export const recommendationSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    category: z.enum(RECOMMENDATION_CATEGORY_VALUES),
    url: httpUrl.optional(),
    address: z.string().trim().min(1).max(200).optional(),
    benefit: z.enum(BENEFIT_VALUES).optional(),
    benefitNote: z.string().trim().min(1).max(200).optional(),
    personalTip: z.boolean().default(false),
  })
  .strict();
export type Recommendation = z.infer<typeof recommendationSchema>;

export const createSectionSchema = z
  .object({ title: customTitle, position: z.int().min(0).max(30).optional() })
  .strict();
export type CreateSectionBody = z.infer<typeof createSectionSchema>;

export const updateSectionSchema = z
  .object({ revision, title: customTitle.optional(), hidden: z.boolean().optional() })
  .strict();
export type UpdateSectionBody = z.infer<typeof updateSectionSchema>;

export const orderSectionsSchema = z
  .object({ sectionIds: z.array(z.uuid()).min(1).max(30) })
  .strict();
export type OrderSectionsBody = z.infer<typeof orderSectionsSchema>;

export const revisionBodySchema = z.object({ revision }).strict();
export type RevisionBody = z.infer<typeof revisionBodySchema>;

export const createItemSchema = z
  .object({
    revision,
    kind: z.enum(["text", "image", "video", "recommendation"]),
    position: z.int().min(0).max(500).optional(),
    language,
    doc: guideDocumentSchema.optional(),
    mediaId: z.uuid().optional(),
    recommendation: recommendationSchema.optional(),
  })
  .strict()
  .refine((body) => (body.kind === "image" || body.kind === "video") === Boolean(body.mediaId), {
    message: "Images and videos need their media, and only they",
    path: ["mediaId"],
  })
  .refine((body) => (body.kind === "recommendation") === Boolean(body.recommendation), {
    message: "Recommendations need their details, and only they",
    path: ["recommendation"],
  })
  .refine((body) => body.kind !== "text" || Boolean(body.doc), {
    message: "Text items need a document",
    path: ["doc"],
  });
export type CreateItemBody = z.infer<typeof createItemSchema>;

/** Host actions on one translation (FR-045, FR-046). */
export const translationActionSchema = z
  .object({ revision, action: z.enum(["translate_again", "keep", "mark_reviewed"]) })
  .strict();
export type TranslationActionBody = z.infer<typeof translationActionSchema>;

export const updateItemSchema = z
  .object({
    revision,
    language,
    doc: guideDocumentSchema.optional(),
    recommendation: recommendationSchema.optional(),
    /** Keep the text as it is despite a code warning (FR-023). */
    keepCodeWarning: z.boolean().optional(),
  })
  .strict();
export type UpdateItemBody = z.infer<typeof updateItemSchema>;

export const orderItemsSchema = z
  .object({ revision, itemIds: z.array(z.uuid()).min(1).max(500) })
  .strict();
export type OrderItemsBody = z.infer<typeof orderItemsSchema>;

export const topicMarkSchema = z.object({ mark: z.enum(TOPIC_MARK_VALUES).nullable() }).strict();
export type TopicMarkBody = z.infer<typeof topicMarkSchema>;

// Responses ------------------------------------------------------------------------------------

export interface ItemText {
  doc: GuideDocument | null;
  origin: (typeof TEXT_ORIGIN_VALUES)[number];
  state: (typeof TEXT_STATE_VALUES)[number];
  pendingReason: (typeof TEXT_PENDING_REASON_VALUES)[number] | null;
}

export interface MediaView {
  id: string;
  kind: (typeof MEDIA_KIND_VALUES)[number];
  status: (typeof MEDIA_STATUS_VALUES)[number];
  rejectReason: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  videoCodec: "h264" | "hevc" | null;
  /** Signed URLs, valid 15 minutes, only when ready. */
  urls: Partial<Record<"large" | "small" | "original", string>>;
}

export interface ItemView {
  id: string;
  kind: (typeof GUIDE_ITEM_KIND_VALUES)[number];
  position: number;
  source: (typeof GUIDE_ITEM_SOURCE_VALUES)[number];
  sourceDetail: string | null;
  reviewed: boolean;
  sourceLanguage: Language;
  topics: string[];
  factKey: (typeof FACT_KEY_VALUES)[number] | null;
  media: MediaView | null;
  recommendation: Recommendation | null;
  texts: Partial<Record<Language, ItemText>>;
  /** Set when inherited from a published shared block (FR-059). */
  sharedBlockId: string | null;
}

export interface SectionView {
  id: string;
  kind: (typeof SECTION_KIND_VALUES)[number];
  title: Partial<Record<Language, string>> | null;
  position: number;
  hidden: boolean;
  revision: number;
  status: (typeof SECTION_STATUS_VALUES)[number];
  completeness: number | null;
  items: ItemView[];
}

/** A locked field as the portal sees it: never its value (FR-016, FR-063). */
export type LockedFieldView =
  | {
      id: string;
      kind: (typeof LOCKED_FIELD_KIND_VALUES)[number];
      label: string;
      sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
      isSet: boolean;
      isPublic: boolean;
      source: "pms" | "host" | "copy";
      valueSetAt: string | null;
      updatedBy: string | null;
    }
  | { id: string; kind: (typeof LOCKED_FIELD_KIND_VALUES)[number]; label: string; locked: true };

export interface MissingTopic {
  topicId: string;
  sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
  weight: number;
}

export interface GuideView {
  id: string;
  propertyId: string;
  propertyName: string;
  status: (typeof GUIDE_STATUS_VALUES)[number];
  hasUnpublishedChanges: boolean;
  publishedVersion: number | null;
  draftState: (typeof GUIDE_DRAFT_STATE_VALUES)[number];
  completeness: number;
  languages: Language[];
  mainLanguage: Language;
  setupReady: boolean;
  facts: {
    checkInTime: string | null;
    checkoutTime: string | null;
    maxGuests: number | null;
    address: string | null;
  };
  sections: SectionView[];
  lockedFields: LockedFieldView[];
  missingTopics: MissingTopic[];
  topicMarks: Record<string, (typeof TOPIC_MARK_VALUES)[number]>;
  /** The workspace's published shared blocks and how this guide uses each (US7). */
  sharedBlocks: GuideSharedBlock[];
  canEdit: boolean;
}

export interface CodeWarning {
  kind: (typeof LOCKED_FIELD_KIND_VALUES)[number];
  language: Language;
  blockIndex: number;
}

/** The answer to every section or item write (FR-011 to FR-013, FR-031). */
export interface SectionWriteResult {
  section: SectionView;
  guide: { completeness: number; hasUnpublishedChanges: boolean };
  warnings: CodeWarning[];
  item?: ItemView;
}

export const createMediaSchema = z
  .object({
    kind: z.enum(MEDIA_KIND_VALUES),
    contentType: z.enum(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"]),
    size: z
      .int()
      .min(1)
      .max(150 * 1024 * 1024),
    fileName: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((body) => (body.kind === "image") === body.contentType.startsWith("image/"), {
    message: "The type does not match the kind",
    path: ["contentType"],
  })
  .refine((body) => body.kind === "video" || body.size <= 10 * 1024 * 1024, {
    message: "Images are at most 10 MB",
    path: ["size"],
  });
export type CreateMediaBody = z.infer<typeof createMediaSchema>;

export interface MediaUpload {
  mediaId: string;
  upload: { url: string; fields: Record<string, string> };
}

// Locked fields (feature 003 contract "Locked fields") -------------------------------------------

const lockedValue = z.string().min(1).max(200);
const lockedLabel = z.string().trim().min(1).max(80);

export const createLockedFieldSchema = z
  .object({
    kind: z.enum(LOCKED_FIELD_KIND_VALUES),
    label: lockedLabel.optional(),
    value: lockedValue.optional(),
    sectionKind: z.enum(DEFAULT_SECTION_KIND_VALUES).optional(),
  })
  .strict();
export type CreateLockedFieldBody = z.infer<typeof createLockedFieldSchema>;

export const updateLockedFieldSchema = z
  .object({ label: lockedLabel.optional(), value: lockedValue.optional() })
  .strict()
  .refine((body) => body.label !== undefined || body.value !== undefined, {
    message: "Change the label or the value",
  });
export type UpdateLockedFieldBody = z.infer<typeof updateLockedFieldSchema>;

export const lockedFieldVisibilitySchema = z.object({ public: z.boolean() }).strict();
export type LockedFieldVisibilityBody = z.infer<typeof lockedFieldVisibilitySchema>;

export const moveToLockedFieldSchema = z
  .object({
    revision: z.int().min(0),
    language: z.enum(GUIDE_LANGUAGE_VALUES),
    blockIndex: z.int().min(0).max(4000),
    kind: z.enum(LOCKED_FIELD_KIND_VALUES),
    label: lockedLabel.optional(),
  })
  .strict();
export type MoveToLockedFieldBody = z.infer<typeof moveToLockedFieldSchema>;

export interface RevealedValue {
  value: string;
  hideAfterSeconds: number;
}

export interface RevealHistory {
  items: {
    fieldId: string;
    kind: string;
    label: string;
    revealedBy: string | null;
    at: string;
    /** Feature 004: a member, a guest with a stay link, or a stay message copied with codes. */
    source: "member" | "guest" | "export";
  }[];
}

// Preview, publishing, and versions (feature 003 contract "Preview, publishing, and versions") -----

/** What blocks publishing, what is left out, and warnings that never block (FR-049, FR-050). */
export interface PublishCheck {
  ready: boolean;
  blockers: ("not_ready" | "pending_deletion")[];
  leftOut: { sectionId: string; itemIds: string[] }[];
  warnings: (
    | {
        kind: "missing_essential";
        topicId: string;
        sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
      }
    | { kind: "unset_locked_field"; fieldId: string }
    | { kind: "code_like_text"; sectionId: string; itemId: string }
    | { kind: "off_platform"; sectionId: string; itemId: string }
    | { kind: "unreviewed_translations"; count: number }
    | { kind: "out_of_date_translations"; count: number }
  )[];
  /** Sent back with the publish, so the host publishes what they reviewed (FR-051). */
  revisionHash: string;
}

export const publishSchema = z
  .object({ expectedRevisionHash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
export type PublishBody = z.infer<typeof publishSchema>;

export interface PublishResult {
  versionNumber: number;
}

export interface GuideVersionSummary {
  number: number;
  cause: "publish" | "shared_block" | "shared_block_removed";
  publishedBy: string | null;
  publishedAt: string;
  current: boolean;
}

export interface GuideVersionList {
  items: GuideVersionSummary[];
}

export const previewQuerySchema = z
  .object({
    source: z
      .union([z.enum(["draft", "published"]), z.string().regex(/^[1-9]\d{0,5}$/)])
      .default("draft"),
    lang: language.optional(),
  })
  .strict();
export type PreviewQuery = z.infer<typeof previewQuerySchema>;

/** One item as guests will see it; locked fields stay references (FR-054). */
export interface PreviewItem {
  id: string;
  kind: (typeof GUIDE_ITEM_KIND_VALUES)[number];
  shared: boolean;
  doc: GuideDocument | null;
  /** The language `doc` is in: the preview language, or the item's source when untranslated. */
  docLanguage: Language;
  fact?: { key: (typeof FACT_KEY_VALUES)[number]; value: string | null };
  media?: MediaView | null;
  recommendation?: Recommendation;
}

/** The guide as guests will see it, in one language (FR-054). */
export interface GuidePreview {
  source: "draft" | "published" | "version";
  versionNumber: number | null;
  language: Language;
  languages: Language[];
  propertyName: string;
  sections: {
    id: string;
    kind: (typeof SECTION_KIND_VALUES)[number];
    title: string | null;
    items: PreviewItem[];
  }[];
  /** Labels for the placeholders; never values. */
  lockedFields: { id: string; kind: (typeof LOCKED_FIELD_KIND_VALUES)[number]; label: string }[];
}

// Interview (feature 003 contract "Interview") -----------------------------------------------------

const topicIdSchema = z
  .string()
  .regex(/^[a-z_]+\.[a-z_]+$/)
  .max(80);

export const startInterviewSchema = z
  .object({ sectionKind: z.enum(DEFAULT_SECTION_KIND_VALUES).optional() })
  .strict();
export type StartInterviewBody = z.infer<typeof startInterviewSchema>;

/** A typed answer (at most 2,000 characters) or an uploaded voice note (FR-035, FR-037). */
export const interviewAnswerSchema = z.union([
  z.object({ topicId: topicIdSchema, text: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ topicId: topicIdSchema, voiceUploadId: z.uuid() }).strict(),
]);
export type InterviewAnswerBody = z.infer<typeof interviewAnswerSchema>;

export const VOICE_CONTENT_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/x-m4a"] as const;

export const interviewVoiceSchema = z
  .object({
    contentType: z.enum(VOICE_CONTENT_TYPES),
    size: z
      .int()
      .min(1)
      .max(10 * 1024 * 1024),
  })
  .strict();
export type InterviewVoiceBody = z.infer<typeof interviewVoiceSchema>;

export const interviewTopicSchema = z.object({ topicId: topicIdSchema }).strict();
export type InterviewTopicBody = z.infer<typeof interviewTopicSchema>;

/** The next question: from the catalog, or the model's one follow-up for the topic (R11). */
export interface InterviewQuestion {
  topicId: string;
  sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
  followUp?: string;
  /** A code topic: the portal opens the locked-field form instead of asking (FR-038). */
  opensLockedField?: (typeof LOCKED_FIELD_KIND_VALUES)[number];
}

export interface InterviewTurnView {
  id: string;
  topicId: string;
  answerKind: "text" | "voice";
  status: "queued" | "transcribing" | "drafting" | "done" | "failed";
  /** `not_understood`, `transcription_failed`, `ai_unavailable`, or `unsupported_type`. */
  errorCode: string | null;
  /** The answer and transcript after the restricted-value detector; kept 7 days. */
  answerText: string | null;
  transcript: string | null;
  /** How many codes the detector removed, by kind (AC-SEC-004). */
  redactions: Record<string, number>;
  followUp: string | null;
  itemIds: string[];
  createdAt: string;
}

export interface InterviewView {
  sessionId: string;
  status: "active" | "finished";
  scopeSectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number] | null;
  question: InterviewQuestion | null;
  turns: InterviewTurnView[];
  /** Voice notes are on (`guide.interviewVoice`). */
  voiceEnabled: boolean;
}

export interface CompletenessView {
  guide: number;
  sections: Partial<Record<(typeof DEFAULT_SECTION_KIND_VALUES)[number], number>>;
  missing: MissingTopic[];
  marks: Record<string, (typeof TOPIC_MARK_VALUES)[number]>;
}

// Documents (feature 003 contract "Documents") ---------------------------------------------------

/** PDF manuals and photos read for knowledge, 1–10 per request (FR-039). */
export const createDocumentsSchema = z
  .object({
    files: z
      .array(
        z
          .object({
            fileName: z.string().trim().min(1).max(200),
            contentType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
            size: z
              .int()
              .min(1)
              .max(20 * 1024 * 1024),
          })
          .strict()
          .refine(
            (file) => file.contentType === "application/pdf" || file.size <= 10 * 1024 * 1024,
            {
              message: "Photos are at most 10 MB",
              path: ["size"],
            },
          ),
      )
      .min(1)
      .max(10),
  })
  .strict();
export type CreateDocumentsBody = z.infer<typeof createDocumentsSchema>;

export interface DocumentUpload {
  documentId: string;
  upload: { url: string; fields: Record<string, string> };
}

export interface DocumentView {
  id: string;
  fileName: string;
  kind: "pdf" | "photo";
  status: "checking" | "reading" | "done" | "rejected";
  /** Why it was not read, or `nothing_found` when nothing useful was in it. */
  rejectReason: string | null;
  pages: number | null;
  scannedPages: number | null;
  /** How many codes the detector removed, by kind; never values. */
  redactions: Record<string, number>;
  /** Unreviewed suggestions still in the guide (FR-041). */
  suggestionItemIds: string[];
  createdAt: string;
}

export interface DocumentList {
  items: DocumentView[];
}

// Shared content (feature 003 contract "Shared content") ------------------------------------------

export const createSharedBlockSchema = z
  .object({
    sectionKind: z.enum(DEFAULT_SECTION_KIND_VALUES),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export type CreateSharedBlockBody = z.infer<typeof createSharedBlockSchema>;

export const updateSharedBlockSchema = z
  .object({
    revision,
    name: z.string().trim().min(1).max(80).optional(),
    position: z.int().min(0).max(200).optional(),
  })
  .strict();
export type UpdateSharedBlockBody = z.infer<typeof updateSharedBlockSchema>;

/** Items of a shared block: as in sections, but locked fields are refused (FR-057). */
export const createBlockItemSchema = z
  .object({
    revision,
    kind: z.enum(["text", "image", "video", "recommendation"]),
    language,
    doc: sharedBlockDocumentSchema.optional(),
    mediaId: z.uuid().optional(),
    recommendation: recommendationSchema.optional(),
  })
  .strict()
  .refine((body) => (body.kind === "image" || body.kind === "video") === Boolean(body.mediaId), {
    message: "Images and videos need their media, and only they",
    path: ["mediaId"],
  })
  .refine((body) => (body.kind === "recommendation") === Boolean(body.recommendation), {
    message: "Recommendations need their details, and only they",
    path: ["recommendation"],
  })
  .refine((body) => body.kind !== "text" || Boolean(body.doc), {
    message: "Text items need a document",
    path: ["doc"],
  });
export type CreateBlockItemBody = z.infer<typeof createBlockItemSchema>;

export const updateBlockItemSchema = z
  .object({
    revision,
    language,
    doc: sharedBlockDocumentSchema.optional(),
    recommendation: recommendationSchema.optional(),
  })
  .strict();
export type UpdateBlockItemBody = z.infer<typeof updateBlockItemSchema>;

export interface SharedBlockSummary {
  id: string;
  name: string;
  sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
  position: number;
  status: "draft" | "published";
  revision: number;
  hasUnpublishedChanges: boolean;
  publishedRevision: number | null;
  counts: { inherit: number; override: number; exclude: number };
}

export interface SharedBlockList {
  items: SharedBlockSummary[];
  limit: number;
}

export interface SharedBlockView extends SharedBlockSummary {
  items: ItemView[];
  languages: Language[];
  canEdit: boolean;
}

export interface SharedBlockPublishResult {
  publishedRevision: number;
  guidesToUpdate: number;
}

export interface SharedBlockProperties {
  inherit: { propertyId: string; name: string }[];
  override: { propertyId: string; name: string; behind: boolean }[];
  exclude: { propertyId: string; name: string }[];
}

/** A published shared block as one property's guide sees it (FR-058, FR-059, FR-061). */
export interface GuideSharedBlock {
  id: string;
  name: string;
  sectionKind: (typeof DEFAULT_SECTION_KIND_VALUES)[number];
  mode: "inherit" | "override" | "exclude";
  /** An override made from an older published revision: "The shared version changed". */
  behind: boolean;
}
