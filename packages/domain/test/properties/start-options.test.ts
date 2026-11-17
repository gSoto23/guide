import { describe, expect, it } from "vitest";
import { orderStartOptions } from "../../src/properties/start-options.js";

const allBuilt = { available: ["listing", "pms", "csv", "duplicate", "blank"] as const };
const options = (input: Parameters<typeof orderStartOptions>[0]) =>
  orderStartOptions(input).map((option) => option.option);

describe("starting options (FR-008)", () => {
  it("puts listing text first for individual hosts", () => {
    const result = orderStartOptions({
      ...allBuilt,
      path: "individual",
      pms: null,
      enabledProviders: ["beds24", "hostex"],
      hasProperties: false,
    });
    expect(result[0]).toEqual({ option: "listing", recommended: true });
    expect(result.slice(1).every((option) => !option.recommended)).toBe(true);
  });

  it("puts the PMS import first when the host named a supported PMS whose flag is on", () => {
    for (const pms of ["beds24", "hostex"] as const) {
      expect(
        options({
          ...allBuilt,
          path: "individual",
          pms,
          enabledProviders: [pms],
          hasProperties: false,
        })[0],
      ).toBe("pms");
    }
  });

  it("puts CSV first for managers without a supported PMS", () => {
    expect(
      options({
        ...allBuilt,
        path: "manager",
        pms: "guesty",
        enabledProviders: ["beds24"],
        hasProperties: false,
      })[0],
    ).toBe("csv");
  });

  it("never offers a PMS import while no supported provider's flag is on", () => {
    const result = options({
      ...allBuilt,
      path: "manager",
      pms: "beds24",
      enabledProviders: [],
      hasProperties: false,
    });
    expect(result).not.toContain("pms");
    expect(result[0]).toBe("csv");
  });

  it("offers copying a property only when one exists, and always offers a blank start", () => {
    const none = options({
      ...allBuilt,
      path: "individual",
      pms: null,
      enabledProviders: [],
      hasProperties: false,
    });
    const some = options({
      ...allBuilt,
      path: "individual",
      pms: null,
      enabledProviders: [],
      hasProperties: true,
    });
    expect(none).not.toContain("duplicate");
    expect(some).toContain("duplicate");
    expect(none.at(-1)).toBe("blank");
  });

  it("leaves out paths that are not available yet", () => {
    expect(
      options({
        available: ["listing", "blank"],
        path: "manager",
        pms: null,
        enabledProviders: ["beds24"],
        hasProperties: true,
      }),
    ).toEqual(["listing", "blank"]);
  });
});
