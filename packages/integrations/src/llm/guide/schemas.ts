import { z } from "zod";

/**
 * What the model returns for the guide builder's calls (feature 003 research R6). The model gives
 * plain text and topic IDs; Guidesk builds the documents, validates the topics against its list,
 * and keeps only links that were in the input, so nothing the model returns can carry markup.
 *
 * The section kinds repeat `DEFAULT_SECTION_KINDS` from `@guidesk/domain`, which this package does
 * not depend on; a domain test keeps the two lists equal.
 */
export const GUIDE_SECTION_KINDS = [
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
export type GuideSectionKindValue = (typeof GUIDE_SECTION_KINDS)[number];

export const draftedItemSchema = z.object({
  sectionKind: z.enum(GUIDE_SECTION_KINDS),
  /** Plain text; paragraphs separated by a blank line, list items starting with "- ". */
  text: z.string(),
  /** Topic IDs from the list in the prompt. */
  topics: z.array(z.string()),
});
export type DraftedItem = z.infer<typeof draftedItemSchema>;

export const draftItemsSchema = z.object({ items: z.array(draftedItemSchema) });
export type DraftItems = z.infer<typeof draftItemsSchema>;

export const draftAnswerSchema = z.object({
  items: z.array(draftedItemSchema),
  /** One follow-up question when the answer leaves the topic uncovered, else null (research R11). */
  followUp: z.string().nullable(),
});
export type DraftAnswer = z.infer<typeof draftAnswerSchema>;

export const translatedBlocksSchema = z.object({ blocks: z.array(z.string()) });
export type TranslatedBlocks = z.infer<typeof translatedBlocksSchema>;

export interface TopicHint {
  id: string;
  sectionKind: GuideSectionKindValue;
}

export interface DraftFromListingInput {
  /** The guide's main language (FR-003). */
  language: "es" | "en";
  /** The listing description after the restricted-value detector (research R5). */
  description: string;
  topics: readonly TopicHint[];
}

export interface DraftAnswerInput {
  language: "es" | "en";
  topicId: string;
  sectionKind: GuideSectionKindValue;
  /** The question as the host saw it. */
  question: string;
  /** The answer or transcript after the detector. */
  answer: string;
  topics: readonly TopicHint[];
}

export interface SuggestFromDocumentInput {
  language: "es" | "en";
  fileName: string;
  /** Read text after the detector, at most 60,000 characters. */
  text: string;
  topics: readonly TopicHint[];
}

export interface TranslateBlocksInput {
  from: "es" | "en";
  to: "es" | "en";
  /** Text blocks with tags and placeholders (research R7); empty blocks are never sent. */
  blocks: readonly string[];
}
