import { createHmac } from "node:crypto";
import pg from "pg";
import { cookieHeader, PORTAL_URL, type createTestApp } from "./test-app.js";

type Ctx = Awaited<ReturnType<typeof createTestApp>>;

export const jsonHeaders = { origin: PORTAL_URL, "content-type": "application/json" };

export async function requestCode(
  ctx: Ctx,
  email: string,
  extraHeaders: Record<string, string> = {},
) {
  return ctx.fastify.inject({
    method: "POST",
    url: "/api/auth/email-otp/send-verification-otp",
    headers: { ...jsonHeaders, ...extraHeaders },
    payload: { email, type: "sign-in" },
  });
}

/** Signs in (or up) with an email one-time code and returns the cookie header. */
export async function signIn(
  ctx: Ctx,
  email: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const sent = await requestCode(ctx, email, extraHeaders);
  if (sent.statusCode !== 200) throw new Error(`send code failed: ${sent.statusCode} ${sent.body}`);
  const response = await ctx.fastify.inject({
    method: "POST",
    url: "/api/auth/sign-in/email-otp",
    headers: { ...jsonHeaders, ...extraHeaders },
    payload: { email, otp: ctx.email.lastCodeFor(email) },
  });
  if (response.statusCode !== 200)
    throw new Error(`sign-in failed: ${response.statusCode} ${response.body}`);
  return cookieHeader(response.headers["set-cookie"]);
}

/** Owner-connection queries for assertions (system context). */
export function systemQuery(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  return {
    query: <T extends pg.QueryResultRow>(text: string, values: unknown[] = []) =>
      pool.query<T>(text, values),
    close: () => pool.end(),
  };
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/** Decodes RFC 4648 base32 (TOTP secrets in otpauth:// URIs). */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("invalid base32");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits), as authenticator apps compute it. */
export function totpCode(otpauthUri: string, at: number = Date.now()): string {
  const secret = new URL(otpauthUri).searchParams.get("secret");
  if (!secret) throw new Error("no secret in otpauth URI");
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, "0");
}
