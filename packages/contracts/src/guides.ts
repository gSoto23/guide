import { z } from "zod";
import { guideDocumentSchema, type GuideDocument } from "./guide-document.js";
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
    size: z.int().min(1).max(150 * 1024 * 1024),
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
