import { describe, expect, it } from "vitest";
import { lockState, stayLinkWorking } from "../../src/guest/lock-state.js";

const property = { timeZone: "America/Costa_Rica", checkInTime: "15:00", checkoutTime: "11:00" };
const stay = {
  status: "active" as const,
  checkInDate: "2026-12-12",
  checkoutDate: "2026-12-15",
  checkInTime: null,
  checkoutTime: null,
};
const link = { status: "active" as const };

describe("lock state (feature 004 research R6)", () => {
  it("is public without a session", () => {
    expect(lockState(null, new Date("2026-12-13T12:00:00Z")).state).toBe("public");
  });

  it("is before the window until 00:00 on the check-in day", () => {
    const result = lockState({ link, stay, property }, new Date("2026-12-12T05:59:59Z"));
    expect(result.state).toBe("before");
    expect(result.window?.opensAt.toISOString()).toBe("2026-12-12T06:00:00.000Z");
  });

  it("is inside from the opening to checkout plus 2 hours", () => {
    expect(lockState({ link, stay, property }, new Date("2026-12-12T06:00:00Z")).state).toBe(
      "inside",
    );
    expect(lockState({ link, stay, property }, new Date("2026-12-15T18:59:59Z")).state).toBe(
      "inside",
    );
  });

  it("is ended after the window, and for revoked, replaced, cancelled, or hidden stays", () => {
    const during = new Date("2026-12-13T12:00:00Z");
    expect(lockState({ link, stay, property }, new Date("2026-12-15T19:00:00Z")).state).toBe(
      "ended",
    );
    expect(lockState({ link: { status: "revoked" }, stay, property }, during).state).toBe("ended");
    expect(lockState({ link: { status: "replaced" }, stay, property }, during).state).toBe("ended");
    expect(
      lockState({ link, stay: { ...stay, status: "cancelled" }, property }, during).state,
    ).toBe("ended");
    expect(lockState({ link, stay: { ...stay, status: "hidden" }, property }, during).state).toBe(
      "ended",
    );
  });

  it("says whether a stay link still works", () => {
    expect(stayLinkWorking({ link, stay, property }, new Date("2026-12-01T00:00:00Z"))).toBe(true);
    expect(stayLinkWorking({ link, stay, property }, new Date("2026-12-16T00:00:00Z"))).toBe(false);
  });
});
