import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { stepUpChallenge, user, type DbHandle } from "@guidesk/db";
import { renderSignInCode, toEmailLocale } from "@guidesk/emails";
import type { AuthSession, EmailAdapter } from "@guidesk/integrations";
import { ApiProblem } from "../common/problem.js";
import { RateLimitService } from "../common/rate-limit.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { EMAIL_ADAPTER } from "../email/email.module.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { AssuranceService } from "./assurance.service.js";
import { LockoutNoticeService } from "./lockout-notice.service.js";
import { LockoutService, MAX_FAILURES, userKey } from "./lockout.service.js";

const CODE_TTL_MS = 10 * 60 * 1000;

/** Step-up by email code, inside the current session (FR-011, research R5, T056). */
@Injectable()
export class StepUpService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    private readonly lockout: LockoutService,
    private readonly lockoutNotice: LockoutNoticeService,
    private readonly assurance: AssuranceService,
    private readonly securityLog: SecurityLogService,
    private readonly rateLimit: RateLimitService,
  ) {}

  private hash(code: string): string {
    return createHmac("sha256", this.config.BETTER_AUTH_SECRET).update(code).digest("hex");
  }

  async challenge(auth: AuthSession): Promise<{ method: "email_otp"; expiresAt: string }> {
    if (await this.lockout.isLocked(userKey(auth.user.id))) {
      throw new ApiProblem(429, "rate_limited", "Too many attempts. Try again later.");
    }
    const limit = await this.rateLimit.consume(`step-up-send:${auth.user.id}`, 5, 3600);
    if (!limit.allowed) {
      throw new ApiProblem(429, "rate_limited", "Too many codes requested. Try again later.");
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + CODE_TTL_MS);
    await this.handle.db.transaction(async (tx) => {
      // Only the newest code of a session works.
      await tx
        .update(stepUpChallenge)
        .set({ consumedAt: new Date() })
        .where(
          and(eq(stepUpChallenge.sessionId, auth.session.id), isNull(stepUpChallenge.consumedAt)),
        );
      await tx.insert(stepUpChallenge).values({
        userId: auth.user.id,
        sessionId: auth.session.id,
        codeHash: this.hash(code),
        expiresAt,
      });
    });
    const [owner] = await this.handle.db
      .select({ language: user.preferredLanguage })
      .from(user)
      .where(eq(user.id, auth.user.id))
      .limit(1);
    const rendered = await renderSignInCode(toEmailLocale(owner?.language), code);
    await this.email.send({ to: auth.user.email, ...rendered, template: "auth.signin_code" });
    return { method: "email_otp", expiresAt: expiresAt.toISOString() };
  }

  async verify(auth: AuthSession, code: string): Promise<{ strongAuthAt: string }> {
    const key = userKey(auth.user.id);
    if (await this.lockout.isLocked(key)) {
      throw new ApiProblem(429, "rate_limited", "Too many attempts. Try again later.");
    }
    const [challenge] = await this.handle.db
      .select()
      .from(stepUpChallenge)
      .where(
        and(
          eq(stepUpChallenge.sessionId, auth.session.id),
          isNull(stepUpChallenge.consumedAt),
          gt(stepUpChallenge.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(stepUpChallenge.createdAt))
      .limit(1);
    // Each code allows at most 5 guesses, counted atomically so parallel requests can't exceed
    // it (security review T103). An exhausted code is consumed.
    const [counted] = challenge
      ? await this.handle.db
          .update(stepUpChallenge)
          .set({ attempts: sql`${stepUpChallenge.attempts} + 1` })
          .where(
            and(
              eq(stepUpChallenge.id, challenge.id),
              isNull(stepUpChallenge.consumedAt),
              lt(stepUpChallenge.attempts, MAX_FAILURES),
            ),
          )
          .returning({ attempts: stepUpChallenge.attempts })
      : [];
    const expected = challenge ? Buffer.from(challenge.codeHash, "hex") : Buffer.alloc(32);
    const provided = Buffer.from(this.hash(code), "hex");
    const matches = Boolean(challenge && counted) && timingSafeEqual(expected, provided);
    // Consuming is atomic too: two requests with the same code can't both succeed.
    const [consumed] =
      challenge && (matches || !counted || counted.attempts >= MAX_FAILURES)
        ? await this.handle.db
            .update(stepUpChallenge)
            .set({ consumedAt: new Date() })
            .where(and(eq(stepUpChallenge.id, challenge.id), isNull(stepUpChallenge.consumedAt)))
            .returning({ id: stepUpChallenge.id })
        : [];

    if (!challenge || !matches || !consumed) {
      const failure = await this.lockout.recordFailure(key);
      await this.securityLog.record({
        type: "step_up.failed",
        outcome: "failure",
        actorUserId: auth.user.id,
        metadata: { method: "email_otp" },
      });
      if (failure.justLocked) {
        await this.lockoutNotice.notify(auth.user.id, key, "step_up");
      }
      throw new ApiProblem(403, "forbidden", "The code is invalid or expired.");
    }

    await this.lockout.reset(key);
    const strongAuthAt = await this.assurance.markStepUp(
      auth.session.id,
      auth.user.id,
      "email_otp",
      false,
    );
    await this.securityLog.record({
      type: "step_up.succeeded",
      outcome: "success",
      actorUserId: auth.user.id,
      metadata: { method: "email_otp" },
    });
    return { strongAuthAt: strongAuthAt.toISOString() };
  }
}
