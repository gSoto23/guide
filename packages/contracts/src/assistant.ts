import { z } from "zod";
import type { ChatSectionRef, NeedsHostReasonValue } from "./chat.js";

/**
 * The assistant's settings and tests (feature 007 contracts/http-api.md). These routes replace
 * feature 005's `assistant-settings` routes.
 */
export const ASSISTANT_TOPICS = [
  "arrival",
  "wifi",
  "house_rules",
  "appliances",
  "amenities",
  "parking",
  "local_recommendations",
  "emergency",
  "checkout",
  "other",
] as const;
export type AssistantTopic = (typeof ASSISTANT_TOPICS)[number];

export const ASSISTANT_LEVELS = ["draft", "auto", "full_auto"] as const;
export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];
export type AssistantTone = "casual" | "formal";
export type AutonomyByTopic = Record<AssistantTopic, AssistantLevel>;

/** The mandatory escalation rows shown locked on the screen (FR-002). */
export const LOCKED_CATEGORIES = [
  "emergency",
  "malfunction",
  "complaint",
  "money",
  "reservation_change",
  "legal",
  "codes",
  "not_confident",
] as const;

export const INSTRUCTIONS_MAX_LENGTH = 1000;
export const ASSISTANT_TEST_QUESTION_MAX = 2000;

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const autonomyByTopicSchema = z
  .object(
    Object.fromEntries(
      ASSISTANT_TOPICS.map((topic) => [topic, z.enum(ASSISTANT_LEVELS)]),
    ) as Record<
      AssistantTopic,
      z.ZodEnum<{ draft: "draft"; auto: "auto"; full_auto: "full_auto" }>
    >,
  )
  .strict();

export const quietHoursSchema = z
  .object({ enabled: z.boolean(), start: clock.nullable(), end: clock.nullable() })
  .strict()
  .refine(
    (value) =>
      !value.enabled || (value.start !== null && value.end !== null && value.start !== value.end),
    { message: "Quiet hours need a start and a different end" },
  );
export type QuietHoursSetting = z.infer<typeof quietHoursSchema>;

export const contactsSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("all") }).strict(),
  z.object({ mode: z.literal("selected"), memberIds: z.array(z.uuid()).max(200) }).strict(),
]);
export type ContactsSettingValue = z.infer<typeof contactsSchema>;

const groups = {
  autonomy: autonomyByTopicSchema,
  tone: z.enum(["casual", "formal"]),
  quietHours: quietHoursSchema,
  contacts: contactsSchema,
};

const instructionsInput = z.string().max(5000);

export const workspaceAssistantInputSchema = z
  .object({ version: z.number().int().min(0), ...groups, instructions: instructionsInput })
  .strict();
export type WorkspaceAssistantInput = z.infer<typeof workspaceAssistantInputSchema>;

export const propertyAssistantInputSchema = z
  .object({
    version: z.number().int().min(0),
    follows: z
      .object({
        autonomy: z.boolean(),
        tone: z.boolean(),
        quietHours: z.boolean(),
        contacts: z.boolean(),
      })
      .strict(),
    own: z.object(groups).strict(),
    instructions: instructionsInput,
  })
  .strict();
export type PropertyAssistantInput = z.infer<typeof propertyAssistantInputSchema>;

export interface AssistantGroups {
  autonomy: AutonomyByTopic;
  tone: AssistantTone;
  quietHours: QuietHoursSetting;
  contacts: ContactsSettingValue;
}

export interface AssistantInstructions {
  text: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface AssistantMember {
  id: string;
  name: string;
  role: "owner" | "admin" | "agent";
}

export interface WorkspaceAssistant extends AssistantGroups {
  version: number;
  instructions: AssistantInstructions | null;
  members: AssistantMember[];
  canEdit: boolean;
}

export interface PropertyAssistant {
  version: number;
  follows: { autonomy: boolean; tone: boolean; quietHours: boolean; contacts: boolean };
  own: AssistantGroups;
  instructions: AssistantInstructions | null;
  workspace: AssistantGroups & { instructions: AssistantInstructions | null };
  effective: AssistantGroups;
  timeZone: string | null;
  hasPublishedGuide: boolean;
  members: AssistantMember[];
  canEdit: boolean;
}

export const assistantTestSchema = z
  .object({
    question: z.string().trim().min(1).max(ASSISTANT_TEST_QUESTION_MAX),
    /** The member's screen language: holding replies and pointers come in it. */
    language: z.enum(["es", "en"]).default("es"),
  })
  .strict();
export type AssistantTestBody = z.infer<typeof assistantTestSchema>;

export type AssistantTestOutcome =
  | "sent"
  | "draft"
  | "held"
  | "pointer"
  | "greeting"
  | "limited"
  | "monthly_limited"
  | "unavailable";

export interface AssistantTest {
  id: string;
  status: "pending" | "done";
  question: string;
  outcome: AssistantTestOutcome | null;
  reason: NeedsHostReasonValue | null;
  topic: string | null;
  answerKind: "grounded" | "general" | "clarify" | null;
  reply: string | null;
  sections: ChatSectionRef[];
  createdAt: string;
}
