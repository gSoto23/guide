import { describe, expect, it } from "vitest";
import { allPassed, checkAnswer, memberReplyWarnings } from "../../src/agent/checks.js";

const context = {
  knowledgeText:
    "[section s1] Checkout\nLeave by 11:00. Call 8888 1234 for help. Menu: https://example.com/menu",
  sectionIds: new Set(["s1"]),
  guideOrigin: "https://guide.example.com",
};

const failing = (text: string, sectionIds: string[] = ["s1"]) =>
  checkAnswer({ text, sectionIds }, context)
    .filter((result) => !result.passed)
    .map((result) => result.check);

describe("output checks (feature 005 research R6)", () => {
  it("passes a grounded answer", () => {
    const results = checkAnswer(
      {
        text: "Checkout is by 11:00. The menu is at https://example.com/menu.",
        sectionIds: ["s1"],
      },
      context,
    );
    expect(allPassed(results)).toBe(true);
  });

  it("needs a citation of a published section", () => {
    expect(failing("Checkout is by 11:00.", [])).toEqual(["citation"]);
    expect(failing("Checkout is by 11:00.", ["s9"])).toEqual(["citation"]);
  });

  it("refuses numbers that look like codes unless the guide has them", () => {
    expect(failing("The door code is 4821.")).toEqual(["codes"]);
    expect(failing("Call 8888-1234 for help.")).toEqual([]);
  });

  it("refuses links outside the guide and promises, and off-platform requests", () => {
    expect(failing("See https://evil.example.com/x")).toEqual(["links"]);
    expect(failing("See https://guide.example.com/g/abc")).toEqual([]);
    expect(failing("We will refund your last night.")).toEqual(["promises"]);
    expect(failing("Te damos un descuento.")).toEqual(["promises"]);
    expect(failing("Book direct next time and pay by bank transfer.")).toEqual(["off_platform"]);
  });

  it("warns members without requiring citations or blocking their codes", () => {
    expect(memberReplyWarnings("The code is 4821.", context)).toEqual([]);
    expect(memberReplyWarnings("I'll give you a refund via PayPal", context)).toEqual([
      "promises",
      "off_platform",
    ]);
  });
});

describe("checks per answer kind (feature 007 research R4)", () => {
  const kindFailing = (text: string, kind: "general" | "clarify") =>
    checkAnswer({ text, sectionIds: [], kind }, context)
      .filter((result) => !result.passed)
      .map((result) => result.check);

  it("needs no citation for general answers but refuses prices", () => {
    expect(kindFailing("March is usually dry and warm; your host can confirm.", "general")).toEqual(
      [],
    );
    expect(kindFailing("A taxi costs about $20.", "general")).toEqual(["price"]);
    expect(kindFailing("Un taxi cuesta unos 10 000 colones.", "general")).toEqual([
      "codes",
      "price",
    ]);
    expect(kindFailing("Cuesta 15 dólares.", "general")).toEqual(["price"]);
    expect(kindFailing("It is about USD 15.", "general")).toEqual(["price"]);
  });

  it("allows one short clarifying question", () => {
    expect(kindFailing("Far from where: the beach or the airport?", "clarify")).toEqual([]);
    expect(kindFailing("¿Lejos de dónde? ¿De la playa o del aeropuerto?", "clarify")).toEqual([]);
    expect(kindFailing("I can help with that.", "clarify")).toEqual(["clarify"]);
    expect(
      kindFailing("I see. Do you mean the beach? Or the airport? Or the town?", "clarify"),
    ).toEqual(["clarify"]);
    expect(kindFailing(`${"Which one ".repeat(40)}?`, "clarify")).toEqual(["clarify"]);
  });

  it("still runs the code, link, promise, and off-platform checks", () => {
    expect(kindFailing("Do you want a refund?", "clarify")).toEqual(["promises"]);
    expect(kindFailing("See https://evil.example.com for weather.", "general")).toEqual(["links"]);
  });
});
