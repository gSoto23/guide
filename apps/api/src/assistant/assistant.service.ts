import { createRequire } from "node:module";
import { Injectable } from "@nestjs/common";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  AssistantGroups,
  AssistantInstructions,
  AssistantMember,
  AssistantTest,
  AssistantTestBody,
  NeedsHostReasonValue,
  PropertyAssistant,
  PropertyAssistantInput,
  WorkspaceAssistant,
  WorkspaceAssistantInput,
} from "@guidesk/contracts";
import {
  assistantContact,
  assistantInstructionVersion,
  assistantSettings,
  assistantTest,
  guide,
  guideVersion,
  loadAssistantSettingsRows,
  membership,
  property,
  user,
  type StoredAssistantSettings,
} from "@guidesk/db";
import {
  can,
  clockOf,
  instructionIssues,
  JOB_QUEUES,
  normalizeAutonomy,
  resolveAssistantSettings,
  type AssistantTestJob,
  type GuideSnapshot,
  type Role,
  type SettingsGroup,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { RequestDb } from "../database/request-db.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";

export interface AssistantCaller {
  userId: string;
  role: Role;
}

/** Feature 007 research R12: 30 tests per member per hour. */
const TESTS_PER_HOUR = 30;

const require = createRequire(import.meta.url);
type GuestCatalog = { sections: Record<string, string> };
const SECTION_TITLES: Record<"es" | "en", Record<string, string>> = {
  es: (require("@guidesk/i18n/messages/guest.es.json") as GuestCatalog).sections,
  en: (require("@guidesk/i18n/messages/guest.en.json") as GuestCatalog).sections,
};

const DEFAULT_GROUPS: AssistantGroups = {
  autonomy: normalizeAutonomy(null),
  tone: "casual",
  quietHours: { enabled: false, start: null, end: null },
  contacts: { mode: "all" },
};

/** A stored scope as the screen's groups; the defaults when there is no row. */
function groupsOf(row: StoredAssistantSettings | null): AssistantGroups {
  if (!row) return DEFAULT_GROUPS;
  return {
    autonomy: normalizeAutonomy(row.autonomy),
    tone: row.tone,
    quietHours: {
      enabled: row.quietEnabled,
      start: clockOf(row.quietStart),
      end: clockOf(row.quietEnd),
    },
    contacts:
      row.contactsMode === "selected"
        ? { mode: "selected", memberIds: [...row.contactMembershipIds].sort() }
        : { mode: "all" },
  };
}

const GROUP_KEYS: Record<SettingsGroup, keyof AssistantGroups> = {
  autonomy: "autonomy",
  tone: "tone",
  quiet_hours: "quietHours",
  contacts: "contacts",
};

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The assistant's settings and tests (feature 007 contracts/http-api.md, research R8 to R12): a
 * workspace's defaults, a property's own values per group, custom instructions as immutable
 * versions, escalation contacts, and "test the assistant". Everything runs in the request's RLS
 * context; owners and admins write (the routes' capabilities and the RLS policies), every change is
 * in the security log without the instruction text.
 */
@Injectable()
export class AssistantService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    private readonly jobs: JobQueueService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  private async members(workspaceId: string): Promise<AssistantMember[]> {
    const rows = await this.tx
      .select({ id: membership.id, name: user.name, email: user.email, role: membership.role })
      .from(membership)
      .innerJoin(user, eq(user.id, membership.userId))
      .where(eq(membership.workspaceId, workspaceId))
      .orderBy(user.name, user.email);
    // Members who never set a name are shown by their email, as on the team screen.
    return rows.map((row) => ({ id: row.id, name: row.name || row.email, role: row.role }));
  }

  private async instructionsOf(
    row: StoredAssistantSettings | null,
  ): Promise<AssistantInstructions | null> {
    if (!row?.instruction || !row.instructionCreatedAt) return null;
    const [author] = row.instructionCreatedBy
      ? await this.tx
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, row.instructionCreatedBy))
          .limit(1)
      : [];
    return {
      text: row.instruction.text,
      updatedAt: row.instructionCreatedAt.toISOString(),
      updatedBy: author?.name ?? null,
    };
  }

  private async propertyOf(workspaceId: string, propertyId: string) {
    const [row] = await this.tx
      .select({
        id: property.id,
        timeZone: property.timeZone,
        guideStatus: guide.status,
        publishedVersionId: guide.publishedVersionId,
      })
      .from(property)
      .leftJoin(guide, eq(guide.propertyId, property.id))
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "property", propertyId);
    }
    return row;
  }

  async getWorkspace(caller: AssistantCaller, workspaceId: string): Promise<WorkspaceAssistant> {
    const rows = await loadAssistantSettingsRows(this.tx, workspaceId, null);
    return {
      version: rows.workspace?.version ?? 0,
      ...groupsOf(rows.workspace),
      instructions: await this.instructionsOf(rows.workspace),
      members: await this.members(workspaceId),
      canEdit: can(caller.role, "workspace.settings"),
    };
  }

  async getProperty(
    caller: AssistantCaller,
    workspaceId: string,
    propertyId: string,
  ): Promise<PropertyAssistant> {
    const prop = await this.propertyOf(workspaceId, propertyId);
    const rows = await loadAssistantSettingsRows(this.tx, workspaceId, propertyId);
    const workspaceGroups = groupsOf(rows.workspace);
    const own = new Set(rows.property?.ownGroups ?? []);
    const effective = resolveAssistantSettings(rows.workspace, rows.property);
    const pick = <K extends keyof AssistantGroups>(group: SettingsGroup, key: K) =>
      effective.sources[group] === "property" ? groupsOf(rows.property)[key] : workspaceGroups[key];
    return {
      version: rows.property?.version ?? 0,
      follows: {
        autonomy: !own.has("autonomy"),
        tone: !own.has("tone"),
        quietHours: !own.has("quiet_hours"),
        contacts: !own.has("contacts"),
      },
      own: rows.property ? groupsOf(rows.property) : workspaceGroups,
      instructions: await this.instructionsOf(rows.property),
      workspace: { ...workspaceGroups, instructions: await this.instructionsOf(rows.workspace) },
      effective: {
        autonomy: effective.autonomy,
        tone: effective.tone,
        quietHours: pick("quiet_hours", "quietHours"),
        contacts: pick("contacts", "contacts"),
      },
      timeZone: prop.timeZone,
      hasPublishedGuide: prop.guideStatus === "published" && prop.publishedVersionId !== null,
      members: await this.members(workspaceId),
      canEdit: can(caller.role, "properties.manage"),
    };
  }

  async setWorkspace(
    caller: AssistantCaller,
    workspaceId: string,
    input: WorkspaceAssistantInput,
  ): Promise<WorkspaceAssistant> {
    const rows = await loadAssistantSettingsRows(this.tx, workspaceId, null);
    if ((rows.workspace?.version ?? 0) !== input.version) {
      throw new ApiProblem(409, "settings_changed");
    }
    await this.save(caller, workspaceId, null, rows.workspace, {
      groups: input,
      ownGroups: [],
      instructions: input.instructions,
    });
    return this.getWorkspace(caller, workspaceId);
  }

  async setProperty(
    caller: AssistantCaller,
    workspaceId: string,
    propertyId: string,
    input: PropertyAssistantInput,
  ): Promise<PropertyAssistant> {
    const prop = await this.propertyOf(workspaceId, propertyId);
    const rows = await loadAssistantSettingsRows(this.tx, workspaceId, propertyId);
    if ((rows.property?.version ?? 0) !== input.version) {
      throw new ApiProblem(409, "settings_changed");
    }
    const ownGroups: SettingsGroup[] = [];
    if (!input.follows.autonomy) ownGroups.push("autonomy");
    if (!input.follows.tone) ownGroups.push("tone");
    if (!input.follows.quietHours) ownGroups.push("quiet_hours");
    if (!input.follows.contacts) ownGroups.push("contacts");
    const quietApplies = input.follows.quietHours
      ? (rows.workspace?.quietEnabled ?? false)
      : input.own.quietHours.enabled;
    if (quietApplies && !prop.timeZone) throw new ApiProblem(409, "time_zone_required");
    await this.save(caller, workspaceId, propertyId, rows.property, {
      groups: input.own,
      ownGroups,
      instructions: input.instructions,
    });
    return this.getProperty(caller, workspaceId, propertyId);
  }

  /** Writes one scope (research R8, R10, R11): row, contacts, instruction version, security log. */
  private async save(
    caller: AssistantCaller,
    workspaceId: string,
    propertyId: string | null,
    current: StoredAssistantSettings | null,
    next: { groups: AssistantGroups; ownGroups: SettingsGroup[]; instructions: string },
  ): Promise<void> {
    const text = next.instructions.trim();
    if (text) {
      const issues = instructionIssues(text);
      if (issues.length > 0) {
        throw new ApiProblem(422, "instructions_invalid", undefined, { details: { issues } });
      }
    }
    const contacts = next.groups.contacts.mode === "selected" ? next.groups.contacts.memberIds : [];
    if (contacts.length > 0) {
      const found = await this.tx
        .select({ id: membership.id })
        .from(membership)
        .where(and(eq(membership.workspaceId, workspaceId), inArray(membership.id, contacts)));
      const known = new Set(found.map((row) => row.id));
      const missing = contacts.find((id) => !known.has(id));
      if (missing) {
        throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "membership", missing);
      }
    }

    const before = groupsOf(current);
    const changed: Record<string, true> = {};
    for (const group of Object.keys(GROUP_KEYS) as SettingsGroup[]) {
      const key = GROUP_KEYS[group];
      if (!same(before[key], next.groups[key])) changed[key] = true;
    }
    const currentText = current?.instruction?.text ?? "";
    if (currentText !== text) changed.instructions = true;
    const ownBefore = [...(current?.ownGroups ?? [])].sort();
    if (propertyId && !same(ownBefore, [...next.ownGroups].sort())) changed.follows = true;

    let instructionVersionId = current?.instruction?.versionId ?? null;
    if (changed.instructions) {
      instructionVersionId = null;
      if (text) {
        const [version] = await this.tx
          .insert(assistantInstructionVersion)
          .values({ workspaceId, propertyId, text, createdBy: caller.userId })
          .returning({ id: assistantInstructionVersion.id });
        instructionVersionId = version!.id;
      }
    }

    const quiet = next.groups.quietHours;
    const values = {
      autonomy: next.groups.autonomy,
      tone: next.groups.tone,
      quietEnabled: quiet.enabled,
      quietStart: quiet.start,
      quietEnd: quiet.end,
      contactsMode: next.groups.contacts.mode,
      ownGroups: next.ownGroups,
      instructionVersionId,
      updatedBy: caller.userId,
      updatedAt: sql`now()`,
    };
    let settingsId: string;
    if (current) {
      const updated = await this.tx
        .update(assistantSettings)
        .set({ ...values, version: sql`${assistantSettings.version} + 1` })
        .where(
          and(eq(assistantSettings.id, current.id), eq(assistantSettings.version, current.version)),
        )
        .returning({ id: assistantSettings.id });
      if (updated.length === 0) throw new ApiProblem(409, "settings_changed");
      settingsId = current.id;
    } else {
      const [inserted] = await this.tx
        .insert(assistantSettings)
        .values({ workspaceId, propertyId, ...values })
        .onConflictDoNothing()
        .returning({ id: assistantSettings.id });
      if (!inserted) throw new ApiProblem(409, "settings_changed");
      settingsId = inserted.id;
    }

    if (changed.contacts || !current) {
      await this.tx.delete(assistantContact).where(eq(assistantContact.settingsId, settingsId));
      if (contacts.length > 0) {
        await this.tx
          .insert(assistantContact)
          .values(contacts.map((membershipId) => ({ settingsId, membershipId, workspaceId })));
      }
    }

    if (Object.keys(changed).length > 0) {
      await this.securityLog.record({
        type: "assistant.settings_changed",
        outcome: "success",
        actorUserId: caller.userId,
        workspaceId,
        targetType: propertyId ? "property" : "workspace",
        targetId: propertyId ?? workspaceId,
        metadata: {
          scope: propertyId ? "property" : "workspace",
          ...(propertyId ? { propertyId } : {}),
          ...changed,
        },
      });
    }
  }

  /** Feature 007 research R12: stores the question and enqueues the dry run. */
  async createTest(
    caller: AssistantCaller,
    workspaceId: string,
    propertyId: string,
    body: AssistantTestBody,
  ): Promise<{ id: string }> {
    const prop = await this.propertyOf(workspaceId, propertyId);
    if (prop.guideStatus !== "published" || !prop.publishedVersionId) {
      throw new ApiProblem(409, "guide_not_published");
    }
    const limit = await this.rateLimit.consume(
      `assistant-test:user:${caller.userId}`,
      TESTS_PER_HOUR,
      3600,
    );
    if (!limit.allowed) {
      throw new ApiProblem(429, "tests_paused", undefined, {
        retryAfterSeconds: limit.retryAfterSeconds,
        details: { retryAfterSeconds: limit.retryAfterSeconds },
      });
    }
    const [row] = await this.tx
      .insert(assistantTest)
      .values({
        workspaceId,
        propertyId,
        createdBy: caller.userId,
        question: body.question,
        language: body.language,
      })
      .returning({ id: assistantTest.id });
    const job: AssistantTestJob = { testId: row!.id, workspaceId };
    await this.jobs.send(JOB_QUEUES.assistantTest, job, {
      singletonKey: row!.id,
      retryLimit: 1,
      expireInSeconds: 60,
    });
    return { id: row!.id };
  }

  async getTest(workspaceId: string, propertyId: string, testId: string): Promise<AssistantTest> {
    const [row] = await this.tx
      .select()
      .from(assistantTest)
      .where(
        and(
          eq(assistantTest.id, testId),
          eq(assistantTest.workspaceId, workspaceId),
          eq(assistantTest.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row) {
      throw await this.crossTenant.notFoundInRequest(
        this.tx,
        workspaceId,
        "assistant_test",
        testId,
      );
    }
    let sections: AssistantTest["sections"] = [];
    if (row.sectionIds.length > 0) {
      const [published] = await this.tx
        .select({ snapshot: guideVersion.snapshot })
        .from(guide)
        .innerJoin(guideVersion, eq(guideVersion.id, guide.publishedVersionId))
        .where(and(eq(guide.propertyId, propertyId), eq(guide.workspaceId, workspaceId)))
        .limit(1);
      const names = SECTION_TITLES[row.language];
      const snapshot = published?.snapshot as GuideSnapshot | undefined;
      sections = row.sectionIds.flatMap((id) => {
        const section = snapshot?.sections.find((candidate) => candidate.id === id);
        if (!section) return [];
        const custom =
          section.kind === "custom"
            ? (section.title?.[row.language] ?? Object.values(section.title ?? {})[0] ?? null)
            : null;
        return [{ id, title: custom ?? names[section.kind] ?? names.custom ?? section.kind }];
      });
    }
    return {
      id: row.id,
      status: row.status,
      question: row.question,
      outcome: row.outcome,
      reason: row.reason as NeedsHostReasonValue | null,
      topic: row.topic,
      answerKind: row.answerKind,
      reply: row.reply,
      sections,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
