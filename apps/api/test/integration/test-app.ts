import "reflect-metadata";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import type { EmailAdapter, EmailMessage } from "@guidesk/integrations";
import { AppModule } from "../../src/app.module.js";
import { RequireMfa, RequireStepUp } from "../../src/auth/step-up.guard.js";
import { PROPERTY_COUNT } from "../../src/tenancy/property-count.js";
import { configureApp, createFastifyAdapter, NEST_APP_OPTIONS } from "../../src/bootstrap.js";
import { RequestDb } from "../../src/database/request-db.js";
import { EMAIL_ADAPTER } from "../../src/email/email.module.js";

/** Test-only route that proves the session guard and the RLS transaction work together. */
@Controller("probe")
class ProbeController {
  constructor(private readonly requestDb: RequestDb) {}

  @Get()
  async probe(@Req() request: FastifyRequest) {
    const result = await this.requestDb
      .current()
      .execute(sql`SELECT current_user AS role, app_current_user_id() AS user_id`);
    return { userId: request.auth?.user.id, db: result.rows[0] };
  }
}

/** Test-only sensitive routes for the step-up and MFA guards (T049, T050). */
@Controller("probe")
class SensitiveProbeController {
  @RequireStepUp()
  @Get("sensitive")
  sensitive() {
    return { ok: true };
  }

  @RequireMfa()
  @HttpCode(200)
  @Post("workspaces/:workspaceId/mfa")
  mfa(@Param("workspaceId") workspaceId: string) {
    return { ok: true, workspaceId };
  }
}

export class CapturingEmailAdapter implements EmailAdapter {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return { messageId: `test-${this.sent.length}` };
  }

  lastCodeFor(email: string): string {
    const message = [...this.sent].reverse().find((m) => m.to === email);
    const code = message?.text.match(/\b(\d{6})\b/)?.[1];
    if (!code) throw new Error(`No code sent to ${email}`);
    return code;
  }
}

export const PORTAL_URL = "http://localhost:3000";

export interface TestAppOptions {
  /** A fixed property count for the MFA threshold; omit it to count real active properties. */
  propertyCount?: number;
}

export async function createTestApp(
  databaseUrl: string,
  extraEnv: Record<string, string> = {},
  options: TestAppOptions = {},
) {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: "test-secret-".padEnd(48, "x"),
    PORTAL_URL,
    EMAIL_TRANSPORT: "smtp",
    // Feature 002 (T006): test-only key material, never used outside tests.
    LOCAL_KMS_KEY: Buffer.alloc(32, 11).toString("base64"),
    FEED_URL_PEPPER: "test-pepper-".padEnd(48, "x"),
    LOCAL_STORAGE_DIR: join(tmpdir(), "guidesk-api-test-uploads"),
    ...extraEnv,
  });
  const email = new CapturingEmailAdapter();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: [ProbeController, SensitiveProbeController],
  })
    .overrideProvider(EMAIL_ADAPTER)
    .useValue(email);
  // A fixed count when the test asks for one; otherwise the real count of active properties.
  if (options.propertyCount !== undefined) {
    const count = options.propertyCount;
    builder = builder
      .overrideProvider(PROPERTY_COUNT)
      .useValue({ countProperties: async () => count });
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter({ NODE_ENV: "test" }),
    NEST_APP_OPTIONS,
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, email, fastify: app.getHttpAdapter().getInstance() };
}

/** Extracts a "name=value" cookie pair list from set-cookie headers for the next request. */
export function cookieHeader(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.map((c) => c.split(";")[0]).join("; ");
}

/** Applies cookies a response sets (enabling 2FA rotates the session) over the current ones. */
export function updateCookies(current: string, setCookie: string | string[] | undefined): string {
  const jar = new Map(
    current
      .split("; ")
      .filter(Boolean)
      .map((pair) => [pair.split("=")[0], pair] as const),
  );
  for (const pair of cookieHeader(setCookie).split("; ").filter(Boolean))
    jar.set(pair.split("=")[0], pair);
  return [...jar.values()].join("; ");
}
