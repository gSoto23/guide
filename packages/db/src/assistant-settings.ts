import { and, eq, inArray, isNull, or } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";
import {
  assistantContact,
  assistantInstructionVersion,
  assistantSettings,
} from "./schema/assistant.js";

/**
 * Loads a workspace's and a property's assistant settings rows with their contacts and current
 * instructions (feature 007 research R8). The shape matches the domain's `AssistantSettingsRow`, so
 * callers pass it straight to `resolveAssistantSettings`. Works in the system context (worker) and
 * in a request transaction (API, under RLS).
 */
export interface StoredAssistantSettings {
  id: string;
  propertyId: string | null;
  autonomy: Record<string, string>;
  tone: "casual" | "formal";
  quietEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  contactsMode: "all" | "selected";
  contactMembershipIds: string[];
  ownGroups: string[];
  instruction: { versionId: string; text: string } | null;
  instructionCreatedAt: Date | null;
  instructionCreatedBy: string | null;
  version: number;
}

export async function loadAssistantSettingsRows(
  db: Database | Transaction,
  workspaceId: string,
  propertyId: string | null,
): Promise<{
  workspace: StoredAssistantSettings | null;
  property: StoredAssistantSettings | null;
}> {
  const rows = await db
    .select({
      id: assistantSettings.id,
      propertyId: assistantSettings.propertyId,
      autonomy: assistantSettings.autonomy,
      tone: assistantSettings.tone,
      quietEnabled: assistantSettings.quietEnabled,
      quietStart: assistantSettings.quietStart,
      quietEnd: assistantSettings.quietEnd,
      contactsMode: assistantSettings.contactsMode,
      ownGroups: assistantSettings.ownGroups,
      version: assistantSettings.version,
      instructionId: assistantInstructionVersion.id,
      instructionText: assistantInstructionVersion.text,
      instructionCreatedAt: assistantInstructionVersion.createdAt,
      instructionCreatedBy: assistantInstructionVersion.createdBy,
    })
    .from(assistantSettings)
    .leftJoin(
      assistantInstructionVersion,
      eq(assistantInstructionVersion.id, assistantSettings.instructionVersionId),
    )
    .where(
      and(
        eq(assistantSettings.workspaceId, workspaceId),
        propertyId
          ? or(isNull(assistantSettings.propertyId), eq(assistantSettings.propertyId, propertyId))
          : isNull(assistantSettings.propertyId),
      ),
    );
  const contacts = rows.length
    ? await db
        .select({
          settingsId: assistantContact.settingsId,
          membershipId: assistantContact.membershipId,
        })
        .from(assistantContact)
        .where(
          inArray(
            assistantContact.settingsId,
            rows.map((row) => row.id),
          ),
        )
    : [];
  const toStored = (row: (typeof rows)[number]): StoredAssistantSettings => ({
    id: row.id,
    propertyId: row.propertyId,
    autonomy: row.autonomy,
    tone: row.tone,
    quietEnabled: row.quietEnabled,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
    contactsMode: row.contactsMode,
    contactMembershipIds: contacts
      .filter((contact) => contact.settingsId === row.id)
      .map((contact) => contact.membershipId),
    ownGroups: row.ownGroups,
    instruction:
      row.instructionId && row.instructionText
        ? { versionId: row.instructionId, text: row.instructionText }
        : null,
    instructionCreatedAt: row.instructionCreatedAt,
    instructionCreatedBy: row.instructionCreatedBy,
    version: row.version,
  });
  const workspaceRow = rows.find((row) => row.propertyId === null);
  const propertyRow = propertyId ? rows.find((row) => row.propertyId === propertyId) : undefined;
  return {
    workspace: workspaceRow ? toStored(workspaceRow) : null,
    property: propertyRow ? toStored(propertyRow) : null,
  };
}
