import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { restrictedValue, type DbHandle } from "@guidesk/db";
import type { KeyManagementPort } from "@guidesk/integrations";
import { createDataKeyStore } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { DB_HANDLE } from "../database/database.module.js";
import { KEY_MANAGEMENT } from "../integrations/integrations.module.js";

/**
 * The reveal service (feature 003 research R4, SEC-06): the only API code that decrypts a
 * restricted value, enforced by the ESLint vault rule. Callers check the role, step-up, MFA, the
 * per-member limit, and log the reveal before they call it. It reads the ciphertext in the system
 * context, because request roles can never select it (migration 0019), and it never logs,
 * caches, or serializes what it returns.
 */
@Injectable()
export class RevealService {
  private readonly decrypter: VaultDecrypter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(KEY_MANAGEMENT) kms: KeyManagementPort,
  ) {
    this.decrypter = new VaultDecrypter(kms);
  }

  /** The field's value: its public Wi-Fi password, its decrypted value, or null when not set. */
  async valueOf(workspaceId: string, propertyId: string, fieldId: string): Promise<string | null> {
    const [row] = await this.handle.db
      .select({
        id: restrictedValue.id,
        ciphertext: restrictedValue.valueCiphertext,
        dataKeyId: restrictedValue.dataKeyId,
        publicValue: restrictedValue.publicValue,
      })
      .from(restrictedValue)
      .where(
        and(
          eq(restrictedValue.id, fieldId),
          eq(restrictedValue.workspaceId, workspaceId),
          eq(restrictedValue.propertyId, propertyId),
        ),
      )
      .limit(1);
    if (!row) return null;
    if (row.publicValue !== null) return row.publicValue;
    if (!row.ciphertext || !row.dataKeyId) return null;
    return this.decrypter.decryptText(
      createDataKeyStore(this.handle.db),
      {
        workspaceId,
        table: "restricted_value",
        column: "value_ciphertext",
        rowId: row.id,
        dataKeyId: row.dataKeyId,
      },
      row.ciphertext,
    );
  }
}
