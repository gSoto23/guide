import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { DbHandle } from "@guidesk/db";
import {
  codeFromBytes,
  encodeStayToken,
  normalizeConfirmationCode,
  STAY_TOKEN_BYTES,
} from "@guidesk/domain";
import type { KeyManagementPort } from "@guidesk/integrations";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { DB_HANDLE } from "../database/database.module.js";
import { KEY_MANAGEMENT, VAULT } from "../integrations/integrations.module.js";

/**
 * Stay tokens and confirmation codes (feature 004 research R4, SEC-01 to SEC-03): generated here,
 * stored as vault ciphertext bound to the stay link row (the token also as a SHA-256 hash for
 * lookup), and decrypted only here, for the host's copy and the guest's code check. It never
 * touches locked-field values, never logs, and never returns a value to a guest.
 */
export interface StaySecrets {
  token: string;
  tokenHash: string;
  tokenCiphertext: Buffer;
  confirmationCode: string | null;
  confirmationCiphertext: Buffer | null;
  dataKeyId: string;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

@Injectable()
export class StayLinkSecrets {
  private readonly decrypter: VaultDecrypter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(VAULT) private readonly vault: Vault,
    @Inject(KEY_MANAGEMENT) kms: KeyManagementPort,
  ) {
    this.decrypter = new VaultDecrypter(kms);
  }

  private aad(workspaceId: string, rowId: string, column: string) {
    return { workspaceId, table: "stay_link", column, rowId };
  }

  /** A new token, and a confirmation code when the property requires one. */
  async create(
    workspaceId: string,
    rowId: string,
    withCode: boolean,
    token: string = encodeStayToken(randomBytes(STAY_TOKEN_BYTES)),
    code: string | null = withCode ? codeFromBytes(randomBytes(32)) : null,
  ): Promise<StaySecrets> {
    const store = createDataKeyStore(this.handle.db);
    const encryptedToken = await this.vault.encrypt(
      store,
      this.aad(workspaceId, rowId, "token_ciphertext"),
      token,
    );
    const encryptedCode = code
      ? await this.vault.encrypt(
          store,
          this.aad(workspaceId, rowId, "confirmation_ciphertext"),
          code,
        )
      : null;
    return {
      token,
      tokenHash: hashToken(token),
      tokenCiphertext: encryptedToken.ciphertext,
      confirmationCode: code,
      confirmationCiphertext: encryptedCode?.ciphertext ?? null,
      dataKeyId: encryptedToken.dataKeyId,
    };
  }

  async token(workspaceId: string, rowId: string, dataKeyId: string, ciphertext: Buffer) {
    return this.decrypter.decryptText(
      createDataKeyStore(this.handle.db),
      { ...this.aad(workspaceId, rowId, "token_ciphertext"), dataKeyId },
      ciphertext,
    );
  }

  async code(workspaceId: string, rowId: string, dataKeyId: string, ciphertext: Buffer) {
    return this.decrypter.decryptText(
      createDataKeyStore(this.handle.db),
      { ...this.aad(workspaceId, rowId, "confirmation_ciphertext"), dataKeyId },
      ciphertext,
    );
  }

  /** Constant-time comparison of normalized codes (FR-034). */
  matches(expected: string, given: string): boolean {
    const left = Buffer.from(normalizeConfirmationCode(expected));
    const right = Buffer.from(normalizeConfirmationCode(given));
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
