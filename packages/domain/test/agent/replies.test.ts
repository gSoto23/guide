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

describe("host display name (FR-003)", () => {
  it("names the host only after the workspace has a chosen name", async () => {
    const { hostDisplayName } = await import("../../src/tenancy.js");
    expect(hostDisplayName("Hospedajes Ana")).toBe("Hospedajes Ana");
    expect(hostDisplayName("Mi espacio de trabajo")).toBeNull();
    expect(hostDisplayName("Espacio de Ana")).toBeNull();
    expect(hostDisplayName("Ana's workspace")).toBeNull();
  });
});

describe("tone and quiet hours in fixed replies (feature 007 research R5)", () => {
  it("keeps the casual texts of spec 005 by default", () => {
    expect(holdingReply("es", "draft_ready")).toBe(
      "Gracias por tu mensaje. Tu anfitrión lo revisará y te responderá aquí pronto. También puedes escribirle por los mensajes de la plataforma de tu reserva.",
    );
    expect(holdingReply("es", "draft_ready", { tone: "casual" })).toBe(
      holdingReply("es", "draft_ready"),
    );
  });

  it("uses usted and no exclamations in formal Spanish", () => {
    for (const reason of NEEDS_HOST_REASONS) {
      const text = holdingReply("es", reason, { tone: "formal" });
      expect(text).toContain("plataforma de su reserva");
      expect(text).not.toMatch(/\btu\b|\bte\b|puedes|llama ya|[!¡]/i);
    }
    expect(greetingReply("es", "Casa Colibrí", "formal")).not.toMatch(/[!¡]|Pregúntame/);
    expect(greetingReply("en", "Casa Colibrí", "formal")).not.toContain("!");
    expect(emergencyReply("es", "911", "formal")).toBe("Emergencia: llame ya al 911.");
  });

  it("says when the host usually answers during quiet hours, except for emergencies", () => {
    expect(holdingReply("es", "draft_ready", { quietUntil: "07:00" })).toContain(
      "Tu anfitrión suele responder después de las 07:00.",
    );
    expect(holdingReply("es", "draft_ready", { quietUntil: "07:00", tone: "formal" })).toContain(
      "Su anfitrión suele responder después de las 07:00.",
    );
    expect(holdingReply("en", "malfunction", { quietUntil: "07:30" })).toContain(
      "Your host usually replies after 7:30 AM.",
    );
    expect(holdingReply("en", "limit", { quietUntil: "13:00" })).toContain("after 1:00 PM");
    expect(holdingReply("en", "emergency", { quietUntil: "07:00" })).not.toContain("usually");
  });
});
