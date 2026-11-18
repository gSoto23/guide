/**
 * The assistant's settings (feature 007 research R1, R8): autonomy per topic, tone, quiet hours,
 * escalation contacts, and custom instructions, as a workspace default that a property follows or
 * replaces per group. The API and the worker read settings only through
 * {@link resolveAssistantSettings}, so the screen and the reply job can't disagree.
 */

/** The classifier's section topics (feature 005); `greeting` has no row. */
export const AUTONOMY_TOPICS = [
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
export type AutonomyTopic = (typeof AUTONOMY_TOPICS)[number];

/** `draft`: the host approves each reply; `auto`: grounded answers; `full_auto`: also clarify and general. */
export const AUTONOMY_LEVELS = ["draft", "auto", "full_auto"] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
export type AutonomyMap = Record<AutonomyTopic, AutonomyLevel>;

export const TONES = ["casual", "formal"] as const;
export type Tone = (typeof TONES)[number];

/** The groups a property either follows from the workspace or sets itself (FR-014). */
export const SETTINGS_GROUPS = ["autonomy", "tone", "quiet_hours", "contacts"] as const;
export type SettingsGroup = (typeof SETTINGS_GROUPS)[number];
export type SettingsSource = "workspace" | "property";

export const CONTACT_MODES = ["all", "selected"] as const;
export type ContactMode = (typeof CONTACT_MODES)[number];

/** A daily window in the property's time zone, `HH:MM` local wall times (research R6). */
export interface QuietHours {
  start: string;
  end: string;
}

export type ContactsSetting = { mode: "all" } | { mode: "selected"; membershipIds: string[] };

export interface InstructionRef {
  versionId: string;
  text: string;
}

/** One stored scope (an `assistant_settings` row with its contacts and current instructions). */
export interface AssistantSettingsRow {
  autonomy: Record<string, unknown> | null;
  tone: Tone;
  quietEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  contactsMode: ContactMode;
  contactMembershipIds: readonly string[];
  /** Property rows only: the groups the property sets itself. */
  ownGroups: readonly string[];
  instruction: InstructionRef | null;
}

export interface EffectiveAssistantSettings {
  autonomy: AutonomyMap;
  tone: Tone;
  quietHours: QuietHours | null;
  contacts: ContactsSetting;
  sources: Record<SettingsGroup, SettingsSource>;
  instructions: { workspace: InstructionRef | null; property: InstructionRef | null };
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isAutonomyLevel(value: unknown): value is AutonomyLevel {
  return typeof value === "string" && (AUTONOMY_LEVELS as readonly string[]).includes(value);
}

export function isAutonomyTopic(value: unknown): value is AutonomyTopic {
  return typeof value === "string" && (AUTONOMY_TOPICS as readonly string[]).includes(value);
}

/** True for a valid `HH:MM` wall time. */
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

/** Every topic at one level; new workspaces start at `draft` (FR-001). */
export function uniformAutonomy(level: AutonomyLevel = "draft"): AutonomyMap {
  return Object.fromEntries(AUTONOMY_TOPICS.map((topic) => [topic, level])) as AutonomyMap;
}

/** Missing or invalid topics read as `draft`; unknown keys are dropped. */
export function normalizeAutonomy(raw: Record<string, unknown> | null | undefined): AutonomyMap {
  const map = uniformAutonomy("draft");
  if (!raw) return map;
  for (const topic of AUTONOMY_TOPICS) {
    const level = raw[topic];
    if (isAutonomyLevel(level)) map[topic] = level;
  }
  return map;
}

/** The level for a classified topic; topics without a row (a future section kind) follow `other`. */
export function levelFor(autonomy: AutonomyMap, topic: string): AutonomyLevel {
  return isAutonomyTopic(topic) ? autonomy[topic] : autonomy.other;
}

/** `HH:MM` from a database `time` (`HH:MM:SS`) or null. */
export function clockOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const short = value.slice(0, 5);
  return isClockTime(short) ? short : null;
}

function quietOf(row: AssistantSettingsRow | null): QuietHours | null {
  if (!row?.quietEnabled) return null;
  const start = clockOf(row.quietStart);
  const end = clockOf(row.quietEnd);
  return start && end && start !== end ? { start, end } : null;
}

function contactsOf(row: AssistantSettingsRow | null): ContactsSetting {
  if (!row || row.contactsMode === "all") return { mode: "all" };
  return { mode: "selected", membershipIds: [...row.contactMembershipIds] };
}

/** The defaults a missing row stands for (research R8). */
export const DEFAULT_ASSISTANT_SETTINGS: Readonly<
  Omit<EffectiveAssistantSettings, "sources" | "instructions">
> = Object.freeze({
  autonomy: uniformAutonomy("draft"),
  tone: "casual" as Tone,
  quietHours: null,
  contacts: { mode: "all" } as ContactsSetting,
});

/**
 * The settings that apply to a property (FR-014): each group comes from the property row when the
 * property sets it itself, otherwise from the workspace row, otherwise from the defaults. Custom
 * instructions add up: the workspace's, then the property's (FR-011).
 */
export function resolveAssistantSettings(
  workspaceRow: AssistantSettingsRow | null,
  propertyRow: AssistantSettingsRow | null,
): EffectiveAssistantSettings {
  const own = new Set(propertyRow?.ownGroups ?? []);
  const pick = (group: SettingsGroup): [AssistantSettingsRow | null, SettingsSource] =>
    propertyRow && own.has(group) ? [propertyRow, "property"] : [workspaceRow, "workspace"];

  const [autonomyRow, autonomySource] = pick("autonomy");
  const [toneRow, toneSource] = pick("tone");
  const [quietRow, quietSource] = pick("quiet_hours");
  const [contactsRow, contactsSource] = pick("contacts");

  return {
    autonomy: normalizeAutonomy(autonomyRow?.autonomy),
    tone: toneRow?.tone ?? "casual",
    quietHours: quietOf(quietRow),
    contacts: contactsOf(contactsRow),
    sources: {
      autonomy: autonomySource,
      tone: toneSource,
      quiet_hours: quietSource,
      contacts: contactsSource,
    },
    instructions: {
      workspace: workspaceRow?.instruction ?? null,
      property: propertyRow?.instruction ?? null,
    },
  };
}
