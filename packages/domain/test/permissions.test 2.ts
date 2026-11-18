import { describe, expect, it } from "vitest";
import { CAPABILITIES, can, canManageMember, INVITABLE_ROLES } from "../src/index.js";

describe("permission matrix (T065, FR-016)", () => {
  it("gives owners every capability", () => {
    for (const capability of CAPABILITIES) expect(can("owner", capability), capability).toBe(true);
  });

  it("keeps billing and ownership for the owner only", () => {
    expect(can("admin", "workspace.billing")).toBe(false);
    expect(can("admin", "workspace.ownership")).toBe(false);
    expect(can("admin", "members.manage")).toBe(true);
  });

  it("lets agents handle conversations only, and never reveal restricted values", () => {
    expect(can("agent", "conversations.handle")).toBe(true);
    expect(can("agent", "restricted.reveal")).toBe(false);
    expect(can("agent", "members.manage")).toBe(false);
    expect(can("agent", "workspace.settings")).toBe(false);
    expect(can("agent", "security_log.view")).toBe(false);
  });

  it("grants nothing without a membership", () => {
    for (const capability of CAPABILITIES) expect(can(null, capability)).toBe(false);
  });

  it("never lets an invitation grant ownership", () => {
    expect(INVITABLE_ROLES).toEqual(["admin", "agent"]);
  });

  it("never lets admins target the owner, and nobody targets themselves (AC-SEC-003)", () => {
    const admin = { role: "admin" as const, userId: "a" };
    expect(canManageMember(admin, { role: "owner", userId: "o" })).toBe(false);
    expect(canManageMember(admin, { role: "agent", userId: "g" })).toBe(true);
    expect(canManageMember(admin, { role: "admin", userId: "a" })).toBe(false);
    expect(canManageMember({ role: "owner", userId: "o" }, { role: "owner", userId: "o" })).toBe(
      false,
    );
    expect(canManageMember({ role: "agent", userId: "g" }, { role: "agent", userId: "x" })).toBe(
      false,
    );
  });
});
