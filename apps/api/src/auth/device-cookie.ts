import { randomBytes } from "node:crypto";

/** Long-lived random device cookie (research R7). Only its hash is stored. */
export const DEVICE_COOKIE = "guidesk.device";
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** A device ID is 32 random bytes in base64url (43 characters). */
export function isValidDeviceId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Ensures the request carries a valid device cookie. Returns the cookie header to forward and,
 * for a new device, the Set-Cookie value for the response. A missing, empty, or malformed value
 * counts as a new device, so a crafted cookie can't suppress the new-device alert (T103).
 */
export function ensureDeviceCookie(
  cookieHeader: string | undefined,
  secure: boolean,
): { cookie: string; setCookie?: string } {
  const parts = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  const others = parts.filter((part) => part.split("=")[0] !== DEVICE_COOKIE);
  const current = parts.find((part) => part.split("=")[0] === DEVICE_COOKIE);
  const currentValue = current?.slice(DEVICE_COOKIE.length + 1);
  if (parts.length - others.length === 1 && isValidDeviceId(currentValue)) {
    return { cookie: cookieHeader ?? "" };
  }
  const value = randomBytes(32).toString("base64url");
  const cookie = [...others, `${DEVICE_COOKIE}=${value}`].join("; ");
  const attributes = [
    `Path=/`,
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ];
  return { cookie, setCookie: `${DEVICE_COOKIE}=${value}; ${attributes.join("; ")}` };
}
