import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  CreateLockedFieldBody,
  GuideDocument,
  MoveToLockedFieldBody,
  SectionWriteResult,
  LockedFieldView,
  RevealedValue,
  RevealHistory,
  UpdateLockedFieldBody,
} from "@guidesk/contracts";
import {
  guideVersion,
  property,
  restrictedValue,
  restrictedValuePublic,
  securityEvent,
  user,
  type DbHandle,
} from "@guidesk/db";
import {
  defaultLockedFieldSection,
  docBlockTexts,
  redactRestrictedValues,
  replaceWithLockedField,
  type SegDocument,
  REVEAL_LIMIT_PER_HOUR,
  REVEAL_WINDOW_SECONDS,
  revealLimitKey,
  snapshotLockedFieldIds,
  type DefaultSectionKind,
  type GuideSnapshot,
} from "@guidesk/domain";
import { renderRevealLimit } from "@guidesk/emails";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { GuideViewService, type Caller } from "../guides/guide-view.service.js";
import { GuidesService } from "../guides/guides.service.js";
import { VAULT } from "../integrations/integrations.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { MemberNotices } from "../tenancy/member-notices.js";
import { RevealService } from "./reveal.service.js";

/** A revealed value shows for 60 seconds at most (FR-016). */
const HIDE_AFTER_SECONDS = 60;

const KIND_LABELS: Record<string, { es: string; en: string }> = {
  door_code: { es: "Código de puerta", en: "Door code" },
  gate_code: { es: "Código de portón", en: "Gate code" },
  lockbox_code: { es: "Código de caja de llaves", en: "Lockbox code" },
  alarm_code: { es: "Código de alarma", en: "Alarm code" },
  wifi_password: { es: "Contraseña de Wi-Fi", en: "Wi-Fi password" },
  other: { es: "Código", en: "Code" },
};

/**
 * Locked fields (feature 003 US2, FR-015 to FR-024, research R4): codes and the Wi-Fi password,
 * encrypted with the workspace's data key, shown only as "set", revealed for 60 seconds after
 * step-up, at most 20 times per member per hour, and logged. No response carries a value except
 * the reveal.
 */
@Injectable()
export class LockedFieldsService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly views: GuideViewService,
    private readonly guides: GuidesService,
    private readonly reveals: RevealService,
    private readonly rateLimit: RateLimitService,
    private readonly securityLog: SecurityLogService,
    private readonly notices: MemberNotices,
    private readonly crossTenant: CrossTenantService,
    @Inject(VAULT) private readonly vault: Vault,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  private get tx() {
    return this.requestDb.current();
  }

  async list(caller: Caller, workspaceId: string, propertyId: string): Promise<LockedFieldView[]> {
    const ctx = await this.views.load(workspaceId, propertyId);
    return (await this.views.view(ctx, caller)).lockedFields;
  }

  private async field(workspaceId: string, propertyId: string, fieldId: string) {
    const [row] = await this.tx
      .select()
      .from(restrictedValuePublic)
      .where(
        and(
          eq(restrictedValuePublic.id, fieldId),
          eq(restrictedValuePublic.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "locked_field", fieldId);
    return row;
  }

  private async mainLanguage(propertyId: string): Promise<"es" | "en"> {
    const [row] = await this.tx
      .select({ languages: property.guideLanguages })
      .from(property)
      .where(eq(property.id, propertyId))
      .limit(1);
    return row?.languages[0] ?? "es";
  }

  private async encrypt(workspaceId: string, rowId: string, value: string) {
    return this.vault.encrypt(
      createDataKeyStore(this.tx),
      { workspaceId, table: "restricted_value", column: "value_ciphertext", rowId },
      value,
    );
  }

  private async log(
    type:
      | "restricted_value.added"
      | "restricted_value.changed"
      | "restricted_value.deleted"
      | "restricted_value.revealed"
      | "restricted_value.made_public"
      | "restricted_value.made_locked",
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    field: { id: string; kind: string },
  ): Promise<void> {
    await this.securityLog.record({
      type,
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "locked_field",
      targetId: field.id,
      metadata: { propertyId, fieldId: field.id, kind: field.kind },
    });
  }

  private async viewOf(caller: Caller, workspaceId: string, propertyId: string, fieldId: string) {
    const fields = await this.list(caller, workspaceId, propertyId);
    return fields.find((field) => field.id === fieldId)!;
  }

  /** Adds a locked field (FR-015); the value, when given, is encrypted at once. */
  async create(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: CreateLockedFieldBody,
  ): Promise<LockedFieldView> {
    await this.views.load(workspaceId, propertyId);
    const id = randomUUID();
    const label = body.label ?? KIND_LABELS[body.kind]![await this.mainLanguage(propertyId)];
    const encrypted = body.value ? await this.encrypt(workspaceId, id, body.value) : null;
    await this.tx.insert(restrictedValue).values({
      id,
      workspaceId,
      propertyId,
      kind: body.kind,
      label,
      valueCiphertext: encrypted?.ciphertext ?? null,
      dataKeyId: encrypted?.dataKeyId ?? null,
      source: "host",
      sectionKind: (body.sectionKind ?? defaultLockedFieldSection(body.kind)) as DefaultSectionKind,
      valueSetAt: encrypted ? new Date() : null,
      updatedBy: caller.userId,
    });
    await this.log("restricted_value.added", caller, workspaceId, propertyId, {
      id,
      kind: body.kind,
    });
    return this.viewOf(caller, workspaceId, propertyId, id);
  }

  /** Changes a label or a value (FR-016); a new value takes effect for guests at once (FR-020). */
  async update(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    fieldId: string,
    body: UpdateLockedFieldBody,
  ): Promise<LockedFieldView> {
    const field = await this.field(workspaceId, propertyId, fieldId);
    const changes: Partial<typeof restrictedValue.$inferInsert> = {
      updatedBy: caller.userId,
      updatedAt: new Date(),
    };
    if (body.label) changes.label = body.label;
    if (body.value !== undefined) {
      if (field.isPublic) {
        changes.publicValue = body.value;
      } else {
        const encrypted = await this.encrypt(workspaceId, fieldId, body.value);
        changes.valueCiphertext = encrypted.ciphertext;
        changes.dataKeyId = encrypted.dataKeyId;
      }
      changes.valueSetAt = new Date();
    }
    await this.tx
      .update(restrictedValue)
      .set(changes)
      .where(and(eq(restrictedValue.id, fieldId), eq(restrictedValue.propertyId, propertyId)));
    await this.log("restricted_value.changed", caller, workspaceId, propertyId, field);
    return this.viewOf(caller, workspaceId, propertyId, fieldId);
  }

  /** Deletes a field; a published version that uses it needs `confirm` (FR-024). */
  async remove(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    fieldId: string,
    confirm: boolean,
  ): Promise<void> {
    const field = await this.field(workspaceId, propertyId, fieldId);
    const ctx = await this.views.load(workspaceId, propertyId);
    if (!confirm && ctx.guide.publishedVersionId) {
      const [version] = await this.tx
        .select({ number: guideVersion.number, snapshot: guideVersion.snapshot })
        .from(guideVersion)
        .where(eq(guideVersion.id, ctx.guide.publishedVersionId))
        .limit(1);
      if (version && snapshotLockedFieldIds(version.snapshot as GuideSnapshot).includes(fieldId)) {
        throw new ApiProblem(409, "locked_field_referenced", undefined, {
          details: { version: version.number },
        });
      }
    }
    await this.tx
      .delete(restrictedValue)
      .where(and(eq(restrictedValue.id, fieldId), eq(restrictedValue.propertyId, propertyId)));
    await this.log("restricted_value.deleted", caller, workspaceId, propertyId, field);
  }

  /**
   * Reveals a value for 60 seconds (FR-016 to FR-018): the per-member limit first, then the
   * security log, then the value. Over the limit, the owners are alerted once per member and hour.
   */
  async reveal(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    fieldId: string,
  ): Promise<RevealedValue> {
    const field = await this.field(workspaceId, propertyId, fieldId);
    const limit = await this.rateLimit.consume(
      revealLimitKey(workspaceId, caller.userId),
      REVEAL_LIMIT_PER_HOUR,
      REVEAL_WINDOW_SECONDS,
    );
    if (!limit.allowed) {
      await this.securityLog.record({
        type: "restricted_value.reveal_limited",
        outcome: "denied",
        actorUserId: caller.userId,
        workspaceId,
        targetType: "locked_field",
        targetId: field.id,
        metadata: { propertyId, fieldId: field.id, kind: field.kind, reveals: limit.count - 1 },
      });
      await this.alertOwners(caller, workspaceId);
      const resetsAt = new Date(Date.now() + limit.retryAfterSeconds * 1000);
      throw new ApiProblem(429, "reveal_limit_reached", undefined, {
        details: { resetsAt: resetsAt.toISOString() },
        retryAfterSeconds: limit.retryAfterSeconds,
      });
    }
    const value = await this.reveals.valueOf(workspaceId, propertyId, fieldId);
    if (value === null)
      throw new ApiProblem(404, "not_found", "This locked field has no value yet.");
    await this.log("restricted_value.revealed", caller, workspaceId, propertyId, field);
    return { value, hideAfterSeconds: HIDE_AFTER_SECONDS };
  }

  /** Once per member and hour: the owners learn about unusual reveals (contracts/emails.md). */
  private async alertOwners(caller: Caller, workspaceId: string): Promise<void> {
    const alert = await this.rateLimit.consume(
      `reveal-alert:${workspaceId}:${caller.userId}`,
      1,
      REVEAL_WINDOW_SECONDS,
    );
    if (!alert.allowed) return;
    const [member] = await this.handle.db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, caller.userId))
      .limit(1);
    const events = await this.handle.db
      .select({ propertyId: sql<string>`${securityEvent.metadata}->>'propertyId'` })
      .from(securityEvent)
      .where(
        and(
          eq(securityEvent.workspaceId, workspaceId),
          eq(securityEvent.actorUserId, caller.userId),
          eq(securityEvent.type, "restricted_value.revealed"),
          sql`${securityEvent.occurredAt} > now() - interval '1 hour'`,
        ),
      );
    const propertyIds = [...new Set(events.map((event) => event.propertyId).filter(Boolean))];
    const names = propertyIds.length
      ? (
          await this.handle.db
            .select({ name: property.name })
            .from(property)
            .where(and(eq(property.workspaceId, workspaceId), inArray(property.id, propertyIds)))
        ).map((row) => row.name)
      : [];
    const portal = this.config.PORTAL_URL.replace(/\/$/, "");
    await this.notices.toOwners(workspaceId, "guides.reveal_limit", (locale) =>
      renderRevealLimit(locale, {
        memberName: member?.name ?? "—",
        memberEmail: member?.email ?? "—",
        reveals: REVEAL_LIMIT_PER_HOUR,
        propertyNames: names,
        at: new Date(),
        securityLogLink: `${portal}/${locale}/settings/security-log`,
        sessionsLink: `${portal}/${locale}/settings/members`,
      }),
    );
  }

  /** Makes the Wi-Fi password public or locked again (FR-021). */
  async setVisibility(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    fieldId: string,
    makePublic: boolean,
  ): Promise<LockedFieldView> {
    const field = await this.field(workspaceId, propertyId, fieldId);
    if (field.kind !== "wifi_password") throw new ApiProblem(422, "wifi_only");
    if (field.isPublic === makePublic) return this.viewOf(caller, workspaceId, propertyId, fieldId);
    const value = await this.reveals.valueOf(workspaceId, propertyId, fieldId);
    const where = and(eq(restrictedValue.id, fieldId), eq(restrictedValue.propertyId, propertyId));
    if (makePublic) {
      await this.tx
        .update(restrictedValue)
        .set({
          publicValue: value,
          valueCiphertext: null,
          dataKeyId: null,
          updatedBy: caller.userId,
        })
        .where(where);
    } else {
      const encrypted = value ? await this.encrypt(workspaceId, fieldId, value) : null;
      await this.tx
        .update(restrictedValue)
        .set({
          publicValue: null,
          valueCiphertext: encrypted?.ciphertext ?? null,
          dataKeyId: encrypted?.dataKeyId ?? null,
          updatedBy: caller.userId,
        })
        .where(where);
    }
    await this.log(
      makePublic ? "restricted_value.made_public" : "restricted_value.made_locked",
      caller,
      workspaceId,
      propertyId,
      field,
    );
    return this.viewOf(caller, workspaceId, propertyId, fieldId);
  }

  /**
   * "Move to a locked field" (FR-023): takes the code the warning found in a text block, stores it
   * as a new locked field, and puts a reference in its place, in the same request. The value never
   * travels back in the response.
   */
  async moveFromItem(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    itemId: string,
    body: MoveToLockedFieldBody,
  ): Promise<SectionWriteResult> {
    const ctx = await this.views.load(workspaceId, propertyId);
    const item = ctx.items.find((candidate) => candidate.id === itemId);
    if (!item)
      throw await this.crossTenant.notFoundInRequest(this.tx, workspaceId, "guide_item", itemId);
    const text = ctx.texts.find(
      (candidate) => candidate.itemId === itemId && candidate.language === body.language,
    );
    const doc = text?.doc as SegDocument | null | undefined;
    const block = docBlockTexts(doc)[body.blockIndex];
    const match = block ? redactRestrictedValues(block).matches[0] : undefined;
    if (!doc || !match) {
      throw new ApiProblem(422, "validation_failed", "No code was found in that part of the text.");
    }
    const field = await this.create(caller, workspaceId, propertyId, {
      kind: body.kind,
      ...(body.label ? { label: body.label } : {}),
      value: match.value,
      sectionKind: (item.sectionId &&
      ctx.sections.find((section) => section.id === item.sectionId)?.kind !== "custom"
        ? ctx.sections.find((section) => section.id === item.sectionId)?.kind
        : undefined) as DefaultSectionKind | undefined,
    });
    const replaced = replaceWithLockedField(doc, body.blockIndex, match.value, field.id);
    if (!replaced)
      throw new ApiProblem(422, "validation_failed", "No code was found in that part of the text.");
    return this.guides.updateItem(caller, workspaceId, propertyId, itemId, {
      revision: body.revision,
      language: body.language,
      doc: replaced as GuideDocument,
    });
  }

  /**
   * Who revealed which field of the property, and when (FR-017), including guests with a stay
   * link and stay messages copied with codes (feature 004 FR-032, FR-040).
   */
  async history(workspaceId: string, propertyId: string): Promise<RevealHistory> {
    await this.views.load(workspaceId, propertyId);
    const rows = await this.handle.db
      .select({
        type: securityEvent.type,
        fieldId: securityEvent.targetId,
        kind: sql<string>`${securityEvent.metadata}->>'kind'`,
        at: securityEvent.occurredAt,
        name: user.name,
      })
      .from(securityEvent)
      .leftJoin(user, eq(user.id, securityEvent.actorUserId))
      .where(
        and(
          eq(securityEvent.workspaceId, workspaceId),
          inArray(securityEvent.type, [
            "restricted_value.revealed",
            "restricted_value.guest_revealed",
            "restricted_value.exported",
          ]),
          sql`${securityEvent.metadata}->>'propertyId' = ${propertyId}`,
        ),
      )
      .orderBy(desc(securityEvent.occurredAt))
      .limit(200);
    const labels = new Map(
      (
        await this.tx
          .select({ id: restrictedValuePublic.id, label: restrictedValuePublic.label })
          .from(restrictedValuePublic)
          .where(eq(restrictedValuePublic.propertyId, propertyId))
      ).map((row) => [row.id, row.label]),
    );
    return {
      items: rows.map((row) => ({
        fieldId: row.type === "restricted_value.exported" ? "" : (row.fieldId ?? ""),
        kind: row.kind ?? "",
        label: labels.get(row.fieldId ?? "") ?? "—",
        revealedBy: row.name,
        at: row.at.toISOString(),
        source:
          row.type === "restricted_value.guest_revealed"
            ? ("guest" as const)
            : row.type === "restricted_value.exported"
              ? ("export" as const)
              : ("member" as const),
      })),
    };
  }
}
