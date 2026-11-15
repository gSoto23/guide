/**
 * Account-protection tables (spec 001 US2, T053). System context only: guidesk_app has no
 * access (migration 0007). See data model §2.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { session, user } from "./auth.js";

/** How strongly the current session is authenticated (research R5, R6). */
export const sessionAssurance = pgTable(
  "session_assurance",
  {
    sessionId: text("session_id")
      .primaryKey()
      .references(() => session.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    strongAuthAt: timestamptz("strong_auth_at"),
    method: text("method", { enum: ["passkey", "totp", "email_otp", "google"] }),
    mfaSatisfied: boolean("mfa_satisfied").notNull().default(false),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "session_assurance_method_valid",
      sql`${t.method} IS NULL OR ${t.method} IN ('passkey', 'totp', 'email_otp', 'google')`,
    ),
  ],
);

/** Devices that signed in to an account, by hash of the device cookie (research R7). */
export const knownDevice = pgTable(
  "known_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    deviceIdHash: text("device_id_hash").notNull(),
    label: text("label").notNull(),
    firstSeenAt: timestamptz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("known_device_user_hash_uq").on(t.userId, t.deviceIdHash)],
);

/** Email codes for step-up re-authentication within the same session (FR-011, T056). */
export const stepUpChallenge = pgTable("step_up_challenge", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => session.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamptz("expires_at").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamptz("consumed_at"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** Failed sign-in and verification counters, and temporary locks (AC-SEC-001, T059). */
export const authLockout = pgTable("auth_lockout", {
  key: text("key").primaryKey(),
  failureCount: integer("failure_count").notNull().default(0),
  windowStartedAt: timestamptz("window_started_at").notNull().defaultNow(),
  lockedUntil: timestamptz("locked_until"),
  notifiedAt: timestamptz("notified_at"),
});

/**
 * Authenticator-app codes already accepted, so each code works only once (ASVS 5.0 V6.5,
 * security review T103). Rows expire after the code's validity window.
 */
export const usedTotpCode = pgTable(
  "used_totp_code",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.codeHash] })],
);

function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true });
}
