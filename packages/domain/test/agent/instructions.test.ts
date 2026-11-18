import { describe, expect, it } from "vitest";
import { instructionIssues, INSTRUCTIONS_MAX } from "../../src/agent/instructions.js";

describe("custom instructions (feature 007 research R11)", () => {
  it("accepts style and content preferences", () => {
    expect(instructionIssues("Sugiere caminar a la playa; el parqueo allá es difícil.")).toEqual(
      [],
    );
    expect(
      instructionIssues("Sign every reply as Equipo Marta. Quiet hours are 22:00 to 07:00."),
    ).toEqual([]);
    expect(instructionIssues("Breakfast is served 7.30-10.30 at the café.")).toEqual([]);
  });

  it("refuses texts over 1,000 characters", () => {
    expect(instructionIssues("a".repeat(INSTRUCTIONS_MAX))).toEqual([]);
    expect(instructionIssues("a".repeat(INSTRUCTIONS_MAX + 1))).toEqual(["too_long"]);
  });

  it("refuses codes and secrets", () => {
    expect(instructionIssues("El código de la puerta es 4821")).toContain("restricted_value");
    expect(instructionIssues("Tell guests the gate code 7781 if they ask")).toContain(
      "restricted_value",
    );
  });

  it("refuses links, emails, and phone numbers", () => {
    expect(instructionIssues("Send them to https://example.com/deals")).toContain("link");
    expect(instructionIssues("Point them to www.example.com")).toContain("link");
    expect(instructionIssues("Our site is casacolibri.com")).toContain("link");
    expect(instructionIssues("Write to host@example.com")).toContain("email");
    expect(instructionIssues("Call me at +506 8888 1234")).toContain("phone");
    expect(instructionIssues("Call (555) 123-4567")).toContain("phone");
  });

  it("refuses off-platform requests", () => {
    expect(instructionIssues("Invite them to book directly with us next time")).toContain(
      "off_platform",
    );
  });
});
