import { describe, expect, it } from "vitest";
import {
  DEFAULT_PILOT_SEAT_LIMIT,
  effectiveStatus,
  hasFreeSeat,
  invitationExpiry,
  isOpen,
  normalizeEmail,
  resendDecision,
  RESENDS_PER_INVITATION_PER_DAY,
} from "../src/index.js";

const created = new Date("2026-11-14T12:00:00Z");
const pending = { status: "pending" as const, expiresAt: invitationExpiry(created) };

describe("invitation state machine (T066, FR-018)", () => {
  it("expires 7 days after creation", () => {
    expect(pending.expiresAt.toISOString()).toBe("2026-11-21T12:00:00.000Z");
  });

  it("treats a pending invitation past its expiry as expired before the daily job runs", () => {
    expect(effectiveStatus(pending, new Date("2026-11-21T11:59:59Z"))).toBe("pending");
    expect(effectiveStatus(pending, new Date("2026-11-21T12:00:00Z"))).toBe("expired");
  });

  it("keeps accepted, revoked, and expired invitations final", () => {
    for (const status of ["accepted", "revoked", "expired"] as const) {
      expect(isOpen({ status, expiresAt: pending.expiresAt }, created)).toBe(false);
    }
    expect(isOpen(pending, created)).toBe(true);
  });

  it("allows resends within the daily limit, without changing the expiry", () => {
    expect(resendDecision(pending, 0, created)).toBe("ok");
    expect(resendDecision(pending, RESENDS_PER_INVITATION_PER_DAY, created)).toBe("rate_limited");
    expect(resendDecision({ ...pending, status: "revoked" }, 0, created)).toBe("gone");
    expect(resendDecision(pending, 0, new Date("2026-11-22T00:00:00Z"))).toBe("gone");
  });

  it("compares emails trimmed and lowercased (FR-003)", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("seat limit (T073, FR-021)", () => {
  it("counts members and open invitations against the limit", () => {
    expect(hasFreeSeat({ members: 1, pendingInvitations: 0 }, 2)).toBe(true);
    expect(hasFreeSeat({ members: 1, pendingInvitations: 1 }, 2)).toBe(false);
    expect(DEFAULT_PILOT_SEAT_LIMIT).toBeGreaterThan(1);
  });
});
