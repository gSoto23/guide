import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { passkey, sessionAssurance, user, type DbHandle } from "@guidesk/db";
import { DB_HANDLE } from "../database/database.module.js";

export type AuthMethod = "passkey" | "totp" | "email_otp" | "google";

export interface Assurance {
  strongAuthAt: Date | null;
  mfaSatisfied: boolean;
  /** Method of the latest sign-in or step-up. */
  method: AuthMethod | null;
}

/** Session assurance (research R5, R6): when the session last authenticated, and how strongly. */
@Injectable()
export class AssuranceService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  /** A fresh sign-in is a fresh authentication. A passkey with user verification is MFA. */
  async recordSignIn(sessionId: string, userId: string, method: AuthMethod): Promise<void> {
    await this.insert(sessionId, userId, {
      strongAuthAt: new Date(),
      method,
      mfaSatisfied: method === "passkey",
    });
  }

  /**
   * A session the library created without a sign-in: a rotation keeps the replaced session's
   * assurance; anything else starts with none (security review T103). Rotations happen, for
   * example, when the authenticator app is enabled or disabled.
   */
  async recordWithoutSignIn(
    sessionId: string,
    userId: string,
    rotatedFrom: Assurance | null,
  ): Promise<void> {
    await this.insert(
      sessionId,
      userId,
      rotatedFrom ?? { strongAuthAt: null, method: null, mfaSatisfied: false },
    );
  }

  private async insert(sessionId: string, userId: string, assurance: Assurance): Promise<void> {
    await this.handle.db
      .insert(sessionAssurance)
      .values({ sessionId, userId, ...assurance, updatedAt: new Date() })
      .onConflictDoNothing();
  }

  async markStepUp(
    sessionId: string,
    userId: string,
    method: AuthMethod,
    secondFactor: boolean,
  ): Promise<Date> {
    const now = new Date();
    const existing = await this.get(sessionId);
    await this.handle.db
      .insert(sessionAssurance)
      .values({
        sessionId,
        userId,
        strongAuthAt: now,
        method,
        mfaSatisfied: secondFactor,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessionAssurance.sessionId,
        set: {
          strongAuthAt: now,
          method,
          mfaSatisfied: secondFactor || existing.mfaSatisfied,
          updatedAt: now,
        },
      });
    return now;
  }

  async get(sessionId: string): Promise<Assurance> {
    const [row] = await this.handle.db
      .select({
        strongAuthAt: sessionAssurance.strongAuthAt,
        mfaSatisfied: sessionAssurance.mfaSatisfied,
        method: sessionAssurance.method,
      })
      .from(sessionAssurance)
      .where(eq(sessionAssurance.sessionId, sessionId))
      .limit(1);
    return {
      strongAuthAt: row?.strongAuthAt ?? null,
      mfaSatisfied: row?.mfaSatisfied ?? false,
      method: (row?.method as AuthMethod | null | undefined) ?? null,
    };
  }

  async factors(userId: string): Promise<{ hasPasskey: boolean; totpEnabled: boolean }> {
    const [passkeys] = await this.handle.db
      .select({ n: count() })
      .from(passkey)
      .where(eq(passkey.userId, userId));
    const [row] = await this.handle.db
      .select({ totp: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return { hasPasskey: Number(passkeys?.n ?? 0) > 0, totpEnabled: row?.totp === true };
  }
}
