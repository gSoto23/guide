import { describe, expect, it } from "vitest";
import {
  MFA_PROPERTY_THRESHOLD,
  STEP_UP_WINDOW_MS,
  isStepUpFresh,
  requiresMfa,
  stepUpMethods,
} from "../src/index.js";

describe("requiresMfa (T047, FR-009, NFR-13)", () => {
  it("always applies to Guidesk staff", () => {
    expect(requiresMfa({ isStaff: true, role: "agent", propertyCount: 0 })).toBe(true);
    expect(requiresMfa({ isStaff: true, role: null, propertyCount: 0 })).toBe(true);
  });

  it("applies to owners and admins of workspaces with more than 2 properties", () => {
    expect(MFA_PROPERTY_THRESHOLD).toBe(2);
    expect(requiresMfa({ isStaff: false, role: "owner", propertyCount: 3 })).toBe(true);
    expect(requiresMfa({ isStaff: false, role: "admin", propertyCount: 60 })).toBe(true);
    expect(requiresMfa({ isStaff: false, role: "owner", propertyCount: 2 })).toBe(false);
  });

  it("does not apply to agents or non-members", () => {
    expect(requiresMfa({ isStaff: false, role: "agent", propertyCount: 60 })).toBe(false);
    expect(requiresMfa({ isStaff: false, role: null, propertyCount: 60 })).toBe(false);
  });
});

describe("isStepUpFresh (T047, FR-011)", () => {
  const now = new Date("2026-11-14T12:00:00Z");

  it("accepts re-authentication within the last 10 minutes", () => {
    expect(STEP_UP_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(isStepUpFresh(new Date(now.getTime() - 9 * 60 * 1000), now)).toBe(true);
    expect(isStepUpFresh(new Date(now.getTime() - 10 * 60 * 1000), now)).toBe(true);
  });

  it("rejects older or missing re-authentication", () => {
    expect(isStepUpFresh(new Date(now.getTime() - 10 * 60 * 1000 - 1), now)).toBe(false);
    expect(isStepUpFresh(null, now)).toBe(false);
  });

  it("rejects timestamps in the future (clock tampering)", () => {
    expect(isStepUpFresh(new Date(now.getTime() + 60 * 1000), now)).toBe(false);
  });
});

describe("stepUpMethods", () => {
  it("offers only second factors when MFA is what is missing", () => {
    expect(stepUpMethods({ hasPasskey: true, totpEnabled: true, needSecondFactor: true })).toEqual([
      "passkey",
      "totp",
    ]);
    expect(
      stepUpMethods({ hasPasskey: false, totpEnabled: false, needSecondFactor: true }),
    ).toEqual([]);
  });

  it("also offers the email code for plain re-authentication", () => {
    expect(
      stepUpMethods({ hasPasskey: false, totpEnabled: false, needSecondFactor: false }),
    ).toEqual(["email_otp"]);
    expect(
      stepUpMethods({ hasPasskey: true, totpEnabled: false, needSecondFactor: false }),
    ).toEqual(["passkey", "email_otp"]);
  });
});
