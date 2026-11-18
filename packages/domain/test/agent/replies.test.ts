import { describe, expect, it } from "vitest";
import {
  emergencyReply,
  greetingReply,
  holdingReply,
  NEEDS_HOST_REASONS,
  pointerReply,
} from "../../src/agent/index.js";

describe("assistant fixed replies (FR-019)", () => {
  it("has a holding reply for every reason and language, each with the platform reminder", () => {
    for (const reason of NEEDS_HOST_REASONS) {
      expect(holdingReply("es", reason)).toContain("plataforma de tu reserva");
      expect(holdingReply("en", reason)).toContain("booking platform");
    }
  });

  it("never offers anything or asks for contact data", () => {
    const all = NEEDS_HOST_REASONS.flatMap((reason) => [
      holdingReply("es", reason),
      holdingReply("en", reason),
    ]);
    for (const text of all) {
      expect(text).not.toMatch(/@|whatsapp|tel[eé]fono|phone number|email/i);
    }
  });

  it("names the section in pointers and the number in the emergency card", () => {
    expect(pointerReply("en", "Arrival")).toContain("“Arrival”");
    expect(pointerReply("es", null)).toContain("guía");
    expect(emergencyReply("es", "911")).toContain("911");
    expect(emergencyReply("en", null)).toContain("local emergency number");
    expect(greetingReply("en", "Casa Colibrí")).toContain("Casa Colibrí");
  });
});
