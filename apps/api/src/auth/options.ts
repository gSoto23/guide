import type { BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { emailOTP, twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { fullSchema, type Database } from "@guidesk/db";
import type { ApiConfig } from "../config/config.js";
import type { Assurance } from "./assurance.service.js";
import {
  ABSOLUTE_SESSION_MS,
  DISABLED_AUTH_PATHS,
  FACTOR_PATHS,
  methodFromPath,
  SECOND_FACTOR_PATHS,
  SIGN_IN_PATHS,
  type AuthEventHandlers,
} from "./auth-events.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";

export interface OtpEmail {
  email: string;
  otp: string;
  type: "sign-in" | "email-verification" | "forget-password" | "change-email";
  /** Accept-Language of the request, used when the user is new (T040). */
  acceptLanguage: string | null;
}

export interface CreatedUser {
  id: string;
  email: string;
  name: string | null;
  preferredLanguage: string | null;
}

export interface AuthDependencies {
  db: Database;
  config: ApiConfig;
  sendOtp: (message: OtpEmail) => Promise<void>;
  events: AuthEventHandlers;
}

interface HookContext {
  headers?: Headers;
  request?: Request;
  path?: string;
  context?: {
    session?: { session: { id: string; userId: string; createdAt: Date | string } } | null;
  };
}

/** Set by the before hook on /sign-in/email-otp, read by the after hook (T103). */
const PENDING_CODE_FLAG = "guideskPendingCode";

function bodyOf(ctx: { body?: unknown }): Record<string, unknown> {
  return ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
}

function hasSessionCookie(headers: Headers | undefined): boolean {
  return headers?.get("cookie")?.includes("guidesk.session_token=") ?? false;
}

function tooManyAttempts(): APIError {
  return new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts. Try again later." });
}

function headersOf(context: unknown): Headers | undefined {
  const ctx = context as HookContext | undefined;
  return ctx?.headers ?? ctx?.request?.headers;
}

const MINUTE = 60;
const DAY = 24 * 60 * MINUTE;

/**
 * Better Auth options (ADR-0008, spec 001 research R1, R7, R8). Passwordless: Google, passkeys,
 * and email one-time codes. Tenancy is not handled here (research R3).
 */
function failed(returned: unknown): boolean {
  return returned instanceof Error || returned instanceof APIError;
}

export function buildAuthOptions({ db, config, sendOtp, events }: AuthDependencies) {
  // Assurance of sessions being rotated, keyed by the endpoint context (T103).
  const rotations = new WeakMap<object, Assurance>();
  const portal = new URL(config.PORTAL_URL);
  const secure = portal.protocol === "https:";
  const google =
    config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: config.GOOGLE_CLIENT_ID, clientSecret: config.GOOGLE_CLIENT_SECRET } }
      : undefined;

  return {
    appName: "Guidesk",
    baseURL: config.PORTAL_URL,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.PORTAL_URL],
    disabledPaths: DISABLED_AUTH_PATHS,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: fullSchema.user,
        session: fullSchema.session,
        account: fullSchema.account,
        verification: fullSchema.verification,
        twoFactor: fullSchema.twoFactor,
        passkey: fullSchema.passkey,
        rateLimit: fullSchema.rateLimit,
      },
    }),
    // Passwords are disabled (spec 001 FR-001).
    emailAndPassword: { enabled: false },
    ...(google ? { socialProviders: google } : {}),
    account: {
      // Google sign-in with an existing email reaches the same account (FR-003) only when Google
      // says the email is verified; Google is deliberately not a "trusted provider" (T103).
      accountLinking: { enabled: true },
    },
    user: {
      additionalFields: {
        preferredLanguage: { type: "string", required: false, defaultValue: "es", input: true },
        isStaff: { type: "boolean", required: false, defaultValue: false, input: false },
        lastWorkspaceId: { type: "string", required: false, input: false },
        deletedAt: { type: "date", required: false, input: false },
        purgeAfter: { type: "date", required: false, input: false },
      },
    },
    session: {
      // 7 days idle (sliding); the 30-day absolute limit is enforced by the session guard (T060).
      expiresIn: 7 * DAY,
      updateAge: DAY,
      // Cookie cache stays off so revocation and removal apply within a minute (FR-025).
      cookieCache: { enabled: false },
      additionalFields: {
        deviceIdHash: { type: "string", required: false, input: false },
        deviceLabel: { type: "string", required: false, input: false },
        approxLocation: { type: "string", required: false, input: false },
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Every account starts from a verified email (FR-003, T103), so an unverified Google
          // address can't create an account and pre-empt its real owner.
          before: async (data) => {
            if ((data as { emailVerified?: unknown }).emailVerified !== true) {
              throw new APIError("FORBIDDEN", {
                message: "Verify your email to continue.",
                code: "EMAIL_NOT_VERIFIED",
              });
            }
          },
          after: async (created, ctx) => {
            const record = created as {
              id: string;
              email: string;
              name?: string | null;
              preferredLanguage?: string | null;
            };
            await events.onUserCreated(
              {
                id: record.id,
                email: record.email,
                name: record.name ?? null,
                preferredLanguage: record.preferredLanguage ?? null,
              },
              headersOf(ctx),
            );
          },
        },
      },
      session: {
        create: {
          // A session created by a sign-in endpoint is a sign-in. Any other new session replaces
          // the current one (for example when the authenticator app is enabled): it keeps the
          // original sign-in time, so the 30-day limit can't be reset, and its assurance (T103).
          before: async (data, ctx) => {
            const endpoint = ctx as HookContext | null | undefined;
            const previous = endpoint?.context?.session?.session;
            const userId = (data as { userId?: string }).userId;
            if (
              !endpoint ||
              methodFromPath(endpoint.path) ||
              !previous ||
              previous.userId !== userId
            ) {
              return;
            }
            rotations.set(endpoint, await events.assuranceOf(previous.id));
            return { data: { createdAt: new Date(previous.createdAt) } };
          },
          after: async (created, ctx) => {
            const record = created as { id: string; userId: string };
            const endpoint = ctx as HookContext | null | undefined;
            await events.onSessionCreated(
              { id: record.id, userId: record.userId },
              methodFromPath(endpoint?.path),
              headersOf(ctx),
              endpoint ? (rotations.get(endpoint) ?? null) : null,
            );
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const body = bodyOf(ctx);
        const email = typeof body.email === "string" ? body.email : null;

        // Sign-in codes (AC-SEC-001, AC-SEC-007, AC-SEC-008): a locked or over-limit email gets
        // the same 429 whether or not the account exists. Only sign-in codes are sent.
        if (ctx.path === "/email-otp/send-verification-otp") {
          if (body.type !== "sign-in") {
            throw new APIError("BAD_REQUEST", { message: "Unsupported code type." });
          }
          if (email && (await events.isEmailLocked(email))) throw tooManyAttempts();
          if (email && !(await events.allowCodeSend(email))) throw tooManyAttempts();
        }
        if (ctx.path === "/sign-in/email-otp" && email) {
          if (await events.isEmailLocked(email)) throw tooManyAttempts();
          const pending = await events.hasPendingSignInCode(email);
          return { context: { [PENDING_CODE_FLAG]: pending ? "yes" : "no" } };
        }

        if (SIGN_IN_PATHS.has(ctx.path) || !hasSessionCookie(ctx.headers)) return;
        const active = await getSessionFromCtx(ctx);
        if (!active) return;

        // 30-day absolute lifetime on the library's endpoints too (FR-015, T103).
        if (Date.now() - new Date(active.session.createdAt).getTime() > ABSOLUTE_SESSION_MS) {
          await ctx.context.internalAdapter.deleteSession(active.session.token);
          ctx.context.session = null;
          // Reading the session simply finds none; every other endpoint refuses.
          if (ctx.path === "/get-session") return;
          throw new APIError("UNAUTHORIZED", {
            message: "Your session expired. Sign in again.",
            code: "SESSION_EXPIRED",
          });
        }

        // Second-factor checks count toward the user lockout, and each code works once
        // (AC-SEC-001, ASVS 5.0 V6.5).
        if (SECOND_FACTOR_PATHS.has(ctx.path)) {
          if (await events.isUserLocked(active.user.id)) throw tooManyAttempts();
          const code = typeof body.code === "string" ? body.code : null;
          if (
            ctx.path === "/two-factor/verify-totp" &&
            code &&
            (await events.isTotpCodeUsed(active.user.id, code))
          ) {
            await events.afterSecondFactorFailed(active.user.id, "totp");
            throw new APIError("UNAUTHORIZED", { message: "Invalid code.", code: "INVALID_CODE" });
          }
        }

        // Adding or removing a factor needs a recent re-authentication, with the second factor
        // when the user has one (FR-010, FR-011, T103).
        if (FACTOR_PATHS.has(ctx.path)) {
          if (ctx.path === "/passkey/verify-registration" && body.createSession === true) {
            throw new APIError("BAD_REQUEST", { message: "Unsupported option." });
          }
          const gate = await events.factorGate({ id: active.session.id, userId: active.user.id });
          if (gate === "step_up_required") {
            throw new APIError("FORBIDDEN", {
              message: "Confirm it's you to continue.",
              code: "STEP_UP_REQUIRED",
            });
          }
          if (gate === "second_factor_required") {
            throw new APIError("FORBIDDEN", {
              message: "Use your passkey or authenticator app to continue.",
              code: "SECOND_FACTOR_REQUIRED",
            });
          }
        }
        return;
      }),
      // Security events, factor notices, and session assurance (T058, T061, T064).
      after: createAuthMiddleware(async (ctx) => {
        const ok = !failed(ctx.context.returned);
        const current = ctx.context.session as
          | {
              session: { id: string; userId: string };
              user: { id: string; twoFactorEnabled?: boolean | null };
            }
          | null
          | undefined;
        // Some endpoints rotate the session (for example enabling 2FA); prefer the new one.
        const rotated = (
          ctx.context as { newSession?: { session: { id: string; userId: string } } | null }
        ).newSession;
        const sessionRef = rotated?.session
          ? { id: rotated.session.id, userId: rotated.session.userId }
          : current
            ? { id: current.session.id, userId: current.user.id }
            : null;
        const headers = ctx.headers;
        switch (ctx.path) {
          case "/sign-in/email-otp": {
            const email = bodyOf(ctx).email;
            const counted = (ctx as Record<string, unknown>)[PENDING_CODE_FLAG] === "yes";
            if (typeof email === "string") await events.afterEmailOtpSignIn(email, ok, counted);
            break;
          }
          case "/two-factor/verify-totp": {
            const code = bodyOf(ctx).code;
            if (current && sessionRef && ok && typeof code === "string") {
              await events.afterTotpVerified(
                sessionRef,
                current.user.twoFactorEnabled !== true,
                code,
                headers,
              );
            } else if (current && !ok) {
              await events.afterSecondFactorFailed(current.user.id, "totp");
            }
            break;
          }
          case "/two-factor/verify-backup-code":
            if (sessionRef && ok) {
              await events.afterBackupCodeUsed(sessionRef);
            } else if (current && !ok) {
              await events.afterSecondFactorFailed(current.user.id, "recovery_code");
            }
            break;
          case "/two-factor/disable":
            // Disabling rotates the session: keep the new one, revoke every other (FR-013).
            if (current && sessionRef && ok)
              await events.afterFactorChanged(
                current.user.id,
                "totp_disabled",
                headers,
                sessionRef.id,
              );
            break;
          case "/passkey/verify-registration":
            if (current && ok)
              await events.afterFactorChanged(current.user.id, "passkey_added", headers);
            break;
          case "/passkey/delete-passkey":
            if (current && ok)
              await events.afterFactorChanged(
                current.user.id,
                "passkey_removed",
                headers,
                current.session.id,
              );
            break;
          case "/revoke-session":
            if (current && ok) await events.afterSessionsRevoked(current.user.id, false);
            break;
          case "/revoke-sessions":
          case "/revoke-other-sessions":
            if (current && ok) await events.afterSessionsRevoked(current.user.id, true);
            break;
          default:
            break;
        }
      }),
    },
    rateLimit: {
      // Off in automated tests, which share one IP; Guidesk's own lockout still applies (T059).
      enabled: config.NODE_ENV !== "test",
      storage: "database",
      window: MINUTE,
      max: 100,
      customRules: {
        "/email-otp/send-verification-otp": { window: 60 * MINUTE, max: 20 },
        "/sign-in/email-otp": { window: 15 * MINUTE, max: 20 },
        // Read by every portal page; the WAF still rate-limits per IP at the edge.
        "/get-session": { window: MINUTE, max: 600 },
      },
    },
    advanced: {
      cookiePrefix: "guidesk",
      useSecureCookies: secure,
      defaultCookieAttributes: { sameSite: "lax", httpOnly: true, secure },
      // The auth route sets this header from the connection, counting only trusted proxy hops
      // (CloudFront and the load balancer), so clients can't pick their own rate-limit key (T103).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
      // App-generated UUIDs for identity rows ("uuid" would expect database defaults).
      database: { generateId: () => crypto.randomUUID() },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 10 * MINUTE,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOTP: async ({ email, otp, type }, ctx) => {
          await sendOtp({
            email,
            otp,
            type,
            acceptLanguage: headersOf(ctx)?.get("accept-language") ?? null,
          });
        },
      }),
      passkey({
        rpID: portal.hostname,
        rpName: "Guidesk",
        origin: config.PORTAL_URL,
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      }),
      // Passwordless accounts manage TOTP without a password (FR-001, FR-009).
      twoFactor({ issuer: "Guidesk", allowPasswordless: true }),
    ],
  } satisfies BetterAuthOptions;
}
